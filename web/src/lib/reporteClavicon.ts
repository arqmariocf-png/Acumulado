// Reporte oficial de planta (Clavicón) para dirección: panorama de lotes,
// programación de máquinas, carga, inventario y costeo del mes. Puro: recibe
// datos y regresa HTML imprimible. Sin DOM.

export interface LoteReporte {
  folio: string;
  producto: string;
  proyecto: string | null;
  cantidad_planeada: number;
  cantidad_producida: number;
  fecha_inicio: string;
  fecha_estimada_embarque: string | null;
  estado: string;
  avance_pct: number;
}

export interface OperacionReporte {
  fecha: string;
  inicio: string;
  fin: string;
  maquina: string;
  lote: string;
  paso: string;
  estado: string;
  minutos_programados: number;
  minutos_reales: number | null;
}

export interface CargaReporte {
  maquina: string;
  minutos: number;
  pct: number;
}

export interface StockReporte {
  nombre: string;
  unidad: string;
  stock: number;
  costo_promedio: number | null;
}

export interface CosteoReporte {
  producto: string;
  lotes: number;
  cantidad: number;
  costo_total: number;
  costo_unitario: number | null;
}

export interface DatosReporteClavicon {
  empresa: string;
  rfc: string | null;
  fecha: string;
  semanaInicio: string;
  semanaFin: string;
  elaboro: string | null;
  lotes: LoteReporte[];
  operaciones: OperacionReporte[];
  carga: CargaReporte[];
  stockMateria: StockReporte[];
  stockProducto: StockReporte[];
  costeoMes: CosteoReporte[];
  entradasSinOc: number;
  remisionesMes: number;
}

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function num(n: number | null | undefined, d = 2): string {
  return n == null ? "—" : Number(n).toLocaleString("es-MX", { maximumFractionDigits: d });
}
function money(n: number | null | undefined): string {
  return n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
}
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

export function resumenLotes(lotes: LoteReporte[]): { abiertos: number; terminados: number; atrasados: number; hoyIso?: string } {
  return {
    abiertos: lotes.filter((l) => l.estado === "planeada" || l.estado === "en_proceso").length,
    terminados: lotes.filter((l) => l.estado === "terminada").length,
    atrasados: lotes.filter((l) => (l.estado === "planeada" || l.estado === "en_proceso") && !!l.fecha_estimada_embarque && l.fecha_estimada_embarque < new Date().toISOString().slice(0, 10)).length,
  };
}

