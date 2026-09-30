// Reporte de obra del director general (Mario, 30-sep-2026; modelo para
// Abarrotes Neto). HTML imprimible sin DOM: se prueba en node y la pantalla
// lo abre con lib/imprimir.ts.

import { ETIQUETA_TIPO_DIRECTO, importeDirecto, importePartida, type CostoDirecto, type CosteoContrato, type PartidaPresupuesto, type RealObra, type ResumenCosteo, type TipoDirecto } from "./costeoObra.ts";

export interface OcReporte {
  id_orden: string;
  fecha: string | null;
  empresa: string;
  proveedor: string | null;
  concepto: string;
  total: number;
  estatus: string | null;
  pagado: number;
}

export interface DatosReporteObra {
  obra: string;
  empresa: string;
  cliente: string | null;
  responsable: string | null;
  plano: string | null;
  fechaCorte: string;
  contrato: CosteoContrato | null;
  presupuesto: PartidaPresupuesto[];
  directos: CostoDirecto[];
  imss: { monto: number; por: string | null; en: string | null } | null;
  resumen: ResumenCosteo;
  real: RealObra | null;
  ocs: OcReporte[];
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return a && m && d ? `${d}-${MESES[m - 1]}-${a}` : iso;
}
function $(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)} %`);

export function htmlReporteObra(d: DatosReporteObra): string {
  const r = d.resumen;
  const c = d.contrato;
  const mapa = c?.latitud != null && c?.longitud != null ? `https://www.google.com/maps?q=${c.latitud},${c.longitud}` : null;
  const tipos: TipoDirecto[] = ["contratista", "personal", "material", "otro"];

  const filasPresupuesto = d.presupuesto
    .map((p) => `<tr><td>${esc(p.clave)}</td><td>${esc(p.concepto)}</td><td>${esc(p.unidad)}</td><td class="r">${esc(Number(p.cantidad).toLocaleString("es-MX"))}</td><td class="r">${$(p.precio_unitario)}</td><td class="r">${$(importePartida(p))}</td></tr>`)
    .join("");

  const filasDirectos = tipos
    .map((t) => {
      const renglones = d.directos.filter((x) => x.tipo === t);
      if (renglones.length === 0) return "";
      return (
        `<tr class="grupo"><td colspan="5">${ETIQUETA_TIPO_DIRECTO[t]}</td><td class="r">${$(r.directosPorTipo[t])}</td></tr>` +
        renglones
          .map((x) => `<tr><td>${esc(x.nombre)}</td><td>${esc(x.especialidad)}</td><td class="r">${esc(x.cantidad)}</td><td>${esc(x.unidad)}</td><td class="r">${$(x.costo_unitario)}</td><td class="r">${$(importeDirecto(x))}</td></tr>`)
          .join("")
      );
    })
    .join("");

  const filasOc = d.ocs
    .map((o) => `<tr><td>${esc(o.id_orden)}</td><td>${fecha(o.fecha)}</td><td>${esc(o.empresa)}</td><td>${esc(o.proveedor)}</td><td>${esc(o.concepto)}</td><td>${esc(o.estatus)}</td><td class="r">${$(o.total)}</td><td class="r">${$(o.pagado)}</td></tr>`)
    .join("");

  const origen = r.origenIndirectos === "propio" ? "fijado por dirección" : r.origenIndirectos === "tabulador" ? `tabulador por ${c?.km ?? "—"} km` : "sin definir";

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de obra · ${esc(d.obra)}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;margin:24px;font-size:12px}
  h1{font-size:20px;margin:0}h2{font-size:14px;margin:22px 0 6px;border-bottom:2px solid #0f172a;padding-bottom:3px}
  .sub{color:#475569;margin-top:2px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px}
  .k{border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px}.k b{display:block;font-size:15px}.k span{color:#64748b;font-size:11px}
  table{width:100%;border-collapse:collapse;margin-top:4px}th,td{border-bottom:1px solid #e2e8f0;padding:3px 5px;text-align:left;vertical-align:top}
  th{background:#f1f5f9;font-size:11px;text-transform:uppercase;color:#475569}.r{text-align:right;white-space:nowrap}
  tr.grupo td{background:#f8fafc;font-weight:600}tr.tot td{font-weight:700;border-top:2px solid #0f172a}
  .util{font-size:16px}.neg{color:#b91c1c}.pos{color:#047857}.alerta{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:6px 10px;margin-top:6px}
  .conf{color:#b91c1c;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
  @media print{body{margin:10mm}a{color:inherit}}
</style></head><body>
<div class="conf">Confidencial · director general</div>
<h1>${esc(d.obra)}</h1>
<div class="sub">${esc(d.empresa)}${d.cliente ? ` · Cliente: ${esc(d.cliente)}` : ""}${d.responsable ? ` · Responsable: ${esc(d.responsable)}` : ""} · Corte al ${fecha(d.fechaCorte)}</div>

<h2>1. Contrato u orden de compra del cliente</h2>
<div class="grid">
  <div class="k"><span>Folio</span><b>${esc(c?.folio_contrato || "—")}</b></div>
  <div class="k"><span>Duración</span><b>${r.dias != null ? `${r.dias} días` : "—"}</b><span>${fecha(c?.fecha_inicio)} a ${fecha(c?.fecha_fin)}</span></div>
  <div class="k"><span>Sucursal</span><b>${c?.m2 ? `${Number(c.m2).toLocaleString("es-MX")} m²` : "—"}</b><span>Venta por m²: ${$(r.ventaM2)}</span></div>
  <div class="k"><span>Ubicación</span><b>${c?.km != null ? `${c.km} km` : "—"}</b><span>${esc(c?.ubicacion || "")}${mapa ? ` · <a href="${mapa}">mapa</a>` : ""}${d.plano ? ` · plano: ${esc(d.plano)}` : ""}</span></div>
  <div class="k"><span>Subtotal (antes de IVA)</span><b>${$(r.subtotal)}</b></div>
  <div class="k"><span>IVA</span><b>${$(r.iva)}</b></div>
  <div class="k"><span>Total</span><b>${$(r.total)}</b></div>
  <div class="k"><span>Indirectos</span><b>${pct(r.pctIndirectos)}</b><span>${origen}</span></div>
</div>

<h2>2. Presupuesto original del cliente</h2>
${
  d.presupuesto.length
    ? `<table><thead><tr><th>Clave</th><th>Concepto</th><th>Unidad</th><th class="r">Cantidad</th><th class="r">P.U.</th><th class="r">Importe</th></tr></thead><tbody>${filasPresupuesto}
<tr class="tot"><td colspan="5">Total presupuesto</td><td class="r">${$(r.presupuestoCliente)}</td></tr>${
        r.diferenciaPresupuesto ? `<tr><td colspan="5">Diferencia contra el contrato</td><td class="r">${$(r.diferenciaPresupuesto)}</td></tr>` : ""
      }</tbody></table>`
    : "<p>Sin presupuesto cargado.</p>"
}

<h2>3. Costeo y utilidad pronóstico</h2>
<table><thead><tr><th>Contratista / persona / concepto</th><th>Especialidad</th><th class="r">Cantidad</th><th>Unidad</th><th class="r">Costo unitario</th><th class="r">Importe</th></tr></thead><tbody>
${filasDirectos || '<tr><td colspan="6">Sin costos directos capturados.</td></tr>'}
<tr class="tot"><td colspan="5">Costo directo</td><td class="r">${$(r.directos)}</td></tr>
<tr><td colspan="5">Seguro social${d.imss?.por ? ` (capturó ${esc(d.imss.por)}, ${fecha(d.imss.en)})` : " (pendiente de contabilidad)"}</td><td class="r">${$(r.imss)}</td></tr>
<tr><td colspan="5">Indirectos ${pct(r.pctIndirectos)} sobre costo directo + seguro social</td><td class="r">${$(r.indirectos)}</td></tr>
<tr class="tot"><td colspan="5">Costo total pronóstico${r.costoM2 ? ` · ${$(r.costoM2)} por m²` : ""}</td><td class="r">${$(r.costoTotal)}</td></tr>
<tr><td colspan="5">Venta (subtotal del contrato)</td><td class="r">${$(r.subtotal)}</td></tr>
<tr class="tot util"><td colspan="5">Utilidad pronóstico${r.margenPct != null ? ` · ${pct(r.margenPct)} margen` : ""}</td><td class="r ${r.utilidad < 0 ? "neg" : "pos"}">${$(r.utilidad)}</td></tr>
</tbody></table>

<h2>4. Real a la fecha (órdenes de compra)</h2>
${
  d.ocs.length
    ? `<p>${d.real?.n_oc ?? d.ocs.length} OC · subtotal ${$(d.real?.subtotal)} · total con IVA ${$(d.real?.total)} · pagado ${$(d.real?.pagado)}${
        r.realVsDirectos != null ? ` · ${pct(r.realVsDirectos)} del costo directo pronosticado` : ""
      }</p>
<table><thead><tr><th>OC</th><th>Fecha</th><th>Empresa</th><th>Proveedor</th><th>Concepto</th><th>Estatus</th><th class="r">Total</th><th class="r">Pagado</th></tr></thead><tbody>${filasOc}</tbody></table>`
    : "<p>Sin órdenes de compra ligadas a esta obra.</p>"
}

${r.alertas.length ? `<h2>Alertas</h2>${r.alertas.map((a) => `<div class="alerta">${esc(a)}</div>`).join("")}` : ""}
${c?.notas ? `<h2>Notas</h2><p>${esc(c.notas)}</p>` : ""}
</body></html>`;
}
