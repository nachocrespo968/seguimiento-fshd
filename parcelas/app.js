// Generador de planos catastrales georreferenciados
// Entrada: GML del Catastro (esquema INSPIRE CadastralParcels)
// Salida: mapa Leaflet con las parcelas sobre la ortofoto PNOA (WMS del IGN)

proj4.defs('EPSG:25828', '+proj=utm +zone=28 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:25829', '+proj=utm +zone=29 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:25830', '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:25831', '+proj=utm +zone=31 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const DEFAULT_CRS = 'EPSG:25830';

let map = null;
let baseLayers = {};
let parcelLayerGroup = null;
let parcels = []; // {ref, areaM2, layer, bounds}

const CATASTRO_WFS_URL = 'https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx';

initMap();
document.getElementById('loadBtn').addEventListener('click', handleLoad);
document.getElementById('loadRefBtn').addEventListener('click', handleLoadByRef);
document.getElementById('printBtn').addEventListener('click', () => window.print());
document.getElementById('csvBtn').addEventListener('click', exportCSV);
document.getElementById('baseLayer').addEventListener('change', switchBaseLayer);
document.getElementById('fincaName').addEventListener('input', updateCajetin);

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([40.0, -3.7], 6);

  const pnoa = L.tileLayer.wms('https://www.ign.es/wms-inspire/pnoa-ma', {
    layers: 'OI.OrthoimageCoverage',
    format: 'image/jpeg',
    version: '1.3.0',
    transparent: false,
    attribution: 'PNOA © Instituto Geográfico Nacional de España'
  });

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  });

  baseLayers = { pnoa, osm };
  pnoa.addTo(map);

  L.control.scale({ metric: true, imperial: false }).addTo(map);

  parcelLayerGroup = L.layerGroup().addTo(map);
  updateCajetin();
}

function switchBaseLayer(e) {
  Object.values(baseLayers).forEach(l => map.removeLayer(l));
  baseLayers[e.target.value].addTo(map);
}

async function handleLoad() {
  const input = document.getElementById('gmlFiles');
  const files = Array.from(input.files || []);
  const statusEl = document.getElementById('status');
  statusEl.classList.remove('error');

  if (files.length === 0) {
    statusEl.textContent = 'Selecciona al menos un archivo GML.';
    statusEl.classList.add('error');
    return;
  }

  clearParcels();
  statusEl.textContent = 'Procesando...';

  const swapAxes = document.getElementById('swapAxes').checked;
  let totalParsed = 0;
  let errors = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const found = parseGML(text, swapAxes);
      found.forEach(p => addParcel(p));
      totalParsed += found.length;
    } catch (err) {
      errors.push(file.name + ': ' + err.message);
    }
  }

  finishLoad();

  statusEl.textContent = `Cargadas ${totalParsed} parcelas de ${files.length} archivo(s).`;
  if (errors.length) {
    statusEl.textContent += '\nErrores:\n' + errors.join('\n');
    statusEl.classList.add('error');
  }
}

async function handleLoadByRef() {
  const raw = document.getElementById('refInput').value;
  const refs = [...new Set(raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean))];
  const statusEl = document.getElementById('status');
  statusEl.classList.remove('error');

  if (refs.length === 0) {
    statusEl.textContent = 'Escribe al menos una referencia catastral.';
    statusEl.classList.add('error');
    return;
  }

  clearParcels();
  const swapAxes = document.getElementById('swapAxes').checked;
  let totalParsed = 0;
  let errors = [];

  for (const ref of refs) {
    statusEl.textContent = `Consultando ${ref}... (${totalParsed + errors.length + 1}/${refs.length})`;
    try {
      const text = await fetchParcelGML(ref);
      const found = parseGML(text, swapAxes);
      if (found.length === 0) throw new Error('el Catastro no devolvió geometría para esta referencia');
      found.forEach(p => addParcel(p));
      totalParsed += found.length;
    } catch (err) {
      errors.push(`${ref}: ${err.message}`);
    }
  }

  finishLoad();

  statusEl.textContent = `Cargadas ${totalParsed} parcelas de ${refs.length} referencia(s).`;
  if (errors.length) {
    statusEl.textContent += '\nNo se pudieron cargar:\n' + errors.join('\n')
      + '\n\nSi el fallo es de red/CORS, descarga el GML manualmente desde la Sede Electrónica del Catastro y súbelo con la opción "2. Alternativa: subir GML".';
    statusEl.classList.add('error');
  }
}

