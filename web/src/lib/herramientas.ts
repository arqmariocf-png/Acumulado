// Herramienta y equipo del almacén (17-oct-2026, Mario: "generemos dentro
// del almacén el área de herramienta y equipo; esto puede ser asignado y
// pedido por los supervisores para las diferentes obras"). Etiquetas,
// semáforo de devolución, resumen por obra, filtro, resguardo para firma y
// etiquetas con código de barras. Puro (sin DOM) para probarlo en node.

import { svgCode128 } from "./code128.ts";

export type EstadoHerramienta = "disponible" | "asignada" | "reparacion" | "baja" | "extraviada";
export type CategoriaHerramienta = "herramienta" | "electrica" | "equipo" | "maquinaria" | "medicion" | "seguridad" | "otro";
export type CondicionHerramienta = "buena" | "regular" | "mala";
export type TipoMovimientoHerramienta = "alta" | "asignacion" | "traspaso" | "devolucion" | "reparacion" | "fin_reparacion" | "baja" | "extravio";
export type EstadoSolicitudHerramienta = "pendiente" | "parcial" | "surtida" | "rechazada" | "cancelada";

export interface Herramienta {
  id: string;
  empresa_id: string;
  folio: string;
  nombre: string;
  categoria: CategoriaHerramienta;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  costo: number | null;
  fecha_compra: string | null;
  estado: EstadoHerramienta;
  condicion: CondicionHerramienta;
  proyecto_id: string | null;
  responsable_id: string | null;
  responsable_nombre: string | null;
  asignada_en: string | null;
  devolver_el: string | null;
  notas: string | null;
}

export const ETIQUETA_ESTADO: Record<EstadoHerramienta, string> = {
  disponible: "Disponible en almacén",
  asignada: "En obra",
  reparacion: "En reparación",
  baja: "Dada de baja",
  extraviada: "Extraviada",
};

export const CLASE_ESTADO: Record<EstadoHerramienta, string> = {
  disponible: "bg-emerald-50 text-emerald-700",
  asignada: "bg-sky-50 text-sky-700",
  reparacion: "bg-amber-100 text-amber-800",
  baja: "bg-slate-100 text-slate-500",
  extraviada: "bg-red-100 text-red-800",
};

export const ETIQUETA_CATEGORIA: Record<CategoriaHerramienta, string> = {
  herramienta: "Herramienta menor",
  electrica: "Herramienta eléctrica",
  equipo: "Equipo",
  maquinaria: "Maquinaria",
  medicion: "Medición y topografía",
  seguridad: "Seguridad",
  otro: "Otro",
};

export const ETIQUETA_MOVIMIENTO: Record<TipoMovimientoHerramienta, string> = {
  alta: "Alta en almacén",
  asignacion: "Asignada a obra",
  traspaso: "Pasó a otra obra",
  devolucion: "Regresó al almacén",
  reparacion: "A reparación",
  fin_reparacion: "Regresó de reparación",
  baja: "Baja",
  extravio: "Extraviada",
};

export const ETIQUETA_SOLICITUD: Record<EstadoSolicitudHerramienta, string> = {
  pendiente: "Por surtir",
  parcial: "Surtida en parte",
  surtida: "Surtida",
  rechazada: "Rechazada",
  cancelada: "Cancelada",
};

export const CLASE_SOLICITUD: Record<EstadoSolicitudHerramienta, string> = {
  pendiente: "bg-amber-100 text-amber-800",
  parcial: "bg-sky-50 text-sky-700",
  surtida: "bg-emerald-50 text-emerald-700",
  rechazada: "bg-red-50 text-red-700",
  cancelada: "bg-slate-100 text-slate-500",
};

export type SemaforoDevolucion = "vencida" | "por_vencer" | "a_tiempo" | null;

/** Solo para lo que está en obra con fecha de regreso: vencida si ya pasó,
 * por vencer si faltan 2 días o menos. `hoy` en AAAA-MM-DD (hora de México). */
