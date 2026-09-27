// Server-side proxy for the Catastro INSPIRE WFS service.
//
// The browser can't call ovc.catastro.meh.es directly: it doesn't send
// CORS headers, so a client-side fetch() is blocked by the browser before
// the app ever sees a response. Vercel serverless functions aren't subject
// to CORS (it's a server-to-server request), so this endpoint fetches the
// parcel GML on the app's behalf and hands it back same-origin.
//
// Two modes, selected by which query param is present:
//   ?ref=<referencia catastral>   -> a single parcel (GetParcel stored query)
//   ?bbox=minLat,minLon,maxLat,maxLon -> all parcels intersecting that box
//                                        (used for "parcelas colindantes")

const CATASTRO_WFS_URL = 'https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx';
const REF_PATTERN = /^[A-Za-z0-9]{1,25}$/;
const BBOX_PATTERN = /^-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?$/;
const CRS_URI = 'http://www.opengis.net/def/crs/EPSG/0/4326';
const MAX_FEATURES = 500;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const ref = (req.query.ref || '').trim();
  const bbox = (req.query.bbox || '').trim();

  let url;

  if (bbox) {
    if (!BBOX_PATTERN.test(bbox)) {
      res.status(400).json({ error: 'bbox no válido' });
      return;
    }
    const [minLat, minLon, maxLat, maxLon] = bbox.split(',').map(Number);
    if (minLat < -90 || maxLat > 90 || minLon < -180 || maxLon > 180 || minLat >= maxLat || minLon >= maxLon) {
      res.status(400).json({ error: 'bbox fuera de rango' });
      return;
    }
    const namespaces = encodeURIComponent('xmlns(cp,http://inspire.ec.europa.eu/schemas/cp/4.0)');
    const bboxParam = encodeURIComponent(`${minLat},${minLon},${maxLat},${maxLon},${CRS_URI}`);
    url = `${CATASTRO_WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=cp:CadastralParcel&NAMESPACES=${namespaces}&BBOX=${bboxParam}&COUNT=${MAX_FEATURES}`;
  } else if (ref) {
    if (!REF_PATTERN.test(ref)) {
      res.status(400).json({ error: 'referencia catastral no válida' });
      return;
    }
    url = `${CATASTRO_WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&STOREDQUERY_ID=GetParcel&REFCAT=${encodeURIComponent(ref)}`;
  } else {
    res.status(400).json({ error: 'falta el parámetro ref o bbox' });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const upstream = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const body = await upstream.text();
    res.status(upstream.ok ? 200 : 502);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  } catch (err) {
    res.status(504).json({ error: 'no se pudo contactar con el Catastro: ' + err.message });
  }
};
