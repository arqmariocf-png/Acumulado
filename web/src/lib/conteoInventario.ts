// Conteo físico de inventario (19-nov-2026, Mario: "todos van a contar y
// subir códigos con los ítems existentes, así como códigos QR para tener
// todos los ítems identificados"). Reglas puras de la pantalla
// pages/inventario/ConteoInventario.tsx: validación de cada ítem, liga de la
// etiqueta QR, resumen por persona y empresa, Excel e impresión de etiquetas.

export interface ItemConteo {
  id: string;
  conteo_id: string;
  empresa_id: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  ubicacion: string | null;
  codigo_barras: string | null;
  notas: string | null;
  producto_id?: string | null;
  ubicacion_id?: string | null;
  contado_por: string;
  contado_por_nombre: string | null;
  created_at: string;
}

export interface ConteoInventario {
  id: string;
  fecha: string;
  nombre: string;
  instrucciones: string | null;
  estado: "abierto" | "cerrado";
}

export const UNIDADES_CONTEO = ["pza", "kg", "m", "m2", "m3", "lt", "caja", "rollo", "bulto", "juego", "par", "tramo", "saco", "cubeta", "galón", "ton"];

/** Quién abre y cierra el conteo y manda el aviso. */
export function administraConteo(rol: string | null | undefined): boolean {
  return ["admin", "corporativo", "direccion", "almacen"].includes(rol ?? "");
}

/** Hoy en hora de México (yyyy-mm-dd). */
export function fechaHoyMx(ahora: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ahora);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