export function semaforoDevolucion(h: Pick<Herramienta, "estado" | "devolver_el">, hoy: string): SemaforoDevolucion {
  if (h.estado !== "asignada" || !h.devolver_el) return null;
  const dias = diasEntre(hoy, h.devolver_el);
  if (dias < 0) return "vencida";
  if (dias <= 2) return "por_vencer";
  return "a_tiempo";
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

export interface ResumenObra {
  proyecto_id: string;
  piezas: number;
  valor: number;
  vencidas: number;
  responsables: string[];
}

/** Lo que tiene cada obra hoy (solo lo asignado), con valor y vencidas;
 * las obras con vencidas primero, luego las de más piezas. */
export function resumenPorObra(lista: Herramienta[], hoy: string): ResumenObra[] {
  const porObra = new Map<string, ResumenObra>();
  for (const h of lista) {
    if (h.estado !== "asignada" || !h.proyecto_id) continue;
    const r = porObra.get(h.proyecto_id) ?? { proyecto_id: h.proyecto_id, piezas: 0, valor: 0, vencidas: 0, responsables: [] };
    r.piezas += 1;
    r.valor += Number(h.costo ?? 0);
    if (semaforoDevolucion(h, hoy) === "vencida") r.vencidas += 1;
    const quien = (h.responsable_nombre ?? "").trim();
    if (quien && !r.responsables.includes(quien)) r.responsables.push(quien);
    porObra.set(h.proyecto_id, r);
  }
  return [...porObra.values()].sort((a, b) => b.vencidas - a.vencidas || b.piezas - a.piezas);
}

/** Cuántas hay por estado (para los contadores de arriba). */
export function conteoPorEstado(lista: Herramienta[]): Record<EstadoHerramienta, number> {
  const c: Record<EstadoHerramienta, number> = { disponible: 0, asignada: 0, reparacion: 0, baja: 0, extraviada: 0 };
  for (const h of lista) c[h.estado] += 1;
  return c;
}

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Busca por folio, nombre, marca, modelo, serie, responsable u obra (por
 * palabras, sin acentos, en cualquier orden). `obra` da el nombre de la obra. */
export function filtrarHerramientas(lista: Herramienta[], texto: string, obra: (id: string | null) => string = () => ""): Herramienta[] {
  const palabras = normalizar(texto).split(" ").filter(Boolean);
  if (!palabras.length) return lista;
  return lista.filter((h) => {
    const hay = normalizar([h.folio, h.nombre, h.marca, h.modelo, h.numero_serie, h.responsable_nombre, obra(h.proyecto_id)].filter(Boolean).join(" "));
    return palabras.every((p) => hay.includes(p));
  });
}

/** Piezas que todavía faltan para un renglón de solicitud. */
export function faltaPorSurtir(linea: { cantidad: number; surtido: number }): number {
  return Math.max(Number(linea.cantidad) - Number(linea.surtido), 0);
}

/** Sugerencia de piezas disponibles para un renglón: primero las que se
 * llaman parecido a lo pedido (todas las palabras), en buena condición. */
export function sugerirParaRenglon(disponibles: Herramienta[], descripcion: string): Herramienta[] {
  const palabras = normalizar(descripcion).split(" ").filter((p) => p.length > 2);
  const puntaje = (h: Herramienta) => {
    const hay = normalizar(`${h.nombre} ${h.marca ?? ""} ${h.modelo ?? ""}`);
    const n = palabras.filter((p) => hay.includes(p)).length;
    return n * 10 + (h.condicion === "buena" ? 2 : h.condicion === "regular" ? 1 : 0);
  };
  return disponibles
    .filter((h) => h.estado === "disponible")
    .map((h) => ({ h, p: puntaje(h) }))
    .filter((x) => palabras.length === 0 || x.p >= 10)
    .sort((a, b) => b.p - a.p || a.h.folio.localeCompare(b.h.folio, "es", { numeric: true }))
    .map((x) => x.h);
}

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const pesos = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

export interface Resguardo {
  empresa_nombre: string;
  empresa_codigo: string;
  obra: string;
  responsable: string;
  fecha: string;
  folio_solicitud?: string | null;
  entrega_nombre?: string | null;
  piezas: Pick<Herramienta, "folio" | "nombre" | "marca" | "modelo" | "numero_serie" | "costo" | "condicion" | "devolver_el">[];
}

/** Resguardo de herramienta para firma de quien la recibe en obra. */
export function htmlResguardo(doc: Resguardo): string {
  const total = doc.piezas.reduce((s, p) => s + Number(p.costo ?? 0), 0);
  const filas = doc.piezas
    .map(
      (p) => `<tr>
        <td class="f">${esc(p.folio)}</td>
        <td>${esc(p.nombre)}${p.marca || p.modelo ? ` <span class="t">${esc([p.marca, p.modelo].filter(Boolean).join(" "))}</span>` : ""}</td>
        <td>${esc(p.numero_serie ?? "—")}</td>
        <td>${esc(p.condicion)}</td>
        <td class="n">${p.costo != null ? pesos(Number(p.costo)) : "—"}</td>
        <td>${p.devolver_el ? esc(fechaLarga(p.devolver_el)) : "—"}</td>
      </tr>`,
    )
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Resguardo de herramienta · ${esc(doc.obra)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; margin: 32px; font-size: 13px; line-height: 1.45; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111; padding-bottom: 8px; }
  header img { max-height: 56px; }
  h1 { font-size: 16px; margin: 18px 0 4px; text-align: center; letter-spacing: .5px; }
  .folio { text-align: center; color: #555; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; table-layout: fixed; }
  th, td { border: 1px solid #999; padding: 5px 7px; text-align: left; vertical-align: top; word-wrap: break-word; }
  th { background: #eee; font-size: 12px; }
  td.n { text-align: right; white-space: nowrap; }
  td.f { font-family: monospace; white-space: nowrap; }
  .t { color: #555; font-size: 12px; }
  .firmas { display: flex; justify-content: space-around; margin-top: 70px; text-align: center; }
  .firmas div { border-top: 1px solid #111; padding-top: 4px; width: 38%; }
  @media print { body { margin: 15mm; } }
</style></head><body>
<header><strong>${esc(doc.empresa_nombre)}</strong><img src="/logos/${esc(doc.empresa_codigo.toLowerCase())}.png" alt="" onerror="this.remove()"></header>
<h1>RESGUARDO DE HERRAMIENTA Y EQUIPO</h1>
<div class="folio">${esc(doc.obra)} · ${esc(fechaLarga(doc.fecha))}${doc.folio_solicitud ? ` · solicitud ${esc(doc.folio_solicitud)}` : ""}</div>
<p>Yo, <strong>${esc(doc.responsable)}</strong>, recibo del almacén de <strong>${esc(doc.empresa_nombre)}</strong> la
herramienta y el equipo que se detallan, para su uso en la obra <strong>${esc(doc.obra)}</strong>, en la condición indicada:</p>
<table>
  <colgroup><col style="width:15%"><col style="width:31%"><col style="width:14%"><col style="width:10%"><col style="width:13%"><col style="width:17%"></colgroup>
  <thead><tr><th>Folio</th><th>Herramienta / equipo</th><th>Serie</th><th>Condición</th><th>Valor</th><th>Regresa el</th></tr></thead>
  <tbody>${filas || `<tr><td colspan="6">Sin piezas.</td></tr>`}</tbody>
  <tfoot><tr><th colspan="4">${doc.piezas.length} ${doc.piezas.length === 1 ? "pieza" : "piezas"} · valor total</th><th class="n">${pesos(total)}</th><th></th></tr></tfoot>
</table>
<p>Me comprometo a: (1) usarla solo en esta obra y para las labores encomendadas; (2) cuidarla y mantenerla en buen
estado; (3) regresarla al almacén en la fecha indicada o cuando se me solicite; y (4) avisar de inmediato su pérdida,
robo o daño. En caso de pérdida o daño por mal uso, autorizo que su valor se descuente vía nómina, en los términos
del artículo 110 de la Ley Federal del Trabajo.</p>
<div class="firmas">
  <div>Recibe<br><strong>${esc(doc.responsable)}</strong></div>
  <div>Entrega (almacén)<br><strong>${esc(doc.entrega_nombre ?? "")}</strong></div>
</div>
</body></html>`;
}

/** Hoja de etiquetas (3 por renglón) con el folio en código de barras para
 * pegar en cada pieza; el mismo folio se escanea en la pantalla. */
export function htmlEtiquetas(piezas: Pick<Herramienta, "folio" | "nombre">[], empresa: string): string {
  const celdas = piezas
    .map(
      (p) => `<div class="e"><div class="emp">${esc(empresa)}</div>${svgCode128(p.folio, { modulo: 1.4, alto: 38, conTexto: true })}<div class="n">${esc(p.nombre)}</div></div>`,
    )
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas de herramienta</title>
<style>
  body { font-family: Arial, sans-serif; margin: 10mm; }
  .hoja { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  .e { border: 1px dashed #999; padding: 3mm; text-align: center; break-inside: avoid; }
  .e svg { max-width: 100%; height: auto; }
  .emp { font-size: 9px; color: #555; text-transform: uppercase; }
  .n { font-size: 11px; margin-top: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style></head><body><div class="hoja">${celdas}</div></body></html>`;
}
