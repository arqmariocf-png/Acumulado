// Buscador al capturar OC / OS / OV (15-oct-2026, Mario: "pon el filtro para
// que busquen proveedores, items, para que sea fácil su captura"). Los datos
// salen de fn_ordenes_catalogo_captura (una llamada al abrir el editor) y aquí
// se filtran al instante: sin acentos, sin importar mayúsculas y por palabras
// en cualquier orden ("varilla 3/8" encuentra "VARILLA CORRUGADA 3/8").

export interface ContraparteCatalogo {
  nombre: string;
  rfc?: string | null;
  veces: number;
  ultima: string | null;
  misma_empresa: boolean;
}

export interface ItemCatalogo {
  descripcion: string;
  unidad: string | null;
  /** Último precio SIN IVA. */
  precio: number | null;
  iva: boolean | null;
  /** Proveedor (o cliente) de esa última compra; null = catálogo de productos. */
  contraparte: string | null;
  veces: number;
  ultima: string | null;
  misma_empresa: boolean;
}

export function normalizarBusqueda(t: string | null | undefined): string {
  return String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[,.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function palabras(texto: string): string[] {
  return normalizarBusqueda(texto).split(" ").filter(Boolean);
}

/** Todas las palabras aparecen; 0 = no coincide, más alto = mejor. */
function puntaje(objetivo: string, ps: string[]): number {
  if (ps.length === 0) return 1;
  const n = normalizarBusqueda(objetivo);
  if (!ps.every((p) => n.includes(p))) return 0;
  const frase = ps.join(" ");
  if (n === frase) return 4;
  if (n.startsWith(frase)) return 3;
  if (n.split(" ").some((w) => w.startsWith(ps[0]))) return 2;
  return 1;
}

export function filtrarContrapartes(lista: ContraparteCatalogo[], texto: string, limite = 12): ContraparteCatalogo[] {
  const ps = palabras(texto);
  return lista
    .map((c) => ({ c, s: Math.max(puntaje(c.nombre, ps), ps.length && c.rfc ? puntaje(c.rfc, ps) : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || Number(b.c.misma_empresa) - Number(a.c.misma_empresa) || b.c.veces - a.c.veces || a.c.nombre.localeCompare(b.c.nombre, "es"))
    .slice(0, limite)
    .map((x) => x.c);
}

/** Una opción por concepto. Si ya se eligió proveedor/cliente, su propio
 * último precio gana y sus conceptos van primero (sin texto: "lo que le
 * compras a este proveedor"). */
export function filtrarItems(lista: ItemCatalogo[], texto: string, contraparte: string | null | undefined, limite = 12): ItemCatalogo[] {
  const ps = palabras(texto);
  const cp = normalizarBusqueda(contraparte);
  const esDe = (i: ItemCatalogo) => !!cp && normalizarBusqueda(i.contraparte) === cp;
  // Sin texto solo se sugiere si hay proveedor elegido y es de él.
  if (ps.length === 0 && !cp) return [];
  const porConcepto = new Map<string, { i: ItemCatalogo; s: number; propio: boolean; veces: number }>();
  for (const i of lista) {
    const propio = esDe(i);
    if (ps.length === 0 && !propio) continue;
    const s = puntaje(i.descripcion, ps);
    if (s === 0) continue;
    const clave = normalizarBusqueda(i.descripcion);
    const previo = porConcepto.get(clave);
    if (!previo) {
      porConcepto.set(clave, { i, s, propio, veces: i.veces });
      continue;
    }
    previo.veces += i.veces;
    // Gana el precio del proveedor elegido; si no, el más reciente.
    if ((propio && !previo.propio) || (propio === previo.propio && (i.ultima ?? "") > (previo.i.ultima ?? ""))) {
      previo.i = i;
      previo.propio = propio;
    }
  }
  return [...porConcepto.values()]
    .sort((a, b) => b.s - a.s || Number(b.propio) - Number(a.propio) || Number(b.i.misma_empresa) - Number(a.i.misma_empresa) || b.veces - a.veces || a.i.descripcion.localeCompare(b.i.descripcion, "es"))
    .slice(0, limite)
    .map((x) => ({ ...x.i, veces: x.veces }));
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function fechaCortaCatalogo(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return "";
  return `${d} ${MESES[m - 1]} ${String(a).slice(2)}`;
}

/** Segunda línea de cada opción en la lista. */
export function detalleContraparte(c: ContraparteCatalogo): string {
  return [c.rfc ? `RFC ${c.rfc}` : null, c.veces ? `${c.veces} ${c.veces === 1 ? "orden" : "órdenes"}` : "sin órdenes", c.ultima ? `última ${fechaCortaCatalogo(c.ultima)}` : null, c.misma_empresa ? null : "otra empresa"]
    .filter(Boolean)
    .join(" · ");
}

export function detalleItem(i: ItemCatalogo, venta: boolean): string {
  const precio = i.precio != null ? `$${Number(i.precio).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s/IVA` : null;
  const origen = i.contraparte ? `${venta ? "a" : "de"} ${i.contraparte}` : "catálogo";
  return [i.unidad, precio, origen, i.ultima ? fechaCortaCatalogo(i.ultima) : null, i.veces > 1 ? `${i.veces} veces` : null].filter(Boolean).join(" · ");
}