export function htmlReporteClavicon(d: DatosReporteClavicon): string {
  const color = "#b91c1c";
  const r = resumenLotes(d.lotes);
  const porDia = new Map<string, OperacionReporte[]>();
  for (const o of d.operaciones) porDia.set(o.fecha, [...(porDia.get(o.fecha) ?? []), o]);
  const dias = [...porDia.keys()].sort();
  const seccionCalendario = dias.length
    ? dias
        .map(
          (f) => `<h3>${esc(fechaLarga(f))}</h3><table><thead><tr><th>Horario</th><th>Máquina</th><th>Lote</th><th>Paso</th><th>Estado</th><th class="r">Prog.</th><th class="r">Real</th></tr></thead><tbody>` +
            (porDia.get(f) ?? [])
              .map((o) => `<tr><td>${esc(o.inicio)}–${esc(o.fin)}</td><td>${esc(o.maquina)}</td><td>${esc(o.lote)}</td><td>${esc(o.paso)}</td><td>${esc(o.estado.replace("_", " "))}</td><td class="r">${num(o.minutos_programados, 0)} min</td><td class="r">${o.minutos_reales == null ? "—" : `${num(o.minutos_reales, 0)} min`}</td></tr>`)
              .join("") +
            `</tbody></table>`,
        )
        .join("")
    : `<p class="nota">Sin operaciones programadas en la semana.</p>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de planta ${esc(d.empresa)} · ${esc(d.fecha)}</title>
<style>
  @page { size: letter; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; margin: 0; }
  .hoja { max-width: 190mm; margin: 0 auto; padding: 12px; }
  .membrete { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 4px solid ${color}; padding-bottom: 8px; }
  .emp { font-size: 20px; font-weight: 800; color: ${color}; } .rfc { color: #555; font-size: 10px; }
  .tit { text-align: right; } .tit b { display: block; font-size: 14px; color: ${color}; letter-spacing: 1px; }
  h2 { font-size: 12px; text-transform: uppercase; color: ${color}; margin: 16px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 2px; }
  h3 { font-size: 11px; margin: 10px 0 4px; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 3px 5px; }
  th { background: #f3f4f6; font-size: 10px; text-transform: uppercase; text-align: left; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 10px; }
  .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px; } .kpi span { display: block; font-size: 9px; text-transform: uppercase; color: #666; } .kpi b { font-size: 16px; }
  .rojo { color: #b91c1c; font-weight: bold; } .nota { color: #666; font-size: 10px; }
  .barra { background: #eee; height: 8px; border-radius: 4px; overflow: hidden; } .barra div { height: 8px; background: ${color}; }
  .pie { margin-top: 14px; font-size: 9px; color: #666; border-top: 1px solid #ddd; padding-top: 4px; display: flex; justify-content: space-between; }
  .btn { position: fixed; top: 10px; right: 10px; padding: 8px 14px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .btn { display: none; } .hoja { padding: 0; } h2 { page-break-after: avoid; } table { page-break-inside: auto; } }
</style></head><body>
<button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>
<div class="hoja">
  <div class="membrete">
    <div><div class="emp">${esc(d.empresa)}</div><div class="rfc">${d.rfc ? `RFC ${esc(d.rfc)}` : ""}</div></div>
    <div class="tit"><b>REPORTE DE PLANTA · DIRECCIÓN</b>${esc(fechaLarga(d.fecha))}<br><span class="rfc">Semana del ${esc(fechaLarga(d.semanaInicio))} al ${esc(fechaLarga(d.semanaFin))}${d.elaboro ? ` · elaboró ${esc(d.elaboro)}` : ""}</span></div>
  </div>
  <div class="kpis">
    <div class="kpi"><span>Lotes abiertos</span><b>${r.abiertos}</b></div>
    <div class="kpi"><span>Lotes atrasados</span><b class="${r.atrasados ? "rojo" : ""}">${r.atrasados}</b></div>
    <div class="kpi"><span>Operaciones en la semana</span><b>${d.operaciones.length}</b></div>
    <div class="kpi"><span>Entradas MP sin OC</span><b class="${d.entradasSinOc ? "rojo" : ""}">${d.entradasSinOc}</b></div>
    <div class="kpi"><span>Remisiones del mes</span><b>${d.remisionesMes}</b></div>
  </div>

  <h2>1. Lotes de producción</h2>
  <table><thead><tr><th>Lote</th><th>Producto</th><th>Proyecto</th><th class="r">Planeado</th><th class="r">Producido</th><th>Inicio</th><th>Embarque est.</th><th>Estado</th><th>Avance</th></tr></thead><tbody>
  ${d.lotes.length ? d.lotes.map((l) => `<tr><td>${esc(l.folio)}</td><td>${esc(l.producto)}</td><td>${esc(l.proyecto) || "—"}</td><td class="r">${num(l.cantidad_planeada)}</td><td class="r">${num(l.cantidad_producida)}</td><td>${esc(l.fecha_inicio)}</td><td class="${l.fecha_estimada_embarque && l.fecha_estimada_embarque < d.fecha && l.estado !== "terminada" ? "rojo" : ""}">${esc(l.fecha_estimada_embarque) || "—"}</td><td>${esc(l.estado.replace("_", " "))}</td><td><div class="barra"><div style="width:${Math.min(100, l.avance_pct)}%"></div></div>${l.avance_pct}%</td></tr>`).join("") : `<tr><td colspan="9" class="nota">Sin lotes.</td></tr>`}
  </tbody></table>

  <h2>2. Calendario de procesos por máquina (semana)</h2>
  ${seccionCalendario}

  <h2>3. Carga de máquinas en la semana</h2>
  <table><thead><tr><th>Máquina</th><th class="r">Minutos programados</th><th class="r">% capacidad</th></tr></thead><tbody>
  ${d.carga.length ? d.carga.map((c) => `<tr><td>${esc(c.maquina)}</td><td class="r">${num(c.minutos, 0)}</td><td class="r ${c.pct > 100 ? "rojo" : ""}">${c.pct}%</td></tr>`).join("") : `<tr><td colspan="3" class="nota">Sin máquinas dadas de alta.</td></tr>`}
  </tbody></table>

  <h2>4. Inventario</h2>
  <h3>Producto terminado</h3>
  <table><thead><tr><th>Producto</th><th class="r">Existencia</th><th>Unidad</th><th class="r">Costo promedio</th></tr></thead><tbody>
  ${d.stockProducto.length ? d.stockProducto.map((s) => `<tr><td>${esc(s.nombre)}</td><td class="r">${num(s.stock)}</td><td>${esc(s.unidad)}</td><td class="r">${money(s.costo_promedio)}</td></tr>`).join("") : `<tr><td colspan="4" class="nota">Sin existencias.</td></tr>`}
  </tbody></table>
  <h3>Materia prima</h3>
  <table><thead><tr><th>Materia prima</th><th class="r">Existencia</th><th>Unidad</th><th class="r">Costo promedio</th></tr></thead><tbody>
  ${d.stockMateria.length ? d.stockMateria.map((s) => `<tr><td>${esc(s.nombre)}</td><td class="r">${num(s.stock)}</td><td>${esc(s.unidad)}</td><td class="r">${money(s.costo_promedio)}</td></tr>`).join("") : `<tr><td colspan="4" class="nota">Sin existencias.</td></tr>`}
  </tbody></table>

  <h2>5. Costeo del mes (lotes terminados)</h2>
  <table><thead><tr><th>Producto</th><th class="r">Lotes</th><th class="r">Cantidad</th><th class="r">Costo total</th><th class="r">Costo unitario</th></tr></thead><tbody>
  ${d.costeoMes.length ? d.costeoMes.map((c) => `<tr><td>${esc(c.producto)}</td><td class="r">${c.lotes}</td><td class="r">${num(c.cantidad)}</td><td class="r">${money(c.costo_total)}</td><td class="r">${money(c.costo_unitario)}</td></tr>`).join("") : `<tr><td colspan="5" class="nota">Sin lotes terminados este mes.</td></tr>`}
  </tbody></table>

  <div class="pie"><div>Generado desde la app de Grupo Loma con la información capturada por la planta.</div><div>${esc(d.fecha)}</div></div>
</div></body></html>`;
}
