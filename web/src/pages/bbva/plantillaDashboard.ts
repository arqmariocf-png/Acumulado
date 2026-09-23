// Plantilla HTML del panel de control BBVA (mantenimiento). Se renderiza
// dentro de un <iframe srcDoc>: es la forma más rápida de reusar tal cual el
// diseño ya validado con Mario en el análisis del Excel, sin reescribir toda
// la lógica de gráficas/tablas en componentes React, y sin perder fidelidad
// visual. El placeholder __DATOS_JSON__ se reemplaza por el snapshot real
// (tabla bbva_mantenimiento_snapshots.datos) en tiempo de carga.

export function generarHtmlDashboard(datos: unknown): string {
  return PLANTILLA.replace("__DATOS_JSON__", JSON.stringify(datos));
}

const PLANTILLA = /* html */ `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found]){display:none!important}</style></head><body>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#F3F4F6; --surface:#FFFFFF; --surface-2:#ECEEF1; --surface-3:#E4E7EC;
    --border:#E1E4E9; --border-strong:#CBD0D8;
    --ink:#1A1D23; --ink-2:#4B505C; --ink-3:#868C97;
    --accent:#C96A2E; --accent-ink:#7A3E17; --accent-soft:#F3E2D2;
    --good:#0ca30c; --warning:#fab219; --serious:#ec835a; --critical:#d03b3b;
    --shadow: 0 1px 2px rgba(20,22,27,.04), 0 8px 24px -12px rgba(20,22,27,.12);
    --radius: 10px;
    color-scheme: light;
  }
  *{ box-sizing:border-box; }
  body{
    margin:0; background:var(--bg); color:var(--ink);
    font-family:"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
    font-size:14px; line-height:1.5;
    -webkit-font-smoothing:antialiased;
  }
  .mono{ font-family:"IBM Plex Mono", ui-monospace, "SF Mono", monospace; font-variant-numeric:tabular-nums; }
  .wrap{ max-width:1240px; margin:0 auto; padding:28px 24px 80px; }

  .masthead{
    display:flex; justify-content:space-between; align-items:flex-end; gap:20px;
    flex-wrap:wrap; margin-bottom:22px; padding-bottom:18px; border-bottom:1px solid var(--border);
  }
  .masthead h1{ margin:0 0 6px; font-size:22px; font-weight:700; letter-spacing:-0.01em; }
  .masthead .eyebrow{
    font-family:"IBM Plex Mono"; font-size:11px; letter-spacing:.09em; text-transform:uppercase;
    color:var(--accent-ink); font-weight:600; margin-bottom:8px; display:flex; align-items:center; gap:8px;
  }
  .masthead .eyebrow::before{ content:""; width:7px; height:7px; border-radius:50%; background:var(--accent); display:inline-block; }
  .masthead p{ margin:0; color:var(--ink-2); max-width:60ch; font-size:13px; }
  .masthead .meta{ text-align:right; color:var(--ink-3); font-size:12px; font-family:"IBM Plex Mono"; line-height:1.7; }
  .masthead .meta b{ color:var(--ink-2); font-weight:600; }

  .kpi-grid{
    display:grid; grid-template-columns:repeat(6,1fr); gap:1px;
    background:var(--border); border:1px solid var(--border); border-radius:var(--radius);
    overflow:hidden; margin-bottom:28px; box-shadow:var(--shadow);
  }
  .kpi{ background:var(--surface); padding:16px 16px 14px; display:flex; flex-direction:column; gap:6px; min-width:0; }
  .kpi .label{ font-size:11px; color:var(--ink-3); text-transform:uppercase; letter-spacing:.06em; font-weight:600; }
  .kpi .value{ font-family:"IBM Plex Mono"; font-size:22px; font-weight:600; letter-spacing:-0.01em; white-space:nowrap; }
  .kpi .sub{ font-size:11.5px; color:var(--ink-2); }
  .kpi .sub.crit{ color:var(--critical); font-weight:600; }
  .kpi .sub.good{ color:var(--good); font-weight:600; }

  @media (max-width:980px){ .kpi-grid{ grid-template-columns:repeat(3,1fr); } }
  @media (max-width:600px){ .kpi-grid{ grid-template-columns:repeat(2,1fr); } }

  section{ margin-bottom:28px; }
  .section-head{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:12px; gap:12px; flex-wrap:wrap; }
  .section-head h2{ margin:0; font-size:15px; font-weight:600; }
  .section-head .hint{ font-size:12px; color:var(--ink-3); }
  .panel{
    background:var(--surface); border:1px solid var(--border); border-radius:var(--radius);
    padding:18px 20px; box-shadow:var(--shadow);
  }
  .grid-2{ display:grid; grid-template-columns:1.1fr 1fr; gap:18px; align-items:stretch; }
  @media (max-width:900px){ .grid-2{ grid-template-columns:1fr; } }

  .stepper{ display:flex; overflow-x:auto; gap:0; padding-bottom:4px; }
  .step{ flex:1 0 118px; position:relative; padding:0 14px 0 0; }
  .step .bar{ height:5px; border-radius:3px; background:var(--surface-3); position:relative; margin-bottom:10px; }
  .step .bar::after{ content:""; position:absolute; inset:0; background:var(--accent); border-radius:3px; opacity:.85; }
  .step .n{ font-family:"IBM Plex Mono"; font-size:10.5px; color:var(--ink-3); }
  .step .name{ font-size:12.5px; font-weight:600; margin:2px 0 3px; }
  .step .dur{ font-size:11px; color:var(--ink-2); font-family:"IBM Plex Mono"; }
  .step:not(:last-child)::before{ content:"›"; position:absolute; right:-2px; top:0; color:var(--border-strong); font-size:16px; }
  .stepper-foot{ margin-top:10px; padding-top:10px; border-top:1px dashed var(--border); display:flex; justify-content:space-between; font-size:12px; color:var(--ink-2); }
  .stepper-foot b{ color:var(--ink); font-family:"IBM Plex Mono"; }

  .barlist{ display:flex; flex-direction:column; gap:9px; }
  .barrow{ display:grid; grid-template-columns:168px 1fr 88px; align-items:center; gap:10px; }
  .barrow .rlabel{ font-size:12px; color:var(--ink-2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .barrow .rtrack{ height:16px; background:var(--surface-2); border-radius:4px; position:relative; overflow:hidden; }
  .barrow .rfill{ height:100%; background:var(--accent); border-radius:4px; transition:filter .15s; }
  .barrow:hover .rfill{ filter:brightness(1.08); }
  .barrow .rval{ font-family:"IBM Plex Mono"; font-size:11.5px; color:var(--ink); text-align:right; white-space:nowrap; }
  .barrow .rcount{ color:var(--ink-3); font-size:10.5px; }

  .monthchart{ display:flex; align-items:flex-end; gap:10px; height:150px; padding-top:6px; }
  .mbar-col{ flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; height:100%; justify-content:flex-end; position:relative; }
  .mbar{ width:100%; max-width:34px; background:var(--accent); border-radius:4px 4px 2px 2px; position:relative; cursor:default; }
  .mbar:hover{ filter:brightness(1.08); }
  .mbar .tip{
    position:absolute; bottom:calc(100% + 8px); left:50%; transform:translateX(-50%);
    background:var(--ink); color:var(--bg); font-family:"IBM Plex Mono"; font-size:10.5px;
    padding:5px 8px; border-radius:6px; white-space:nowrap; opacity:0; pointer-events:none; transition:opacity .12s;
    box-shadow:var(--shadow); z-index:5;
  }
  .mbar:hover .tip{ opacity:1; }
  .mbar-col .mlabel{ font-size:10.5px; color:var(--ink-3); font-family:"IBM Plex Mono"; }

  .pill{ display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:600; padding:3px 9px 3px 7px; border-radius:99px; background:var(--surface-2); color:var(--ink-2); white-space:nowrap; }
  .pill svg{ flex:none; }
  .pill.good{ color:var(--ink); } .pill.good svg circle{ fill:var(--good); }
  .pill.warning{ color:var(--ink); } .pill.warning svg polygon{ fill:var(--warning); }
  .pill.serious{ color:var(--ink); } .pill.serious svg polygon{ fill:var(--serious); }
  .pill.critical{ color:var(--ink); } .pill.critical svg rect{ fill:var(--critical); }
  .pill.accent{ background:var(--accent-soft); color:var(--accent-ink); }

  .cmp-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--border); border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  @media (max-width:900px){ .cmp-grid{ grid-template-columns:repeat(2,1fr); } }
  .cmp-cell{ background:var(--surface); padding:12px 14px; display:flex; flex-direction:column; gap:4px; }
  .cmp-cell .lbl{ font-size:10.5px; color:var(--ink-3); text-transform:uppercase; letter-spacing:.05em; font-weight:600; }
  .cmp-cell .vals{ display:flex; align-items:baseline; gap:7px; font-family:"IBM Plex Mono"; }
  .cmp-cell .before{ font-size:12px; color:var(--ink-3); text-decoration:line-through; }
  .cmp-cell .after{ font-size:16px; font-weight:600; color:var(--ink); }
  .cmp-cell .delta{ font-size:11px; font-weight:600; }
  .cmp-cell .delta.up{ color:var(--good); } .cmp-cell .delta.down{ color:var(--critical); } .cmp-cell .delta.flat{ color:var(--ink-3); }

  .sup-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  @media (max-width:900px){ .sup-grid{ grid-template-columns:repeat(2,1fr); } }
  .sup-card{ border:1px solid var(--border); border-radius:8px; padding:14px; background:var(--surface); display:flex; flex-direction:column; gap:8px; }
  .sup-card .name{ font-weight:600; font-size:13.5px; }
  .sup-card .row{ display:flex; justify-content:space-between; font-size:12px; color:var(--ink-2); }
  .sup-card .row b{ font-family:"IBM Plex Mono"; color:var(--ink); font-weight:600; }
  .sup-card .meter{ height:6px; background:var(--surface-2); border-radius:3px; overflow:hidden; margin-top:2px;}
  .sup-card .meter i{ display:block; height:100%; background:var(--good); }
  .sup-card .flag{ margin-top:2px; }

  table.worklist{ width:100%; border-collapse:collapse; font-size:12.5px; }
  table.worklist th{
    text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-3);
    font-weight:600; padding:0 10px 8px; border-bottom:1px solid var(--border); white-space:nowrap;
  }
  table.worklist td{ padding:9px 10px; border-bottom:1px solid var(--border); vertical-align:top; }
  table.worklist tr:last-child td{ border-bottom:none; }
  table.worklist tr:hover td{ background:var(--surface-2); }
  table.worklist td.num{ font-family:"IBM Plex Mono"; white-space:nowrap; }
  table.worklist td.desc{ color:var(--ink-2); max-width:340px; }
  .tablewrap{ overflow-x:auto; }
  .days-bar{ display:inline-block; width:54px; height:6px; background:var(--surface-2); border-radius:3px; overflow:hidden; vertical-align:middle; margin-right:8px; }
  .days-bar i{ display:block; height:100%; }

  .note{
    display:flex; gap:10px; align-items:flex-start; background:var(--accent-soft); border:1px solid var(--border);
    border-radius:8px; padding:11px 13px; font-size:12px; color:var(--ink-2); margin-top:12px;
  }
  .note .ico{ flex:none; color:var(--accent-ink); font-family:"IBM Plex Mono"; font-weight:700; font-size:13px; }

  .empty{
    border:1px dashed var(--border-strong); border-radius:8px; padding:22px 20px; text-align:left;
    display:grid; grid-template-columns:1fr auto; gap:20px; align-items:center;
  }
  @media (max-width:760px){ .empty{ grid-template-columns:1fr; } }
  .empty h3{ margin:0 0 6px; font-size:14px; }
  .empty p{ margin:0 0 10px; color:var(--ink-2); font-size:12.5px; max-width:56ch; }
  .fieldpills{ display:flex; flex-wrap:wrap; gap:6px; }
  .fieldpills span{ font-family:"IBM Plex Mono"; font-size:11px; background:var(--surface-2); border:1px solid var(--border); padding:3px 8px; border-radius:6px; color:var(--ink-2); }
  .fieldpills span.new{ border-color:var(--accent); color:var(--accent-ink); background:var(--accent-soft); }

  footer{ margin-top:36px; padding-top:16px; border-top:1px solid var(--border); color:var(--ink-3); font-size:11.5px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; }
  footer .src{ font-family:"IBM Plex Mono"; }

  ::selection{ background:var(--accent-soft); }
</style>

<div class="wrap">
  <div class="masthead">
    <div>
      <div class="eyebrow">Constructora Loma · Mantenimiento BBVA</div>
      <h1>Control de folios y pagos — Puebla-Tlaxcala</h1>
      <p>Lectura del flujo folio → ejecución → conciliación con supervisor → pago, a partir del maestro de folios que ya lleva el equipo. Cuadrillas y rendimiento de personal se activan cuando esa captura empiece.</p>
    </div>
    <div class="meta" id="mastheadMeta"></div>
  </div>

  <div class="kpi-grid" id="kpiGrid"></div>

  <section id="compareSection" hidden>
    <div class="section-head">
      <h2>Antes vs. después de esta actualización</h2>
      <span class="hint">corte anterior vs. corte actual, con el maestro nuevo</span>
    </div>
    <div class="panel"><div id="compareBlock"></div></div>
  </section>

  <section>
    <div class="section-head">
      <h2>Mantenimiento vs. Obra Menor</h2>
      <span class="hint">son procesos distintos — folio GMI y ruta a Adquira solo aplican a Mantenimiento</span>
    </div>
    <div class="panel"><div id="procesoBlock"></div></div>
  </section>

  <section>
    <div class="section-head">
      <h2>Reporte mensual — Mantenimiento</h2>
      <span class="hint" id="mesMantHint">folios, pagado, pendiente y ciclo de cobro, mes a mes</span>
    </div>
    <div class="panel" style="padding:14px 8px 6px;">
      <div class="tablewrap">
        <table class="worklist">
          <thead><tr>
            <th>Mes</th>
            <th style="text-align:right">Folios</th>
            <th style="text-align:right">Monto</th>
            <th style="text-align:right">Pagados</th>
            <th style="text-align:right">Pendientes</th>
            <th style="text-align:right">Monto pendiente</th>
            <th style="text-align:right">Ciclo folio→pago</th>
          </tr></thead>
          <tbody id="mesMantBody"></tbody>
        </table>
      </div>
    </div>
  </section>

  <section>
    <div class="section-head">
      <h2>Reporte mensual — Obra Menor</h2>
      <span class="hint" id="mesObraHint">proceso aparte: tiempos distintos a Mantenimiento</span>
    </div>
    <div class="panel" style="padding:14px 8px 6px;">
      <div class="tablewrap">
        <table class="worklist">
          <thead><tr>
            <th>Mes</th>
            <th style="text-align:right">Folios</th>
            <th style="text-align:right">Monto</th>
            <th style="text-align:right">Pagados</th>
            <th style="text-align:right">Pendientes</th>
            <th style="text-align:right">Monto pendiente</th>
            <th style="text-align:right">Ciclo folio→pago</th>
          </tr></thead>
          <tbody id="mesObraBody"></tbody>
        </table>
      </div>
    </div>
  </section>

  <section>
    <div class="section-head">
      <h2>Proceso documentado (PROCESO BBVA.xlsx)</h2>
      <span class="hint">Objetivo máximo: 7 semanas de folio a pago</span>
    </div>
    <div class="panel">
      <div class="stepper" id="stepper"></div>
      <div class="stepper-foot">
        <span>Ciclo real observado (folios ya pagados): <b id="ciclotxt">—</b></span>
        <span>Objetivo documentado: <b>49 días</b></span>
      </div>
    </div>
  </section>

  <section>
    <div class="grid-2">
      <div class="panel">
        <div class="section-head"><h2>Monto facturado por mes</h2><span class="hint">2026</span></div>
        <div class="monthchart" id="monthChart"></div>
      </div>
      <div class="panel">
        <div class="section-head"><h2>Pagado vs. pendiente</h2><span class="hint" id="totalFoliosHint"></span></div>
        <div id="statusBlock"></div>
      </div>
    </div>
  </section>

  <section>
    <div class="grid-2">
      <div class="panel">
        <div class="section-head"><h2>Monto por especialidad</h2><span class="hint">propuesta, ver nota</span></div>
        <div class="barlist" id="specBars"></div>
        <div class="note"><span class="ico">i</span><span>Especialidad sugerida automáticamente a partir del catálogo de conceptos (claves como C4-038, G5-…) del generador de obra. Ningún folio la trae capturada hoy — valídala con tu equipo antes de usarla para repartir cuadrillas.</span></div>
      </div>
      <div class="panel">
        <div class="section-head"><h2>Top sucursales por monto</h2><span class="hint" id="sucursalesHint"></span></div>
        <div class="barlist" id="sucBars"></div>
      </div>
    </div>
  </section>

  <section>
    <div class="section-head"><h2>Por supervisor de sucursal (BBVA)</h2><span class="hint">a quién dar seguimiento primero</span></div>
    <div class="sup-grid" id="supGrid"></div>
  </section>

  <section>
    <div class="section-head"><h2>Cobertura de facturación (Adquira)</h2><span class="hint">solo si el folio ya tiene factura vinculada — sin estatus interno de su plataforma</span></div>
    <div class="panel"><div id="adquiraBlock"></div></div>
  </section>

  <section>
    <div class="section-head"><h2>Conciliación por pedido</h2><span class="hint">1 pedido puede agrupar varios folios</span></div>
    <div class="panel"><div id="conciliacionBlock"></div></div>
  </section>

  <section id="qaNotasSection">
    <div class="section-head"><h2>Notas de calidad de datos</h2><span class="hint">detectadas al procesar el maestro, revisar con el equipo</span></div>
    <div id="qaNotasBlock"></div>
  </section>

  <section>
    <div class="section-head"><h2>Folios más antiguos esperando al supervisor</h2><span class="hint">con más días desde apertura, sin pago</span></div>
    <div class="panel" style="padding:14px 8px 6px;">
      <div class="tablewrap">
        <table class="worklist">
          <thead><tr>
            <th>Días</th><th>Folio</th><th>Sucursal</th><th>Supervisor</th><th>Descripción</th><th>Proceso</th><th style="text-align:right">Monto</th>
          </tr></thead>
          <tbody id="worklistBody"></tbody>
        </table>
      </div>
    </div>
  </section>

  <section>
    <div class="section-head"><h2>Cuadrillas y rendimiento de personal</h2></div>
    <div class="panel empty">
      <div>
        <h3>Todavía no existe en ningún archivo</h3>
        <p>Hoy ni la especialidad ni la cuadrilla o persona responsable de cada folio se registran en Excel. Para que esta sección muestre rendimiento (folios cerrados, tiempo promedio, monto por cuadrilla), hay que empezar a capturar estos campos por folio:</p>
        <div class="fieldpills">
          <span>Folio</span><span>Sucursal</span><span class="new">Especialidad</span><span class="new">Cuadrilla</span><span class="new">Responsable</span><span>Fecha inicio</span><span>Fecha cierre</span>
        </div>
      </div>
    </div>
  </section>

  <footer>
    <span>Especialidad clasificada por heurística sobre el catálogo de conceptos — pendiente de validar. Nombres de sucursal normalizados desde el archivo fuente.</span>
    <span class="src">Control BBVA · Puebla-Tlaxcala · v1</span>
  </footer>
</div>

<script>
const DATA = __DATOS_JSON__;
const PROCESS = [
  ["1","Asignación de folio","—"],
  ["2","Ejecución","1–2 sem"],
  ["3","Conciliación","1 sem"],
  ["4","Autorización","15 días"],
  ["5","Fichero","1–2 días"],
  ["6","Test de sistema","—"],
  ["7","Envío de fichero","—"],
  ["8","Adquira","2–3 días"],
  ["9","Pagos","12 días"],
];

const fmtMXN = n => "$" + Math.round(n).toLocaleString("es-MX");
const fmtMXNk = n => n>=1000 ? "$"+(n/1000).toFixed(0)+"k" : "$"+Math.round(n);
const pct = (a,b) => b ? Math.round(a/b*100) : 0;

function el(html){ const t=document.createElement("template"); t.innerHTML=html.trim(); return t.content.firstElementChild; }

document.getElementById("mastheadMeta").innerHTML =
  \`Fuente: <b>\${DATA.meta.fuente}</b> + <b>Adquira (facturas emitidas)</b><br>Corte: <b>\${DATA.meta.fecha_corte}</b><br>Región: <b>\${DATA.meta.region}</b>\`;

function renderCompare(){
  if(!DATA.kpi_antes) return;
  const sec = document.getElementById("compareSection");
  sec.hidden = false;
  const wrap = document.getElementById("compareBlock");
  const a = DATA.kpi_antes, b = DATA.kpi;
  const metrics = [
    ["total_folios", "Folios totales", "int", "neutral"],
    ["monto_total", "Monto total", "mxn", "neutral"],
    ["folios_pagados", "Folios pagados", "int", "good_up"],
    ["monto_pagado", "Monto pagado", "mxn", "good_up"],
    ["folios_pendientes", "Folios pendientes", "int", "good_down"],
    ["monto_pendiente", "Monto pendiente", "mxn", "good_down"],
    ["folios_en_revision_supervisor", "En espera de supervisor", "int", "good_down"],
    ["n_sucursales", "Sucursales cubiertas", "int", "neutral"],
  ];
  const grid = document.createElement("div");
  grid.className = "cmp-grid";
  metrics.forEach(([key,label,fmt,dir])=>{
    const va = a[key], vb = b[key];
    const fmtv = v => fmt==="mxn" ? fmtMXNk(v) : v;
    const diff = vb - va;
    let tone = "flat", arrow = "→";
    if(diff !== 0){
      const improved = dir==="good_up" ? diff>0 : dir==="good_down" ? diff<0 : null;
      tone = improved===null ? "flat" : improved ? "up" : "down";
      arrow = diff>0 ? "↑" : "↓";
    }
    const deltaTxt = diff===0 ? "sin cambio" : \`\${arrow} \${fmt==="mxn"?fmtMXNk(Math.abs(diff)):Math.abs(diff)}\`;
    grid.appendChild(el(\`<div class="cmp-cell">
      <div class="lbl">\${label}</div>
      <div class="vals"><span class="before">\${fmtv(va)}</span><span class="after">\${fmtv(vb)}</span></div>
      <div class="delta \${tone}">\${deltaTxt}</div>
    </div>\`));
  });
  wrap.appendChild(grid);
  wrap.appendChild(el(\`<div style="margin-top:12px;font-size:11.5px;color:var(--ink-3)">Tachado = corte anterior · en negro = corte actual, con el maestro de folios que subió el equipo.</div>\`));
}

function renderKPIs(){
  const k = DATA.kpi;
  const pagPct = pct(k.folios_pagados, k.total_folios);
  const items = [
    ["Folios vigentes 2026", k.total_folios, \`\${k.n_sucursales} sucursales\`],
    ["Monto total", fmtMXN(k.monto_total), "MXN, IVA incl."],
    ["Pagado", fmtMXN(k.monto_pagado), \`\${k.folios_pagados} folios · \${pagPct}%\`, "good"],
    ["Pendiente de pago", fmtMXN(k.monto_pendiente), \`\${k.folios_pendientes} folios\`, "crit"],
    ["En revisión c/ supervisor", k.folios_en_revision_supervisor, "soportes enviados, sin pago"],
    ["Ciclo promedio de cobro", k.ciclo_promedio_dias + " días", \`objetivo: \${k.ciclo_objetivo_dias} días\`, k.ciclo_promedio_dias>k.ciclo_objetivo_dias ? "crit":"good"],
  ];
  const grid = document.getElementById("kpiGrid");
  items.forEach(([label,val,sub,tone])=>{
    grid.appendChild(el(\`<div class="kpi">
      <div class="label">\${label}</div>
      <div class="value">\${val}</div>
      <div class="sub \${tone==='crit'?'crit':tone==='good'?'good':''}">\${sub}</div>
    </div>\`));
  });
}

function renderStepper(){
  const s = document.getElementById("stepper");
  PROCESS.forEach(([n,name,dur])=>{
    s.appendChild(el(\`<div class="step">
      <div class="bar"></div>
      <div class="n">PASO \${n}</div>
      <div class="name">\${name}</div>
      <div class="dur">\${dur}</div>
    </div>\`));
  });
  document.getElementById("ciclotxt").textContent = DATA.kpi.ciclo_promedio_dias + " días";
}

function renderMonthChart(){
  const c = document.getElementById("monthChart");
  const entries = Object.entries(DATA.by_month);
  const max = Math.max(...entries.map(([,v])=>v.monto));
  const MESES = {"01":"Ene","02":"Feb","03":"Mar","04":"Abr","05":"May","06":"Jun","07":"Jul","08":"Ago","09":"Sep","10":"Oct","11":"Nov","12":"Dic"};
  entries.forEach(([key,v])=>{
    const [y,m] = key.split("-");
    const h = Math.max(4, Math.round(v.monto/max*118));
    c.appendChild(el(\`<div class="mbar-col">
      <div class="mbar" style="height:\${h}px">
        <div class="tip">\${fmtMXN(v.monto)} · \${v.folios} folios</div>
      </div>
      <div class="mlabel">\${MESES[m]||m}</div>
    </div>\`));
  });
}

function shapeSVG(tone){
  if(tone==="good") return \`<svg width="9" height="9" viewBox="0 0 9 9"><circle cx="4.5" cy="4.5" r="4.5"/></svg>\`;
  if(tone==="warning"||tone==="serious") return \`<svg width="10" height="9" viewBox="0 0 10 9"><polygon points="5,0 10,9 0,9"/></svg>\`;
  return \`<svg width="9" height="9" viewBox="0 0 9 9"><rect width="9" height="9" rx="1.5"/></svg>\`;
}

function renderStatus(){
  const k = DATA.kpi;
  const pagado = k.folios_pagados, pend = k.folios_pendientes;
  const total = k.total_folios;
  const pPagado = total ? pagado/total*100 : 100;
  const wrap = document.getElementById("statusBlock");
  wrap.appendChild(el(\`
    <div style="display:flex;height:26px;border-radius:6px;overflow:hidden;border:1px solid var(--border);margin-bottom:14px;">
      <div style="width:\${pPagado}%;background:var(--good)"></div>
      <div style="width:\${100-pPagado}%;background:var(--serious)"></div>
    </div>
  \`));
  const rows = [
    ["good", "Pagado", pagado, k.monto_pagado],
    ["serious", "Pendiente / en revisión", pend, k.monto_pendiente],
  ];
  rows.forEach(([tone,label,n,monto])=>{
    wrap.appendChild(el(\`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:12.5px;">
      <span class="pill \${tone}">\${shapeSVG(tone)} \${label}</span>
      <span class="mono" style="color:var(--ink-2)">\${n} folios</span>
      <span class="mono" style="font-weight:600">\${fmtMXN(monto)}</span>
    </div>\`));
  });
  wrap.appendChild(el(\`<div style="padding-top:10px;font-size:11.5px;color:var(--ink-3)">De los folios pendientes, <b class="mono" style="color:var(--ink-2)">\${k.folios_en_revision_supervisor}</b> ya tienen soportes enviados y están esperando validación del supervisor de sucursal.</div>\`));
}

function renderBarlist(containerId, entries, {labelKey, montoKey, foliosKey, max}){
  const c = document.getElementById(containerId);
  entries.forEach(e=>{
    const label = e[labelKey], monto = e[montoKey], folios = e[foliosKey];
    const w = Math.max(3, Math.round(monto/max*100));
    c.appendChild(el(\`<div class="barrow">
      <div class="rlabel" title="\${label}">\${label}</div>
      <div class="rtrack"><div class="rfill" style="width:\${w}%"></div></div>
      <div class="rval">\${fmtMXNk(monto)} <span class="rcount">· \${folios}f</span></div>
    </div>\`));
  });
}

function renderSupervisors(){
  const grid = document.getElementById("supGrid");
  const arr = Object.entries(DATA.by_supervisor)
    .filter(([name])=>name!=="Sin Asignar")
    .sort((a,b)=>b[1].en_revision-a[1].en_revision);
  arr.forEach(([name,v])=>{
    const pagPct = pct(v.pagados, v.folios);
    grid.appendChild(el(\`<div class="sup-card">
      <div class="name">\${name}</div>
      <div class="row">Folios <b>\${v.folios}</b></div>
      <div class="row">Monto <b>\${fmtMXNk(v.monto)}</b></div>
      <div class="row">Pagados <b>\${v.pagados}/\${v.folios}</b></div>
      <div class="meter"><i style="width:\${pagPct}%"></i></div>
      <div class="flag"><span class="pill \${v.en_revision>0?'serious':'good'}">\${shapeSVG(v.en_revision>0?'serious':'good')} \${v.en_revision} en espera</span></div>
    </div>\`));
  });
}

function procesoPill(proceso){
  if(proceso==="Obra Menor") return \`<span class="pill accent">Obra Menor</span>\`;
  return \`<span class="pill">Mantenimiento</span>\`;
}

function renderWorklist(){
  const body = document.getElementById("worklistBody");
  DATA.top_pendientes.forEach(r=>{
    const tone = r.dias>150 ? "critical" : r.dias>75 ? "serious" : "warning";
    const barColor = tone==="critical" ? "var(--critical)" : tone==="serious" ? "var(--serious)" : "var(--warning)";
    const barW = Math.min(100, Math.round(r.dias/232*100));
    body.appendChild(el(\`<tr>
      <td class="num"><span class="days-bar"><i style="width:\${barW}%;background:\${barColor}"></i></span>\${r.dias}d</td>
      <td class="num">\${r.folio}</td>
      <td>\${r.sucursal}</td>
      <td>\${r.supervisor}</td>
      <td class="desc">\${r.descripcion}</td>
      <td>\${procesoPill(r.proceso)}</td>
      <td class="num" style="text-align:right">\${fmtMXN(r.monto)}</td>
    </tr>\`));
  });
}

function renderAdquira(){
  const a = DATA.adquira;
  const wrap = document.getElementById("adquiraBlock");
  wrap.appendChild(el(\`<div style="display:flex;gap:22px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-2)">
    <span><b class="mono" style="color:var(--ink)">\${a.folios_con_factura}</b> folios ya con factura en Adquira</span>
    <span><b class="mono" style="color:var(--ink)">\${a.folios_sin_pedido}</b> aún sin número de pedido (no han llegado a Adquira)</span>
    <span><b class="mono" style="color:var(--ink)">\${a.folios_con_pedido_sin_factura}</b> con pedido pero sin factura encontrada</span>
  </div>\`));
}

function renderProceso(){
  const p = DATA.by_proceso;
  const wrap = document.getElementById("procesoBlock");
  const total = p["Mantenimiento"].monto + p["Obra Menor"].monto;
  const wMant = total ? p["Mantenimiento"].monto/total*100 : 100;
  wrap.appendChild(el(\`
    <div style="display:flex;height:22px;border-radius:6px;overflow:hidden;border:1px solid var(--border);margin-bottom:16px;">
      <div style="width:\${wMant}%;background:var(--accent)"></div>
      <div style="width:\${100-wMant}%;background:var(--accent-soft)"></div>
    </div>
  \`));
  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:16px;";
  [["Mantenimiento", p["Mantenimiento"]], ["Obra Menor", p["Obra Menor"]]].forEach(([name,v])=>{
    grid.appendChild(el(\`<div>
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px;">
        \${procesoPill(name)}
        <span style="font-size:11px;color:var(--ink-3)">\${v.folios} folios</span>
      </div>
      <div class="row" style="display:flex;justify-content:space-between;padding:5px 0;font-size:12.5px;"><span style="color:var(--ink-2)">Monto</span><span class="mono" style="font-weight:600">\${fmtMXN(v.monto)}</span></div>
      <div class="row" style="display:flex;justify-content:space-between;padding:5px 0;font-size:12.5px;border-top:1px solid var(--border);"><span style="color:var(--ink-2)">Pagado</span><span class="mono">\${v.pagados}/\${v.folios} · \${fmtMXNk(v.monto_pagado)}</span></div>
      <div class="row" style="display:flex;justify-content:space-between;padding:5px 0;font-size:12.5px;border-top:1px solid var(--border);"><span style="color:var(--ink-2)">Pendiente</span><span class="mono">\${v.pendientes}/\${v.folios} · \${fmtMXNk(v.monto_pendiente)}</span></div>
    </div>\`));
  });
  wrap.appendChild(grid);
  wrap.appendChild(el(\`<div class="note" style="margin-top:16px"><span class="ico">i</span><span>Obra Menor son proyectos (ej. tapetes RT, antenas booster) que no llevan folio GMI de BBVA ni número de pedido — no pasan por Adquira como Mantenimiento, así que su cobro se sigue por otra vía. Ninguno está pagado todavía.</span></div>\`));
}

function renderMesProceso(){
  const MESES = {"01":"Ene","02":"Feb","03":"Mar","04":"Abr","05":"May","06":"Jun","07":"Jul","08":"Ago","09":"Sep","10":"Oct","11":"Nov","12":"Dic"};
  const etiqueta = (key)=>{ if(key==="Sin fecha") return key; const [y,m]=key.split("-"); return \`\${MESES[m]||m} \${y}\`; };
  // Un reporte por proceso: Mantenimiento y Obra Menor tienen tiempos
  // distintos, así que cada tabla lleva su propio ciclo folio→pago. Los
  // cortes cargados antes de que existiera este desglose solo traen folios
  // y monto -- las demás columnas salen con "—" hasta el siguiente maestro.
  [["Mantenimiento","mesMantBody","mesMantHint"],["Obra Menor","mesObraBody","mesObraHint"]].forEach(([proceso,bodyId,hintId])=>{
    const body = document.getElementById(bodyId);
    const tot = {folios:0,monto:0,pagados:0,pendientes:0,monto_pendiente:0};
    let hayDetalle = false;
    Object.entries(DATA.by_month_proceso).forEach(([key,procs])=>{
      const v = procs[proceso];
      if(!v) return;
      const detalle = v.pagados !== undefined;
      hayDetalle = hayDetalle || detalle;
      tot.folios += v.folios; tot.monto += v.monto;
      if(detalle){ tot.pagados += v.pagados; tot.pendientes += v.pendientes; tot.monto_pendiente += v.monto_pendiente; }
      body.appendChild(el(\`<tr>
        <td>\${etiqueta(key)}</td>
        <td class="num" style="text-align:right">\${v.folios}</td>
        <td class="num" style="text-align:right">\${fmtMXN(v.monto)}</td>
        <td class="num" style="text-align:right">\${detalle ? v.pagados : "—"}</td>
        <td class="num" style="text-align:right">\${detalle ? v.pendientes : "—"}</td>
        <td class="num" style="text-align:right">\${detalle ? fmtMXN(v.monto_pendiente) : "—"}</td>
        <td class="num" style="text-align:right">\${detalle && v.ciclo_promedio_dias != null ? v.ciclo_promedio_dias + " días" : "—"}</td>
      </tr>\`));
    });
    if(!body.children.length){
      body.appendChild(el(\`<tr><td colspan="7" style="color:var(--ink-3)">Sin folios de \${proceso} en este corte.</td></tr>\`));
      return;
    }
    body.appendChild(el(\`<tr style="font-weight:600;border-top:2px solid var(--border)">
      <td>Total</td>
      <td class="num" style="text-align:right">\${tot.folios}</td>
      <td class="num" style="text-align:right">\${fmtMXN(tot.monto)}</td>
      <td class="num" style="text-align:right">\${hayDetalle ? tot.pagados : "—"}</td>
      <td class="num" style="text-align:right">\${hayDetalle ? tot.pendientes : "—"}</td>
      <td class="num" style="text-align:right">\${hayDetalle ? fmtMXN(tot.monto_pendiente) : "—"}</td>
      <td class="num" style="text-align:right">\${DATA.by_proceso_ciclo && DATA.by_proceso_ciclo[proceso] != null ? DATA.by_proceso_ciclo[proceso] + " días prom." : "—"}</td>
    </tr>\`));
    const hint = document.getElementById(hintId);
    if(hint && !hayDetalle) hint.textContent = "pagado/pendiente y ciclo se llenan con el siguiente maestro que se cargue";
  });
}

function renderConciliacion(){
  const c = DATA.conciliacion;
  if(!c) return;
  const wrap = document.getElementById("conciliacionBlock");
  const stats = [
    ["Pedidos con folios en Puebla", c.total_pedidos],
    ["Con factura en el maestro", c.pedidos_con_factura],
    ["Encontrados en Adquira", c.pedidos_en_adquira],
    ["Monto coincide", c.pedidos_coinciden],
    ["Con diferencia de monto", c.pedidos_con_diferencia_monto],
  ].filter(([,val]) => val !== undefined);
  const statRow = document.createElement("div");
  statRow.style.cssText = \`display:grid;grid-template-columns:repeat(\${stats.length},1fr);gap:14px;margin-bottom:14px;\`;
  stats.forEach(([label,val])=>{
    statRow.appendChild(el(\`<div>
      <div style="font-size:11px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:3px;">\${label}</div>
      <div class="mono" style="font-size:19px;font-weight:600;">\${val}</div>
    </div>\`));
  });
  wrap.appendChild(statRow);
  wrap.appendChild(el(\`<div style="display:flex;justify-content:space-between;padding:9px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);font-size:12.5px;">
    <span style="color:var(--ink-2)">Suma folios Puebla (pedidos)</span>
    <span class="mono" style="font-weight:600">\${fmtMXN(c.suma_folios_puebla)}</span>
  </div>\`));
  if(c.suma_facturas_adquira !== undefined){
    wrap.appendChild(el(\`<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border);font-size:12.5px;">
      <span style="color:var(--ink-2)">Base imponible (sin IVA) de esos pedidos en Adquira</span>
      <span class="mono" style="font-weight:600">\${fmtMXN(c.suma_facturas_adquira)}</span>
    </div>\`));
    if(c.suma_adquira_con_iva !== undefined){
      wrap.appendChild(el(\`<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border);font-size:12.5px;">
        <span style="color:var(--ink-2)">Importe total con IVA en Adquira</span>
        <span class="mono" style="font-weight:600">\${fmtMXN(c.suma_adquira_con_iva)}</span>
      </div>\`));
    }
    const m = c.adquira_meta;
    if(m){
      wrap.appendChild(el(\`<div class="note" style="margin-top:12px"><span class="ico">i</span><span>Export de Adquira del <b>\${m.fecha_exportacion ?? "—"}</b>: \${m.total_pedidos_export} pedidos por \${fmtMXN(m.importe_export)} en total; \${m.pedidos_fuera_maestro} de ellos (\${fmtMXN(m.importe_fuera_maestro)}) no están en el maestro de Puebla-Tlaxcala (otras regiones u obra menor). El maestro BBVA captura montos <b>sin IVA</b>, por eso se compara contra la base imponible.</span></div>\`));
    }
    const sinAdq = c.pedidos_sin_adquira || [];
    const invalidos = c.pedidos_invalidos || [];
    if(sinAdq.length || invalidos.length){
      wrap.appendChild(el(\`<div class="note" style="margin-top:10px"><span class="ico">!</span><span>\${sinAdq.length ? \`Pedidos del maestro que no aparecen en Adquira: <b class="mono">\${sinAdq.join(", ")}</b>. \` : ""}\${invalidos.length ? \`Números de pedido mal capturados en el maestro (no son 10 dígitos): <b class="mono">\${invalidos.join(", ")}</b>.\` : ""}</span></div>\`));
    }
    const difs = c.diferencias || [];
    if(difs.length){
      const filas = difs.slice(0, 25).map((d)=>\`<tr>
        <td class="mono">\${d.pedido}</td>
        <td class="mono" style="text-align:right">\${d.folios}</td>
        <td class="mono">\${(d.facturas||[]).join(", ") || "—"}</td>
        <td class="mono" style="text-align:right">\${fmtMXN(d.monto_bbva)}</td>
        <td class="mono" style="text-align:right">\${fmtMXN(d.base_adquira)}</td>
        <td class="mono" style="text-align:right;font-weight:600;color:\${d.diferencia > 0 ? "var(--bad)" : "var(--warn)"}">\${d.diferencia > 0 ? "+" : ""}\${fmtMXN(d.diferencia)}</td>
        <td>\${d.estado_adquira ?? "—"}</td>
      </tr>\`).join("");
      wrap.appendChild(el(\`<div style="margin-top:14px;font-size:12px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Pedidos con diferencia (maestro BBVA vs base Adquira, tolerancia \${fmtMXN(c.tolerancia ?? 1)})</div>
      <div style="overflow-x:auto;margin-top:6px"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="color:var(--ink-3);text-align:left"><th style="padding:6px 6px">Pedido</th><th style="padding:6px 6px;text-align:right">Folios</th><th style="padding:6px 6px">Factura</th><th style="padding:6px 6px;text-align:right">Maestro BBVA</th><th style="padding:6px 6px;text-align:right">Base Adquira</th><th style="padding:6px 6px;text-align:right">Diferencia</th><th style="padding:6px 6px">Estado Adquira</th></tr></thead>
        <tbody>\${filas}</tbody></table></div>
      <div style="font-size:11.5px;color:var(--ink-3);margin-top:6px">Diferencia positiva: el maestro trae más que lo pedido en Adquira (folios cargados a un pedido que no los cubre, o número de pedido mal capturado). Negativa: Adquira trae más que los folios del maestro (folios sin capturar o de otra región dentro del mismo pedido).</div>\`));
    }
  } else {
    wrap.appendChild(el(\`<div class="note" style="margin-top:12px"><span class="ico">i</span><span>El maestro actual ya trae pedido/factura por folio, pero falta el archivo de facturas de Adquira para comparar montos y detectar diferencias -- súbelo cuando lo tengas para activar esa comparación.</span></div>\`));
  }
}

function renderQaNotas(){
  const notas = DATA.qa_notas||[];
  const sec = document.getElementById("qaNotasSection");
  if(notas.length === 0){ sec.hidden = true; return; }
  const wrap = document.getElementById("qaNotasBlock");
  notas.forEach((nota)=>{
    wrap.appendChild(el(\`<div class="note" style="margin-bottom:10px"><span class="ico">!</span><span>\${nota}</span></div>\`));
  });
}

renderKPIs();
renderCompare();
renderStepper();
renderMonthChart();
renderStatus();
renderBarlist("specBars",
  Object.entries(DATA.by_especialidad).map(([k,v])=>({label:k,monto:v.monto,folios:v.folios})).sort((a,b)=>b.monto-a.monto).slice(0,9),
  {labelKey:"label",montoKey:"monto",foliosKey:"folios",max:Math.max(...Object.values(DATA.by_especialidad).map(v=>v.monto))}
);
renderBarlist("sucBars",
  DATA.top_sucursales.map(v=>({label:v.sucursal,monto:v.monto,folios:v.folios})),
  {labelKey:"label",montoKey:"monto",foliosKey:"folios",max:DATA.top_sucursales[0].monto}
);
renderSupervisors();
renderProceso();
renderMesProceso();
renderAdquira();
renderConciliacion();
renderQaNotas();
renderWorklist();
document.getElementById("totalFoliosHint").textContent = DATA.kpi.total_folios + " folios vigentes";
document.getElementById("sucursalesHint").textContent = "de " + DATA.kpi.n_sucursales + " sucursales";

// Avisa al padre la altura real para que el iframe no quede recortado.
function avisarAltura(){
  window.parent.postMessage({ tipo: "bbva-dashboard-altura", alto: document.documentElement.scrollHeight }, "*");
}
window.addEventListener("load", avisarAltura);
new ResizeObserver(avisarAltura).observe(document.body);
</script>
</body></html>`;