/** Qué le falta al ítem antes de guardarlo; null = listo. */
export function revisarItem(x: { empresa_id: string; descripcion: string; cantidad: string | number; unidad: string }): string | null {
  if (!x.empresa_id) return "Elige la empresa dueña del inventario.";
  if (!x.descripcion.trim()) return "Escribe qué es el ítem.";
  if (x.descripcion.trim().length > 300) return "La descripción es muy larga (máximo 300 caracteres).";
  const n = typeof x.cantidad === "number" ? x.cantidad : Number(String(x.cantidad).replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return "La cantidad debe ser un número (0 o más).";
  if (!x.unidad.trim()) return "Indica la unidad (pza, kg, m…).";
  return null;
}

/** Lo que va dentro del QR: la liga que abre el ítem en la pantalla. */
export function urlEtiqueta(codigo: string, origen = ""): string {
  return `${origen}/inventario/conteo?item=${encodeURIComponent(codigo)}`;
}

/** QR de un artículo del catálogo: al escanearlo la captura queda llena con
 * ese producto y solo falta la cantidad (19-nov-2026, Mario: "dale la opción a
 * Lau a imprimir QR por artículo existente y a todos los demás para irlos
 * pegando mientras están contando"). */
export function urlEtiquetaProducto(productoId: string, origen = ""): string {
  return `${origen}/inventario/conteo?producto=${encodeURIComponent(productoId)}`;
}

export interface ProductoEtiqueta {
  id: string;
  sku: string | null;
  nombre: string;
  unidad_medida: string | null;
}

/** Filtra los artículos del catálogo por texto (sin acentos, palabras en cualquier orden). */
export function filtrarProductos<T extends ProductoEtiqueta>(productos: T[], texto: string): T[] {
  const t = sinAcentos(texto.trim());
  if (!t) return productos;
  const partes = t.split(/\s+/);
  return productos.filter((p) => {
    const pajar = sinAcentos([p.sku ?? "", p.nombre].join(" "));
    return partes.every((x) => pajar.includes(x));
  });
}

export interface FiltroConteo {
  empresa?: string;
  persona?: string;
  texto?: string;
}

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filtrarItems(items: ItemConteo[], f: FiltroConteo): ItemConteo[] {
  const t = sinAcentos((f.texto ?? "").trim());
  return items.filter((i) => {
    if (f.empresa && i.empresa_id !== f.empresa) return false;
    if (f.persona && i.contado_por !== f.persona) return false;
    if (t) {
      const pajar = sinAcentos([i.codigo, i.descripcion, i.ubicacion ?? "", i.codigo_barras ?? "", i.contado_por_nombre ?? ""].join(" "));
      if (!t.split(/\s+/).every((p) => pajar.includes(p))) return false;
    }
    return true;
  });
}

export interface RenglonResumen {
  contado_por: string;
  persona: string;
  empresa_id: string;
  empresa: string;
  items: number;
  cantidad: number;
  primero: string;
  ultimo: string;
}

/** Cuántos ítems y cuánto contó cada persona en cada empresa, por persona. */
export function resumenConteo(items: ItemConteo[], empresas: Map<string, string>): RenglonResumen[] {
  const mapa = new Map<string, RenglonResumen>();
  for (const i of items) {
    const k = `${i.contado_por}|${i.empresa_id}`;
    let r = mapa.get(k);
    if (!r) {
      r = { contado_por: i.contado_por, persona: i.contado_por_nombre ?? "(sin nombre)", empresa_id: i.empresa_id, empresa: empresas.get(i.empresa_id) ?? i.empresa_id, items: 0, cantidad: 0, primero: i.created_at, ultimo: i.created_at };
      mapa.set(k, r);
    }
    r.items += 1;
    r.cantidad = Math.round((r.cantidad + Number(i.cantidad)) * 1000) / 1000;
    if (i.created_at < r.primero) r.primero = i.created_at;
    if (i.created_at > r.ultimo) r.ultimo = i.created_at;
  }
  return [...mapa.values()].sort((a, b) => a.persona.localeCompare(b.persona, "es") || a.empresa.localeCompare(b.empresa, "es"));
}

function celda(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function horaMx(iso: string): string {
  const p = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")} ${v("hour")}:${v("minute")}`;
}

export const COLUMNAS_EXCEL_CONTEO = ["Código", "Empresa", "Descripción", "Cantidad", "Unidad", "Ubicación", "Código de barras", "Contó", "Fecha y hora", "Notas"];

export function csvConteo(items: ItemConteo[], empresas: Map<string, string>): string {
  const filas = [COLUMNAS_EXCEL_CONTEO, ...items.map((i) => [i.codigo, empresas.get(i.empresa_id) ?? "", i.descripcion, i.cantidad, i.unidad, i.ubicacion ?? "", i.codigo_barras ?? "", i.contado_por_nombre ?? "", horaMx(i.created_at), i.notas ?? ""])];
  return filas.map((f) => f.map(celda).join(",")).join("\n");
}

export function nombreExcelConteo(fecha: string): string {
  return `conteo-inventario-${fecha}.csv`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface EtiquetaConteo {
  codigo: string;
  descripcion: string;
  /** null = etiqueta de un artículo del catálogo (sin cantidad contada). */
  cantidad: number | null;
  unidad: string;
  ubicacion: string | null;
  empresa: string;
  qrSvg: string;
}

/** Hoja de etiquetas (3 por renglón, 62 × 38 mm aprox.) con el QR de cada ítem. */
export function htmlEtiquetas(etiquetas: EtiquetaConteo[], titulo: string): string {
  const celdas = etiquetas
    .map(
      (e) => `<div class="et">
      <div class="qr">${e.qrSvg}</div>
      <div class="tx">
        <div class="cod">${esc(e.codigo)}</div>
        <div class="des">${esc(e.descripcion)}</div>
        <div class="dat">${esc(e.empresa)} · ${e.cantidad == null ? esc(e.unidad) : `${e.cantidad} ${esc(e.unidad)}`}${e.ubicacion ? ` · ${esc(e.ubicacion)}` : ""}</div>
      </div>
    </div>`,
    )
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  @page { size: letter; margin: 8mm; }
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; }
  h1 { font-size: 11px; font-weight: normal; color: #555; margin: 0 0 4mm; }
  .grid { display: grid; grid-template-columns: repeat(3, 62mm); gap: 3mm; }
  .et { border: 0.3mm dashed #999; height: 38mm; display: flex; gap: 2mm; padding: 2mm; box-sizing: border-box; page-break-inside: avoid; }
  .qr { width: 30mm; height: 30mm; flex: none; }
  .qr svg { width: 30mm; height: 30mm; }
  .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
  .cod { font-size: 11px; font-weight: bold; letter-spacing: .3px; }
  .des { font-size: 10px; margin-top: 1mm; max-height: 12mm; overflow: hidden; }
  .dat { font-size: 8px; color: #444; margin-top: 1mm; }
  @media print { h1 { display: none; } }
</style></head><body>
<h1>${esc(titulo)} · ${etiquetas.length} etiqueta(s)</h1>
<div class="grid">${celdas}</div>
<script>window.onload = function () { setTimeout(function () { window.print(); }, 300); };</script>
</body></html>`;
}
