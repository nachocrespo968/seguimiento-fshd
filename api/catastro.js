// Server-side proxy for the Catastro INSPIRE WFS service.
//
// The browser can't call ovc.catastro.meh.es directly: it doesn't send
// CORS headers, so a client-side fetch() is blocked by the browser before
// the app ever sees a response. Vercel serverless functions aren't subject
// to CORS (it's a server-to-server request), so this endpoint fetches the
// parcel GML on the app's behalf and hands it back same-origin.

const CATASTRO_WFS_URL = 'https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx';
const REF_PATTERN = /^[A-Za-z0-9]{1,25}$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const ref = (req.query.ref || '').trim();
  if (!REF_PATTERN.test(ref)) {
    res.status(400).json({ error: 'referencia catastral no válida' });
    return;
  }

  const url = `${CATASTRO_WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&STOREDQUERY_ID=GetParcel&REFCAT=${encodeURIComponent(ref)}`;

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
