// Duplicados y fusiones de catálogos (19-nov-2026, Mario: "revisemos
// duplicidades y similitudes para dar la opción a Laura y Alma de
// fusionarlos, incluyendo sus inventarios"). Reglas puras de
// pages/catalogos/Fusiones.tsx: agrupar los pares parecidos
// (catalogo_similares) en grupos, sugerir cuál conservar y filtrar.

export interface ParSimilar {
  a_id: string;
  b_id: string;
  similitud: number;
}

export interface UsoCatalogo {
  id: string;
  texto: string;
  clave: string | null;
  unidad: string | null;
  empresa_id: string | null;
  activo: boolean;
  existencia: number;
  movimientos: number;
  conteos: number;
  requisiciones: number;
  ventas: number;
  proveedores: number;
  productos: number;
  extra: Record<string, unknown> | null;
}

export interface GrupoSimilar {
  /** Ids de los miembros, el sugerido a conservar primero. */
  ids: string[];
  /** La similitud más alta dentro del grupo. */
  maxima: number;
  /** La más baja entre pares del grupo (para avisar grupos "flojos"). */
  minima: number;
}

/** Une los pares en grupos (quien se parece a quien se parece a…); no pasa de `maxTamano` por grupo. */
export function agruparSimilares(pares: ParSimilar[], umbral: number, maxTamano = 12): GrupoSimilar[] {
  const validos = pares.filter((p) => p.similitud >= umbral).sort((a, b) => b.similitud - a.similitud);
  const padre = new Map<string, string>();
  const tamano = new Map<string, number>();
  const raiz = (x: string): string => {
    let r = x;
    while (padre.get(r) && padre.get(r) !== r) r = padre.get(r)!;
    padre.set(x, r);
    return r;
  };
  const alta = (x: string) => {
    if (!padre.has(x)) {
      padre.set(x, x);
      tamano.set(x, 1);
    }
  };
  for (const p of validos) {
    alta(p.a_id);
    alta(p.b_id);
    const ra = raiz(p.a_id);
    const rb = raiz(p.b_id);
    if (ra === rb) continue;
    if ((tamano.get(ra) ?? 1) + (tamano.get(rb) ?? 1) > maxTamano) continue;
    padre.set(rb, ra);
    tamano.set(ra, (tamano.get(ra) ?? 1) + (tamano.get(rb) ?? 1));
  }
  const grupos = new Map<string, GrupoSimilar>();
  for (const id of padre.keys()) {
    const r = raiz(id);
    let g = grupos.get(r);
    if (!g) {
      g = { ids: [], maxima: 0, minima: 1 };
      grupos.set(r, g);
    }
    g.ids.push(id);
  }
  for (const p of validos) {
    const ra = raiz(p.a_id);
    if (ra !== raiz(p.b_id)) continue;
    const g = grupos.get(ra)!;
    g.maxima = Math.max(g.maxima, p.similitud);
    g.minima = Math.min(g.minima, p.similitud);
  }
  return [...grupos.values()].filter((g) => g.ids.length > 1).sort((a, b) => b.maxima - a.maxima || b.ids.length - a.ids.length);
}

/** Puntos de uso: a más uso, más conviene conservarlo (inventario y movimientos pesan más). */
export function puntosUso(u: UsoCatalogo): number {
  return u.movimientos * 10 + Math.abs(u.existencia) * 2 + u.conteos * 5 + u.requisiciones * 3 + u.ventas * 5 + u.proveedores * 5 + u.productos * 5 + (u.clave ? 1 : 0);
}

/** Ordena los miembros de un grupo: el que más se usa (y, en empate, el más viejo) primero = sugerido a conservar. */
export function ordenarParaConservar(ids: string[], uso: Map<string, UsoCatalogo>): string[] {
  const creado = (id: string) => String(uso.get(id)?.extra?.created_at ?? "");
  return [...ids].sort((a, b) => {
    const ua = uso.get(a);
    const ub = uso.get(b);
    const pa = ua ? puntosUso(ua) : -1;
    const pb = ub ? puntosUso(ub) : -1;
    return pb - pa || creado(a).localeCompare(creado(b)) || a.localeCompare(b);
  });
}

/** Lo que se mueve al conservar `destino` y fusionar el resto (para el texto de confirmación). */
export function resumenFusion(destino: string, origenes: string[], uso: Map<string, UsoCatalogo>, tipo: "item" | "producto"): string {
  const d = uso.get(destino);
  const o = origenes.map((id) => uso.get(id)).filter((x): x is UsoCatalogo => !!x);
  const partes: string[] = [];
  if (tipo === "producto") {
    const exist = o.reduce((s, x) => s + Number(x.existencia), 0);
    const mov = o.reduce((s, x) => s + x.movimientos, 0);
    const con = o.reduce((s, x) => s + x.conteos, 0);
    const req = o.reduce((s, x) => s + x.requisiciones, 0);
    const ven = o.reduce((s, x) => s + x.ventas, 0);
    if (mov) partes.push(`${mov} movimiento(s) de inventario (existencia ${exist.toLocaleString("es-MX")} que se suma a ${Number(d?.existencia ?? 0).toLocaleString("es-MX")})`);
    if (con) partes.push(`${con} renglón(es) de conteo`);
    if (req) partes.push(`${req} renglón(es) de requisición`);
    if (ven) partes.push(`${ven} venta(s) del mostrador`);
  } else {
    const prov = o.reduce((s, x) => s + x.proveedores, 0);
    const prod = o.reduce((s, x) => s + x.productos, 0);
    if (prov) partes.push(`${prov} precio(s) de proveedor`);
    if (prod) partes.push(`${prod} artículo(s) de inventario ligado(s)`);
  }
  const nombres = o.map((x) => `${x.clave ? x.clave + " · " : ""}${x.texto}`).join(", ");
  return `Se conserva ${d?.clave ? d.clave + " · " : ""}${d?.texto ?? "?"}. ${nombres} queda(n) inactivo(s)${partes.length ? ` y pasa(n) al conservado: ${partes.join("; ")}` : " (sin movimientos ni usos)"}. Se puede deshacer desde el historial.`;
}

/** Filtra grupos por texto (sobre nombres y claves de sus miembros). */
export function filtrarGrupos(grupos: GrupoSimilar[], uso: Map<string, UsoCatalogo>, texto: string): GrupoSimilar[] {
  const t = sinAcentos(texto.trim());
  if (!t) return grupos;
  const partes = t.split(/\s+/);
  return grupos.filter((g) => {
    const pajar = sinAcentos(g.ids.map((id) => `${uso.get(id)?.clave ?? ""} ${uso.get(id)?.texto ?? ""}`).join(" "));
    return partes.every((p) => pajar.includes(p));
  });
}

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export const UMBRALES = [
  { valor: 0.9, etiqueta: "Casi iguales (≥ 90 %)" },
  { valor: 0.8, etiqueta: "Muy parecidos (≥ 80 %)" },
  { valor: 0.7, etiqueta: "Parecidos (≥ 70 %)" },
  { valor: 0.6, etiqueta: "Algo parecidos (≥ 60 %)" },
  { valor: 0.5, etiqueta: "Todo lo sugerido (≥ 50 %)" },
];
