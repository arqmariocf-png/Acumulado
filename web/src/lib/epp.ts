// Equipo de protección personal (EPP) que RH entrega a cada trabajador:
// vigencia, totales por persona y la carta responsiva que firma al recibir.
// Puro (sin DOM) para probarlo en node.

export type EstadoEpp = "por_surtir" | "entregado" | "devuelto" | "sustituido" | "perdido";

export interface LineaEpp {
  id: string;
  descripcion: string;
  talla: string | null;
  cantidad: number;
  unidad: string;
  costo_unitario: number;
  vigencia_meses: number | null;
  origen: "bodega" | "compra";
  estado: EstadoEpp;
  entregado_en: string | null;
  vence_el: string | null;
  devuelto_en: string | null;
  descuento_monto: number | null;
  descuento_aplicado_en: string | null;
}

export const ETIQUETA_ESTADO_EPP: Record<EstadoEpp, string> = {
  por_surtir: "Por surtir",
  entregado: "Entregado",
  devuelto: "Devuelto",
  sustituido: "Sustituido",
  perdido: "Perdido / no regresó",
};

export type SemaforoVigencia = "sin_vigencia" | "vigente" | "por_vencer" | "vencido";

/** Solo el equipo que la persona trae (entregado) tiene semáforo. Ámbar a 30
 * días o menos del vencimiento; rojo vencido: hay que sustituirlo. */
export function semaforoVigencia(linea: Pick<LineaEpp, "estado" | "vence_el">, hoy: string): SemaforoVigencia {
  if (linea.estado !== "entregado" || !linea.vence_el) return "sin_vigencia";
  const dias = diasEntre(hoy, linea.vence_el);
  if (dias < 0) return "vencido";
  if (dias <= 30) return "por_vencer";
  return "vigente";
}

export function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(...partes(desde));
  const b = Date.UTC(...partes(hasta));
  return Math.round((b - a) / 86_400_000);
}

function partes(iso: string): [number, number, number] {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [a, m - 1, d];
}

/** Lo que vale lo que la persona tiene en su poder (entregado). */
export function valorEnPoder(lineas: LineaEpp[]): number {
  return redondear(lineas.filter((l) => l.estado === "entregado").reduce((s, l) => s + l.cantidad * l.costo_unitario, 0));
}

/** Descuentos vía nómina pendientes de aplicar (perdido, sin fecha de aplicado). */
export function porDescontar(lineas: LineaEpp[]): number {
  return redondear(lineas.filter((l) => l.estado === "perdido" && !l.descuento_aplicado_en).reduce((s, l) => s + (l.descuento_monto ?? 0), 0));
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return iso;
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

function esc(s: string | number | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const pesos = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

export interface ResponsivaEpp {
  folio: string;
  fecha: string;
  empresa_nombre: string;
  empresa_codigo: string;
  obra: string;
  trabajador: string;
  puesto: string | null;
  entrega_nombre: string | null;
  lineas: LineaEpp[];
}

/** Carta responsiva: el trabajador recibe el equipo, se obliga a cuidarlo,
 * regresarlo al terminar su vigencia o su relación laboral, y acepta el
 * descuento vía nómina de lo que pierda o no regrese. Solo lista lo que
 * recibe (entregado). */
export function htmlResponsivaEpp(doc: ResponsivaEpp): string {
  const recibidas = doc.lineas.filter((l) => l.estado === "entregado");
  const filas = recibidas
    .map(
      (l) => `<tr>
        <td>${esc(l.descripcion)}${l.talla ? ` <span class="t">talla ${esc(l.talla)}</span>` : ""}</td>
        <td class="n">${esc(l.cantidad)} ${esc(l.unidad)}</td>
        <td class="n">${pesos(l.costo_unitario)}</td>
        <td>${l.vence_el ? esc(fechaLarga(l.vence_el)) : "—"}</td>
      </tr>`,
    )
    .join("");
  const total = valorEnPoder(recibidas);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Responsiva ${esc(doc.folio)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; margin: 32px; font-size: 13px; line-height: 1.45; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111; padding-bottom: 8px; }
  header img { max-height: 56px; }
  h1 { font-size: 16px; margin: 18px 0 4px; text-align: center; letter-spacing: .5px; }
  .folio { text-align: center; color: #555; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { border: 1px solid #999; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 12px; }
  td.n { text-align: right; white-space: nowrap; }
  .t { color: #555; font-size: 12px; }
  .firmas { display: flex; justify-content: space-around; margin-top: 70px; text-align: center; }
  .firmas div { border-top: 1px solid #111; padding-top: 4px; width: 38%; }
  @media print { body { margin: 18mm; } }
</style></head><body>
<header><strong>${esc(doc.empresa_nombre)}</strong><img src="/logos/${esc(doc.empresa_codigo.toLowerCase())}.png" alt="" onerror="this.remove()"></header>
<h1>CARTA RESPONSIVA DE EQUIPO DE PROTECCIÓN PERSONAL</h1>
<div class="folio">${esc(doc.folio)} · ${esc(fechaLarga(doc.fecha))}</div>
<p>Yo, <strong>${esc(doc.trabajador)}</strong>${doc.puesto ? `, con puesto de ${esc(doc.puesto)}` : ""}, recibo de
<strong>${esc(doc.empresa_nombre)}</strong> el equipo de protección personal que se detalla, para su uso en
<strong>${esc(doc.obra)}</strong>, en buen estado y a mi entera satisfacción:</p>
<table>
  <thead><tr><th>Equipo</th><th>Cantidad</th><th>Valor unitario</th><th>Vigencia hasta</th></tr></thead>
  <tbody>${filas || `<tr><td colspan="4">Sin equipo entregado.</td></tr>`}</tbody>
  <tfoot><tr><th colspan="2">Valor total del equipo</th><th class="n">${pesos(total)}</th><th></th></tr></tfoot>
</table>
<p>Me comprometo a: (1) usarlo durante mi jornada y solo para las labores encomendadas; (2) cuidarlo y
mantenerlo en buen estado; (3) devolverlo al término de su vigencia, cuando se me sustituya, o al terminar mi
relación laboral; y (4) avisar de inmediato su pérdida o daño.</p>
<p>En caso de pérdida, daño por mal uso o de no devolverlo cuando se me solicite, autorizo que su valor
se descuente vía nómina, en los términos del artículo 110 de la Ley Federal del Trabajo.</p>
<div class="firmas">
  <div>Recibe<br><strong>${esc(doc.trabajador)}</strong></div>
  <div>Entrega<br><strong>${esc(doc.entrega_nombre ?? "Recursos Humanos")}</strong></div>
</div>
</body></html>`;
}
