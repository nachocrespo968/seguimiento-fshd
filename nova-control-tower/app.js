/* NOVA Control Tower — análisis de expediciones en el navegador (sin backend). */
(function () {
  "use strict";

  const OTIF_TARGET = 0.95;
  const PAGE = 50;
  const MIN_SAMPLE = 8; // mínimo de envíos para que un segmento cuente en los insights

  // Alias de cabecera admitidos (normalizados: minúsculas, sin acentos, "_" como separador)
  const ALIASES = {
    id: ["id_expedicion", "expedicion", "id", "shipment_id", "envio", "id_envio"],
    fechaEnvio: ["fecha_envio", "fecha_salida", "ship_date"],
    fechaPrevista: ["fecha_prevista", "fecha_comprometida", "fecha_promesa", "promised_date", "due_date"],
    fechaEntrega: ["fecha_entrega", "fecha_real", "delivery_date", "delivered_date"],
    cliente: ["cliente", "customer", "client"],
    pais: ["pais", "country", "pais_destino", "destino"],
    transportista: ["transportista", "carrier", "operador"],
    pedidas: ["unidades_pedidas", "cantidad_pedida", "qty_ordered", "pedidas"],
    entregadas: ["unidades_entregadas", "cantidad_entregada", "qty_delivered", "entregadas"],
    coste: ["coste_eur", "coste", "costo", "cost", "importe", "coste_envio"],
    incidencia: ["incidencia", "tipo_incidencia", "incident", "incidencia_tipo"],
  };
  const REQUIRED = ["fechaPrevista", "fechaEntrega", "cliente", "pais", "transportista"];

  const $ = (id) => document.getElementById(id);
  const fmtPct = (v) => (v == null ? "–" : (v * 100).toLocaleString("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + "%");
  const fmtNum = (v, d = 1) => (v == null ? "–" : v.toLocaleString("es-ES", { maximumFractionDigits: d, minimumFractionDigits: d }));
  const fmtEur = (v) => (v == null ? "–" : v.toLocaleString("es-ES", { style: "currency", currency: "EUR" }));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let rows = [];
  let filtered = [];
  let sort = { k: "fechaPrevista", asc: false };
  let shown = PAGE;

  /* ---------- Parseo CSV ---------- */
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/, 1)[0];
    const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
    const out = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((f) => f.trim() !== "")) out.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((f) => f.trim() !== "")) out.push(row);
    return out;
  }

  const norm = (s) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  function parseNumber(s) {
    if (s == null) return null;
    s = String(s).trim().replace(/[€\s]/g, "");
    if (!s) return null;
    if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (s.includes(",")) s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // Devuelve días desde epoch (UTC) o null
  function parseDate(s) {
    if (!s) return null;
    s = s.trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    let y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else return null;
    const t = Date.UTC(y, mo - 1, d);
    return Number.isFinite(t) ? Math.round(t / 864e5) : null;
  }
  const dayStr = (n) => (n == null ? "–" : new Date(n * 864e5).toISOString().slice(0, 10));

  function toRecords(table) {
    const header = table[0].map(norm);
    const idx = {};
    for (const [key, names] of Object.entries(ALIASES)) idx[key] = header.findIndex((h) => names.includes(h));
    const missing = REQUIRED.filter((k) => idx[k] < 0);
    if (missing.length) throw new Error("Faltan columnas obligatorias: " + missing.map((k) => ALIASES[k][0]).join(", "));
    const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || "").trim() : "");

    return table.slice(1).map((r, i) => {
      const prev = parseDate(get(r, "fechaPrevista"));
      const ent = parseDate(get(r, "fechaEntrega"));
      const ped = parseNumber(get(r, "pedidas"));
      const entU = parseNumber(get(r, "entregadas"));
      const delivered = prev != null && ent != null;
      const retraso = delivered ? Math.max(0, ent - prev) : null;
      const onTime = delivered ? ent <= prev : null;
      const inFull = ped != null && entU != null ? entU >= ped : delivered ? true : null;
      return {
        id: get(r, "id") || `#${i + 1}`,
        fechaEnvio: parseDate(get(r, "fechaEnvio")),
        fechaPrevista: prev,
        fechaEntrega: ent,
        cliente: get(r, "cliente") || "(sin cliente)",
        pais: get(r, "pais") || "(sin país)",
        transportista: get(r, "transportista") || "(sin transportista)",
        pedidas: ped, entregadas: entU,
        coste: parseNumber(get(r, "coste")),
        incidencia: get(r, "incidencia"),
        delivered, retraso, onTime, inFull,
        otif: delivered ? onTime && inFull : null,
      };
    });
  }

  /* ---------- Métricas ---------- */
  function metrics(list) {
    const del = list.filter((r) => r.delivered);
    const late = del.filter((r) => r.retraso > 0);
    const costs = list.map((r) => r.coste).filter((c) => c != null);
    const inc = list.filter((r) => r.incidencia);
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    return {
      n: list.length,
      delivered: del.length,
      otif: del.length ? del.filter((r) => r.otif).length / del.length : null,
      onTime: del.length ? del.filter((r) => r.onTime).length / del.length : null,
      inFull: del.length ? del.filter((r) => r.inFull).length / del.length : null,
      lateShare: del.length ? late.length / del.length : null,
      delayLate: avg(late.map((r) => r.retraso)),
      delayAll: avg(del.map((r) => r.retraso)),
      cost: avg(costs),
      incShare: list.length ? inc.length / list.length : null,
      incCount: inc.length,
    };
  }

  function groupBy(list, key) {
    const m = new Map();
    for (const r of list) {
      if (!m.has(r[key])) m.set(r[key], []);
      m.get(r[key]).push(r);
    }
    return [...m.entries()].map(([name, items]) => ({ name, items, ...metrics(items) }));
  }

  /* ---------- Render ---------- */
  function statusBadge(v) {
    if (v == null) return "";
    const s = v >= OTIF_TARGET ? ["var(--good)", "En objetivo"] : v >= OTIF_TARGET - 0.05 ? ["var(--warning)", "En riesgo"] : ["var(--critical)", "Bajo objetivo"];
    return `<span class="badge"><span class="dot" style="background:${s[0]}"></span>${s[1]}</span>`;
  }

  function renderKpis(m) {
    $("kOtif").textContent = fmtPct(m.otif);
    $("kOtifFoot").innerHTML = `${statusBadge(m.otif)} On time ${fmtPct(m.onTime)} · In full ${fmtPct(m.inFull)}`;
    $("kDelay").textContent = m.delayLate == null ? "0,0 d" : fmtNum(m.delayLate) + " d";
    $("kDelayFoot").textContent = `en envíos tardíos (${fmtPct(m.lateShare)}) · ${fmtNum(m.delayAll ?? 0, 2)} d sobre el total`;
    $("kCost").textContent = fmtEur(m.cost);
    $("kCostFoot").textContent = `${m.n.toLocaleString("es-ES")} envíos · ${m.delivered.toLocaleString("es-ES")} entregados`;
    $("kInc").textContent = fmtPct(m.incShare);
    $("kIncFoot").textContent = `${m.incCount.toLocaleString("es-ES")} incidencias registradas`;
  }

  function barChart(el, data, { max, target, value, sub, tip, ticks = [0, 0.25, 0.5, 0.75, 1] }) {
    if (!data.length) { el.innerHTML = `<p class="muted">Sin datos para la selección actual.</p>`; return; }
    const rowsHtml = data.map((d, i) => {
      const w = Math.max(0, Math.min(100, (d.v / max) * 100));
      return `<div class="bar-row" data-i="${i}" tabindex="0">
        <span class="bar-label" title="${esc(d.name)}">${esc(d.name)}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${w}%"></div>
          ${target != null ? `<div class="bar-target" style="left:${(target / max) * 100}%"></div>` : ""}
        </div>
        <span class="bar-value">${value(d)}${sub ? `<span class="bar-sub">${sub(d)}</span>` : ""}</span>
      </div>`;
    }).join("");
    const tickHtml = ticks.map((t) => `<span>${tip.axis(t * max)}</span>`).join("");
    el.innerHTML = rowsHtml + `<div class="axis"><span></span><div class="axis-scale">${tickHtml}</div><span></span></div>`;
    el.querySelectorAll(".bar-row").forEach((row) => {
      const d = data[+row.dataset.i];
      const show = (x, y) => showTip(tip.html(d), x, y);
      row.addEventListener("mousemove", (e) => show(e.clientX, e.clientY));
      row.addEventListener("mouseleave", hideTip);
      row.addEventListener("focus", () => { const b = row.getBoundingClientRect(); show(b.left + b.width / 2, b.top); });
      row.addEventListener("blur", hideTip);
    });
  }

  function renderCharts(list) {
    const byCarrier = groupBy(list, "transportista").filter((g) => g.otif != null).sort((a, b) => b.otif - a.otif);
    $("targetLbl").textContent = fmtPct(OTIF_TARGET);
    barChart($("chartOtif"), byCarrier.map((g) => ({ ...g, v: g.otif })), {
      max: 1, target: OTIF_TARGET,
      value: (d) => fmtPct(d.v),
      sub: (d) => `${d.delivered} env.`,
      tip: {
        axis: (v) => Math.round(v * 100) + "%",
        html: (d) => `<b>${esc(d.name)}</b>OTIF ${fmtPct(d.otif)} (${d.otif >= OTIF_TARGET ? "en objetivo" : "bajo objetivo"})<br>On time ${fmtPct(d.onTime)} · In full ${fmtPct(d.inFull)}<br>Retraso medio ${fmtNum(d.delayLate ?? 0)} d · Coste ${fmtEur(d.cost)}<br>${d.delivered} envíos entregados`,
      },
    });

    const counts = new Map();
    list.forEach((r) => r.incidencia && counts.set(r.incidencia, (counts.get(r.incidencia) || 0) + 1));
    const total = [...counts.values()].reduce((s, v) => s + v, 0);
    const incData = [...counts.entries()].map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
    const maxInc = incData.length ? niceMax(incData[0].v) : 1;
    barChart($("chartInc"), incData, {
      max: maxInc,
      ticks: [0, 0.5, 1],
      value: (d) => d.v.toLocaleString("es-ES"),
      sub: (d) => fmtPct(d.v / total),
      tip: {
        axis: (v) => Math.round(v).toLocaleString("es-ES"),
        html: (d) => `<b>${esc(d.name)}</b>${d.v} incidencias · ${fmtPct(d.v / total)} del total`,
      },
    });
  }

  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 4, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  /* ---------- AI Insight (motor de reglas sobre los datos filtrados) ---------- */
  const INCIDENT_ACTIONS = [
    [/retras|transit|tránsito/i, "Activar alertas proactivas de tránsito y exigir al transportista ETA actualizada a las 24 h de la salida."],
    [/dañ|rotur|damage/i, "Auditar embalaje y manipulación en origen; reclamar a los transportistas los daños documentados."],
    [/direcc|address/i, "Validar direcciones en la captura del pedido (normalización + geocodificación) antes de emitir la etiqueta."],
    [/parcial|in.?full|falta/i, "Reforzar el control de picking y la verificación de bultos antes de la expedición."],
    [/aduan|custom/i, "Revisar documentación aduanera (EORI, HS codes, facturas) y preparar pre-clearance en los destinos afectados."],
  ];

  function buildInsights(list) {
    const g = metrics(list);
    const cands = [];
    if (!g.delivered) return { findings: ["No hay envíos entregados en la selección actual."], actions: ["Amplía los filtros o carga un CSV con fechas de entrega."] };

    const carriers = groupBy(list, "transportista").filter((c) => c.delivered >= MIN_SAMPLE && c.otif != null);
    if (carriers.length >= 2) {
      const sorted = [...carriers].sort((a, b) => a.otif - b.otif);
      const worst = sorted[0], best = sorted[sorted.length - 1];
      const gap = g.otif - worst.otif;
      if (gap > 0.01) cands.push({
        score: gap * worst.delivered,
        f: `<strong>${esc(worst.name)}</strong> es el transportista con peor OTIF: <strong>${fmtPct(worst.otif)}</strong> (${fmtNum(gap * 100)} pp por debajo de la media) sobre ${worst.delivered} envíos.`,
        a: `Abrir revisión de SLA con <strong>${esc(worst.name)}</strong> y trasladar volumen crítico a <strong>${esc(best.name)}</strong> (OTIF ${fmtPct(best.otif)}) mientras no recupere el ${fmtPct(OTIF_TARGET)}.`,
      });
      const withCost = carriers.filter((c) => c.cost != null);
      if (withCost.length >= 2 && g.cost) {
        const pricey = [...withCost].sort((a, b) => b.cost - a.cost)[0];
        const premium = pricey.cost / g.cost - 1;
        const cheaperBetter = withCost.filter((c) => c !== pricey && c.cost < pricey.cost && c.otif >= pricey.otif).sort((a, b) => a.cost - b.cost)[0];
        if (premium > 0.1) cands.push({
          score: premium * pricey.n * 0.3 * (cheaperBetter ? 1.3 : 1),
          f: `<strong>${esc(pricey.name)}</strong> cuesta <strong>${fmtEur(pricey.cost)}</strong> por envío, un ${fmtNum(premium * 100, 0)}% más que la media (${fmtEur(g.cost)})${cheaperBetter ? `, sin mejor servicio que ${esc(cheaperBetter.name)}` : ""}.`,
          a: cheaperBetter
            ? `Renegociar tarifas con <strong>${esc(pricey.name)}</strong> o reasignar carga a <strong>${esc(cheaperBetter.name)}</strong>: ahorro potencial ≈ ${fmtEur((pricey.cost - cheaperBetter.cost) * pricey.n)} en el periodo.`
            : `Lanzar una licitación de tarifas para las rutas de <strong>${esc(pricey.name)}</strong> usando su OTIF (${fmtPct(pricey.otif)}) como palanca de negociación.`,
        });
      }
    }

    const countries = groupBy(list, "pais").filter((c) => c.delivered >= MIN_SAMPLE && c.otif != null);
    if (countries.length >= 2) {
      const worst = [...countries].sort((a, b) => a.otif - b.otif)[0];
      const gap = g.otif - worst.otif;
      if (gap > 0.01) cands.push({
        score: gap * worst.delivered * 0.9,
        f: `<strong>${esc(worst.name)}</strong> es el destino más problemático: OTIF <strong>${fmtPct(worst.otif)}</strong> y ${fmtNum(worst.delayLate ?? 0)} días de retraso medio en entregas tardías.`,
        a: `Ajustar el lead time prometido a <strong>${esc(worst.name)}</strong> (+${Math.max(1, Math.round(worst.delayLate ?? 1))} d) o revisar el hub/ruta de salida hacia ese país.`,
      });
    }

    const clients = groupBy(list, "cliente").filter((c) => c.delivered >= MIN_SAMPLE && c.otif != null);
    if (clients.length >= 2) {
      const worst = [...clients].sort((a, b) => a.otif - b.otif)[0];
      const gap = g.otif - worst.otif;
      if (gap > 0.02) cands.push({
        score: gap * worst.delivered * 0.8,
        f: `El cliente <strong>${esc(worst.name)}</strong> recibe el peor servicio: OTIF <strong>${fmtPct(worst.otif)}</strong> frente a ${fmtPct(g.otif)} global.`,
        a: `Comunicar proactivamente a <strong>${esc(worst.name)}</strong> un plan de mejora y priorizar sus pedidos con el transportista de mejor OTIF.`,
      });
    }

    const counts = new Map();
    list.forEach((r) => r.incidencia && counts.set(r.incidencia, (counts.get(r.incidencia) || 0) + 1));
    const total = [...counts.values()].reduce((s, v) => s + v, 0);
    if (total) {
      const [type, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      const share = n / total;
      const action = (INCIDENT_ACTIONS.find(([re]) => re.test(type)) || [null, `Analizar causa raíz de «${esc(type)}» con los transportistas implicados y fijar un objetivo de reducción.`])[1];
      cands.push({
        score: share * n * 0.7,
        f: `<strong>«${esc(type)}»</strong> concentra el <strong>${fmtPct(share)}</strong> de las incidencias (${n} de ${total}).`,
        a: action,
      });
    }

    if (g.inFull != null && g.inFull < 0.97) cands.push({
      score: (1 - g.inFull) * g.delivered * 0.5,
      f: `El cumplimiento <strong>in full</strong> es del ${fmtPct(g.inFull)}: las entregas incompletas restan OTIF aunque lleguen a tiempo.`,
      a: `Introducir un checkpoint de cantidades en el muelle de carga y medir in-full por almacén de origen.`,
    });

    cands.sort((a, b) => b.score - a.score);
    const top = cands.slice(0, 3);
    if (top.length < 3) top.push({
      f: `OTIF global del <strong>${fmtPct(g.otif)}</strong> ${g.otif >= OTIF_TARGET ? "por encima" : "por debajo"} del objetivo (${fmtPct(OTIF_TARGET)}).`,
      a: g.otif >= OTIF_TARGET ? "Mantener el seguimiento semanal y elevar el objetivo OTIF un punto en el próximo trimestre." : "Instaurar una revisión semanal de OTIF con transportistas y un plan de acción por segmento.",
    });
    return { findings: top.slice(0, 3).map((c) => c.f), actions: top.slice(0, 3).map((c) => c.a) };
  }

  function renderInsights(list) {
    const { findings, actions } = buildInsights(list);
    $("findings").innerHTML = findings.map((f) => `<li>${f}</li>`).join("");
    $("actions").innerHTML = actions.map((a) => `<li>${a}</li>`).join("");
  }

  /* ---------- Tabla ---------- */
  function renderTable() {
    const k = sort.k, dir = sort.asc ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      let x = a[k], y = b[k];
      if (k === "otif") { x = x == null ? -1 : +x; y = y == null ? -1 : +y; }
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y, "es") : x - y) * dir;
    });
    const otifCell = (r) => r.otif == null
      ? `<span class="pill muted">Pendiente</span>`
      : r.otif
        ? `<span class="pill"><span class="dot" style="background:var(--good)"></span>Sí</span>`
        : `<span class="pill"><span class="dot" style="background:var(--critical)"></span>No${!r.onTime ? " · tarde" : ""}${!r.inFull ? " · incompleto" : ""}</span>`;
    $("table").querySelector("tbody").innerHTML = sorted.slice(0, shown).map((r) => `<tr>
      <td>${esc(r.id)}</td><td>${esc(r.cliente)}</td><td>${esc(r.pais)}</td><td>${esc(r.transportista)}</td>
      <td>${dayStr(r.fechaPrevista)}</td><td>${dayStr(r.fechaEntrega)}</td>
      <td class="num">${r.retraso == null ? "–" : r.retraso}</td>
      <td class="num">${r.coste == null ? "–" : fmtNum(r.coste, 2)}</td>
      <td>${otifCell(r)}</td><td>${r.incidencia ? esc(r.incidencia) : '<span class="muted">—</span>'}</td>
    </tr>`).join("") || `<tr><td colspan="10" class="muted">Sin resultados</td></tr>`;
    $("tableCount").textContent = `${Math.min(shown, sorted.length).toLocaleString("es-ES")} de ${sorted.length.toLocaleString("es-ES")} expediciones`;
    $("moreBtn").hidden = shown >= sorted.length;
    $("table").querySelectorAll("th").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.k === k);
      th.classList.toggle("asc", th.dataset.k === k && sort.asc);
    });
  }

  /* ---------- Filtros ---------- */
  const FILTERS = [["fCliente", "cliente", "Todos los clientes"], ["fPais", "pais", "Todos los países"], ["fTransportista", "transportista", "Todos los transportistas"]];

  function fillFilters() {
    for (const [id, key, label] of FILTERS) {
      const vals = [...new Set(rows.map((r) => r[key]))].sort((a, b) => a.localeCompare(b, "es"));
      $(id).innerHTML = `<option value="">${label}</option>` + vals.map((v) => `<option>${esc(v)}</option>`).join("");
    }
  }

  function applyFilters() {
    const sel = FILTERS.map(([id, key]) => [key, $(id).value]);
    filtered = rows.filter((r) => sel.every(([k, v]) => !v || r[k] === v));
    shown = PAGE;
    renderKpis(metrics(filtered));
    renderCharts(filtered);
    renderInsights(filtered);
    renderTable();
  }

  /* ---------- Tooltip ---------- */
  const tipEl = $("tooltip");
  function showTip(html, x, y) {
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 12)) + "px";
    tipEl.style.top = Math.max(8, y - h - 12) + "px";
  }
  function hideTip() { tipEl.hidden = true; }

  /* ---------- Carga ---------- */
  function load(text, name) {
    $("errorMsg").textContent = "";
    try {
      const table = parseCSV(text);
      if (table.length < 2) throw new Error("El CSV no contiene filas de datos.");
      rows = toRecords(table);
      fillFilters();
      $("emptyState").hidden = true;
      $("dashboard").hidden = false;
      $("datasetInfo").textContent = `${name} · ${rows.length.toLocaleString("es-ES")} expediciones`;
      applyFilters();
    } catch (e) {
      $("dashboard").hidden = true;
      $("emptyState").hidden = false;
      $("errorMsg").textContent = "No se pudo leer el archivo: " + e.message;
    }
  }

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => load(reader.result, file.name);
    reader.readAsText(file, "utf-8");
  }

  $("fileInput").addEventListener("change", (e) => { readFile(e.target.files[0]); e.target.value = ""; });
  $("sampleBtn").addEventListener("click", () => load(window.NOVA_SAMPLE_CSV || "", "ejemplo_expediciones.csv"));
  $("resetBtn").addEventListener("click", () => { FILTERS.forEach(([id]) => ($(id).value = "")); applyFilters(); });
  FILTERS.forEach(([id]) => $(id).addEventListener("change", applyFilters));
  $("moreBtn").addEventListener("click", () => { shown += PAGE; renderTable(); });
  $("table").querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th) return;
    sort = sort.k === th.dataset.k ? { k: sort.k, asc: !sort.asc } : { k: th.dataset.k, asc: true };
    renderTable();
  });

  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; $("dropOverlay").hidden = false; });
  window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("dropOverlay").hidden = true; } });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault(); dragDepth = 0; $("dropOverlay").hidden = true;
    readFile(e.dataTransfer.files[0]);
  });
})();