async function fetchParcelGML(ref) {
  const url = `${CATASTRO_WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&STOREDQUERY_ID=GetParcel&REFCAT=${encodeURIComponent(ref)}`;
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error('no se pudo contactar con el Catastro (red o CORS)');
  }
  if (!response.ok) {
    throw new Error(`el Catastro respondió con error ${response.status}`);
  }
  const text = await response.text();
  if (/ExceptionReport|ServiceExceptionReport/.test(text)) {
    throw new Error('el Catastro no reconoce esa referencia catastral');
  }
  return text;
}

function clearParcels() {
  parcelLayerGroup.clearLayers();
  parcels = [];
}

function finishLoad() {
  renderParcelList();
  updateCajetin();
  if (parcels.length > 0) {
    const group = L.featureGroup(parcels.map(p => p.layer));
    map.fitBounds(group.getBounds(), { padding: [30, 30] });
  }
}

// --- GML parsing -----------------------------------------------------

function localName(el) {
  return el.localName || el.nodeName.split(':').pop();
}

function findChildByLocalName(el, name) {
  for (const child of el.children) {
    if (localName(child) === name) return child;
  }
  return null;
}

function findAllByLocalName(root, name) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (localName(child) === name) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function findAncestorSrsName(el) {
  let node = el;
  while (node) {
    if (node.getAttribute && node.getAttribute('srsName')) {
      return node.getAttribute('srsName');
    }
    node = node.parentElement;
  }
  return null;
}

function crsFromSrsName(srsName) {
  if (!srsName) return DEFAULT_CRS;
  const match = srsName.match(/258(2[89]|3[01])/);
  if (match) return 'EPSG:' + match[0];
  return DEFAULT_CRS;
}

function parsePosListToRing(posListEl, crsCode, swapAxes) {
  const dim = parseInt(posListEl.getAttribute('srsDimension') || '2', 10) || 2;
  const nums = posListEl.textContent.trim().split(/\s+/).map(Number);
  const ring = [];
  for (let i = 0; i + 1 < nums.length; i += dim) {
    let a = nums[i];
    let b = nums[i + 1];
    const x = swapAxes ? b : a;
    const y = swapAxes ? a : b;
    const [lon, lat] = proj4(crsCode, 'WGS84', [x, y]);
    ring.push([lat, lon]); // Leaflet expects [lat, lng]
  }
  return ring;
}

function ringAreaM2(latlngRing) {
  // planar shoelace on projected coords is more accurate, but as a fallback
  // we approximate using an equirectangular projection around the ring's mean latitude.
  if (latlngRing.length < 3) return 0;
  const meanLat = latlngRing.reduce((s, p) => s + p[0], 0) / latlngRing.length;
  const R = 6378137;
  const rad = Math.PI / 180;
  const pts = latlngRing.map(([lat, lon]) => [
    lon * rad * R * Math.cos(meanLat * rad),
    lat * rad * R
  ]);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
}

function parseGML(text, swapAxes) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) throw new Error('XML no válido');

  const parcelEls = findAllByLocalName(doc.documentElement, 'CadastralParcel');
  if (parcelEls.length === 0) {
    throw new Error('No se encontraron elementos CadastralParcel en el GML');
  }

  const results = [];

  for (const parcelEl of parcelEls) {
    const refEl = findAllByLocalName(parcelEl, 'nationalCadastralReference')[0]
      || findAllByLocalName(parcelEl, 'label')[0];
    const ref = refEl ? refEl.textContent.trim() : '(sin referencia)';

    const areaEl = findAllByLocalName(parcelEl, 'areaValue')[0];
    let areaM2 = areaEl ? parseFloat(areaEl.textContent.trim()) : null;

    const posLists = findAllByLocalName(parcelEl, 'posList');
    if (posLists.length === 0) continue;

    const rings = [];
    let computedArea = 0;

    for (const posListEl of posLists) {
      const srsName = posListEl.getAttribute('srsName') || findAncestorSrsName(posListEl);
      const crsCode = crsFromSrsName(srsName);
      const isInterior = !!closestAncestorLocalName(posListEl, 'interior');
      const ring = parsePosListToRing(posListEl, crsCode, swapAxes);
      rings.push({ ring, isInterior });
      if (!isInterior) computedArea += ringAreaM2(ring);
    }

    if (areaM2 == null || isNaN(areaM2)) areaM2 = computedArea;

    results.push({ ref, areaM2, rings });
  }

  return results;
}

