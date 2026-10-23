// Buscador al capturar OC / OS / OV (15-oct-2026, Mario: "pon el filtro para
// que busquen proveedores, items, para que sea fácil su captura"). Los datos
// salen de fn_ordenes_catalogo_captura (una llamada al abrir el editor) y aquí
// se filtran al instante: sin acentos, sin importar mayúsculas y por palabras
// en cualquier orden ("varilla 3/8" encuentra "VARILLA CORRUGADA 3/8").

export interface ContraparteCatalogo {
  nombre: string;
  rfc?: string | null;
  /** Cuenta y CLABE de datos bancarios (solo para quien los puede ver; 23-oct-2026). */
  cuenta?: string | null;
  clabe?: string | null;
  veces: number;
  ultima: string | null;
  misma_empresa: boolean;
  /** Tiene ficha en el catálogo de compras (tabla proveedores). */
  ficha?: boolean;
}

export interface ObraCatalogo {
  nombre: string;
  veces: number;
  ultima: string | null;
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
    // Los registrados (ficha de proveedor / cliente dado de alta) van primero:
    // sin órdenes quedaban al final y no se veían (Mario, 15-oct-2026).
    .sort((a, b) => b.s - a.s || Number(!!b.c.ficha) - Number(!!a.c.ficha) || Number(b.c.misma_empresa) - Number(a.c.misma_empresa) || b.c.veces - a.c.veces || a.c.nombre.localeCompare(b.c.nombre, "es"))
    .slice(0, limite)
    .map((x) => x.c);
}

/** Una opción por concepto. Si ya se eligió proveedor/cliente, su propio
 * último precio gana y sus conceptos van primero (sin texto: "lo que le
 * compras a este proveedor"). Con `soloDelProveedor` (Mario, 15-oct-2026:
 * "fíltralos por proveedor para no ver todo el universo") solo salen los
 * conceptos de ese proveedor. */
export function filtrarItems(lista: ItemCatalogo[], texto: string, contraparte: string | null | undefined, limite = 12, soloDelProveedor = false): ItemCatalogo[] {
  const ps = palabras(texto);
  const cp = normalizarBusqueda(contraparte);
  const esDe = (i: ItemCatalogo) => !!cp && normalizarBusqueda(i.contraparte) === cp;
  const estricto = soloDelProveedor && !!cp;
  // Sin texto solo se sugiere si hay proveedor elegido y es de él.
  if (ps.length === 0 && !cp) return [];
  const porConcepto = new Map<string, { i: ItemCatalogo; s: number; propio: boolean; veces: number }>();
  for (const i of lista) {
    const propio = esDe(i);
    if ((ps.length === 0 || estricto) && !propio) continue;
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

/** ¿El proveedor elegido tiene partidas en el catálogo? (para avisar que no). */
export function tienePartidas(lista: ItemCatalogo[], contraparte: string | null | undefined): boolean {
  const cp = normalizarBusqueda(contraparte);
  return !!cp && lista.some((i) => normalizarBusqueda(i.contraparte) === cp);
}

export function filtrarObras(lista: ObraCatalogo[], texto: string, limite = 12): ObraCatalogo[] {
  const ps = palabras(texto);
  const exacta = normalizarBusqueda(texto);
  return lista
    .map((o) => ({ o, s: puntaje(o.nombre, ps) }))
    .filter((x) => x.s > 0 && normalizarBusqueda(x.o.nombre) !== exacta)
    .sort((a, b) => b.s - a.s || (b.o.ultima ?? "").localeCompare(a.o.ultima ?? "") || a.o.nombre.localeCompare(b.o.nombre, "es"))
    .slice(0, limite)
    .map((x) => x.o);
}

/** Comparar un concepto entre proveedores: todas las coincidencias (sin
 * juntar por concepto), del precio más bajo al más alto. */
export function compararPrecios(lista: ItemCatalogo[], texto: string, limite = 60): ItemCatalogo[] {
  const ps = palabras(texto);
  if (ps.length === 0) return [];
  return lista
    .filter((i) => puntaje(i.descripcion, ps) > 0)
    .sort((a, b) => normalizarBusqueda(a.descripcion).localeCompare(normalizarBusqueda(b.descripcion), "es") || (a.precio ?? Infinity) - (b.precio ?? Infinity))
    .slice(0, limite);
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
  return [c.ficha ? "registrado" : null, c.rfc ? `RFC ${c.rfc}` : null, c.veces ? `${c.veces} ${c.veces === 1 ? "orden" : "órdenes"}` : "sin órdenes", c.ultima ? `última ${fechaCortaCatalogo(c.ultima)}` : null, c.misma_empresa ? null : "otra empresa"]
    .filter(Boolean)
    .join(" · ");
}

export function detalleItem(i: ItemCatalogo, venta: boolean): string {
  const precio = i.precio != null ? `$${Number(i.precio).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s/IVA` : null;
  const origen = i.contraparte ? `${venta ? "a" : "de"} ${i.contraparte}` : "catálogo";
  return [i.unidad, precio, origen, i.ultima ? fechaCortaCatalogo(i.ultima) : null, i.veces > 1 ? `${i.veces} veces` : null].filter(Boolean).join(" · ");
}