function closestAncestorLocalName(el, name) {
  let node = el.parentElement;
  while (node) {
    if (localName(node) === name) return node;
    node = node.parentElement;
  }
  return null;
}

// --- Rendering ---------------------------------------------------------

function addParcel(parsed) {
  const exteriorRings = parsed.rings.filter(r => !r.isInterior).map(r => r.ring);
  const interiorRings = parsed.rings.filter(r => r.isInterior).map(r => r.ring);

  // L.polygon accepts [outer, hole1, hole2, ...] for a single polygon with holes,
  // or an array of such groups for a multi-polygon.
  let latlngs;
  if (exteriorRings.length <= 1) {
    latlngs = [ (exteriorRings[0] || []), ...interiorRings ];
  } else {
    latlngs = exteriorRings.map(r => [r]);
  }

  const layer = L.polygon(latlngs, {
    color: '#c0392b',
    weight: 2,
    fillColor: '#e67e22',
    fillOpacity: 0.15
  });

  const ha = (parsed.areaM2 / 10000).toFixed(4);
  layer.bindPopup(`<strong>${escapeHtml(parsed.ref)}</strong><br>${parsed.areaM2.toFixed(1)} m² (${ha} ha)`);
  layer.on('mouseover', () => layer.setStyle({ weight: 4 }));
  layer.on('mouseout', () => layer.setStyle({ weight: 2 }));

  layer.addTo(parcelLayerGroup);

  parcels.push({ ref: parsed.ref, areaM2: parsed.areaM2, layer });
}

function renderParcelList() {
  const listEl = document.getElementById('parcelList');
  listEl.innerHTML = '';

  parcels.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'parcel-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        parcelLayerGroup.addLayer(p.layer);
      } else {
        parcelLayerGroup.removeLayer(p.layer);
      }
      updateCajetin();
    });

    const ref = document.createElement('span');
    ref.className = 'ref';
    ref.textContent = p.ref;

    const area = document.createElement('span');
    area.className = 'area';
    area.textContent = (p.areaM2 / 10000).toFixed(2) + ' ha';

    row.appendChild(checkbox);
    row.appendChild(ref);
    row.appendChild(area);

    row.addEventListener('click', (e) => {
      if (e.target === checkbox) return;
      map.fitBounds(p.layer.getBounds(), { padding: [40, 40] });
      p.layer.openPopup();
    });

    listEl.appendChild(row);
  });

  const summaryEl = document.getElementById('summary');
  if (parcels.length === 0) {
    summaryEl.textContent = 'Ninguna parcela cargada todavía.';
  } else {
    const totalHa = parcels.reduce((s, p) => s + p.areaM2, 0) / 10000;
    summaryEl.textContent = `${parcels.length} parcelas · ${totalHa.toFixed(2)} ha en total`;
  }
}

function updateCajetin() {
  const fincaName = document.getElementById('fincaName').value.trim() || 'Plano de finca';
  document.getElementById('cajetinFinca').textContent = fincaName;
  document.getElementById('cajetinDate').textContent = new Date().toLocaleDateString('es-ES');

  const visible = parcels.filter(p => parcelLayerGroup.hasLayer(p.layer));
  document.getElementById('cajetinCount').textContent = visible.length || '—';

  if (visible.length) {
    const totalHa = visible.reduce((s, p) => s + p.areaM2, 0) / 10000;
    document.getElementById('cajetinArea').textContent = totalHa.toFixed(2) + ' ha';
  } else {
    document.getElementById('cajetinArea').textContent = '—';
  }
}

function exportCSV() {
  if (parcels.length === 0) return;
  const rows = [['referencia_catastral', 'superficie_m2', 'superficie_ha']];
  parcels.forEach(p => rows.push([p.ref, p.areaM2.toFixed(2), (p.areaM2 / 10000).toFixed(4)]));
  const csv = rows.map(r => r.map(csvEscape).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'parcelas.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = String(value);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
