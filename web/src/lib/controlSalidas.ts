// Control de salidas en caseta (seguridad y monitoreo, 20-nov-2026): la
// caseta escanea el QR de la remisión de salida, cuenta lo que sale y lo
// registra; Gonzalo lo monitorea. Reglas puras, sin DOM ni Supabase.

export type OrigenSalida = "almacen" | "planta";

export interface LineaRemisionSalida {
  descripcion: string;
  unidad: string | null;
  cantidad: number;
}

export interface LineaConteo {
  descripcion: string;
  unidad: string | null;
  cantidad_remision: number;
  cantidad_contada: number;
}

export interface ResultadoConteo {
  resultado: "coincide" | "diferencia";
  totalRemision: number;
  totalContado: number;
  /** Partidas cuya cantidad contada no coincide con la remisión. */
  diferencias: { descripcion: string; remision: number; contado: number; diferencia: number }[];
}

const RE_LIGA = /\/(inventario|produccion)\/remisiones\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_FOLIO = /^(REM|RM)-[A-Z0-9]{2,6}-\d{3,8}$/i;

/** Qué trae lo escaneado: la liga del QR (almacén o planta), un id suelto o
 * un folio REM-XXX-000001 escrito a mano. `null` si no parece una remisión. */
export function interpretarCodigoSalida(texto: string): { tipo: "liga"; origen: OrigenSalida; id: string } | { tipo: "id"; id: string } | { tipo: "folio"; folio: string } | null {
  const t = texto.trim();
  if (!t) return null;
  const liga = t.match(RE_LIGA);
  if (liga) return { tipo: "liga", origen: liga[1].toLowerCase() === "inventario" ? "almacen" : "planta", id: liga[2].toLowerCase() };
  if (RE_UUID.test(t)) return { tipo: "id", id: t.toLowerCase() };
  const folio = t.replace(/\s+/g, "").toUpperCase();
  if (RE_FOLIO.test(folio)) return { tipo: "folio", folio };
  return null;
}

/** Arma el conteo inicial: lo contado arranca igual que la remisión y la
 * caseta corrige lo que no cuadre. */
export function conteoInicial(lineas: LineaRemisionSalida[]): LineaConteo[] {
  return lineas.map((l) => ({ descripcion: l.descripcion, unidad: l.unidad, cantidad_remision: Number(l.cantidad) || 0, cantidad_contada: Number(l.cantidad) || 0 }));
}

export function compararConteo(lineas: LineaConteo[]): ResultadoConteo {
  let totalRemision = 0;
  let totalContado = 0;
  const diferencias: ResultadoConteo["diferencias"] = [];
  for (const l of lineas) {
    const r = Number(l.cantidad_remision) || 0;
    const c = Number(l.cantidad_contada) || 0;
    totalRemision += r;
    totalContado += c;
    if (Math.abs(r - c) > 1e-9) diferencias.push({ descripcion: l.descripcion, remision: r, contado: c, diferencia: c - r });
  }
  return { resultado: diferencias.length ? "diferencia" : "coincide", totalRemision, totalContado, diferencias };
}

/** El conteo no se guarda con cantidades vacías o negativas. */
export function revisarConteo(lineas: LineaConteo[]): string | null {
  if (!lineas.length) return "La remisión no tiene partidas que contar.";
  for (const l of lineas) {
    if (!Number.isFinite(l.cantidad_contada) || l.cantidad_contada < 0) return `Captura la cantidad contada de "${l.descripcion}".`;
  }
  return null;
}

export interface FilaMonitor {
  origen: OrigenSalida;
  remision_id: string;
  folio: string;
  fecha: string;
  empresa_codigo: string;
  empresa_nombre: string;
  cliente: string | null;
  destino: string | null;
  estatus: string;
  emitida_por_nombre: string | null;
  partidas: number;
  cantidad_total: number;
  verificacion_id: string | null;
  verificado_en: string | null;
  verificado_por_nombre: string | null;
  resultado: "coincide" | "diferencia" | null;
  total_contado: number | null;
  verificaciones: number;
}

export type EstadoSalida = "pendiente" | "coincide" | "diferencia";

export function estadoSalida(f: Pick<FilaMonitor, "verificacion_id" | "resultado">): EstadoSalida {
  if (!f.verificacion_id) return "pendiente";
  return f.resultado === "diferencia" ? "diferencia" : "coincide";
}

export function resumenMonitor(filas: FilaMonitor[]): { salidas: number; verificadas: number; pendientes: number; conDiferencia: number; porEmpresa: { codigo: string; salidas: number; pendientes: number }[] } {
  const porEmp = new Map<string, { codigo: string; salidas: number; pendientes: number }>();
  let verificadas = 0;
  let conDiferencia = 0;
  for (const f of filas) {
    const e = estadoSalida(f);
    if (e !== "pendiente") verificadas++;
    if (e === "diferencia") conDiferencia++;
    const emp = porEmp.get(f.empresa_codigo) ?? { codigo: f.empresa_codigo, salidas: 0, pendientes: 0 };
    emp.salidas++;
    if (e === "pendiente") emp.pendientes++;
    porEmp.set(f.empresa_codigo, emp);
  }
  return {
    salidas: filas.length,
    verificadas,
    pendientes: filas.length - verificadas,
    conDiferencia,
    porEmpresa: [...porEmp.values()].sort((a, b) => b.salidas - a.salidas || a.codigo.localeCompare(b.codigo)),
  };
}

export function filtrarMonitor(filas: FilaMonitor[], estado: EstadoSalida | "todas", texto: string): FilaMonitor[] {
  const t = texto.trim().toLowerCase();
  return filas.filter((f) => (estado === "todas" || estadoSalida(f) === estado) && (!t || [f.folio, f.cliente, f.destino, f.empresa_codigo, f.empresa_nombre, f.verificado_por_nombre].some((v) => v?.toLowerCase().includes(t))));
}

/** A dónde abre una salida desde las pantallas de seguridad: la de planta a
 * su detalle (la ruta acepta seguridad/monitoreo); la de almacén a la caseta
 * con el id, porque el detalle de inventario es solo de almacén. */
export function rutaRemisionSalida(origen: OrigenSalida, id: string): string {
  return origen === "almacen" ? `/seguridad/salidas?codigo=${id}` : `/produccion/remisiones/${id}`;
}

export function textoResultado(r: ResultadoConteo): string {
  if (r.resultado === "coincide") return `Coincide: ${r.totalContado.toLocaleString("es-MX")} piezas contadas, igual que la remisión.`;
  const partes = r.diferencias.map((d) => `${d.descripcion}: remisión ${d.remision.toLocaleString("es-MX")}, contado ${d.contado.toLocaleString("es-MX")} (${d.diferencia > 0 ? "+" : ""}${d.diferencia.toLocaleString("es-MX")})`);
  return `Diferencia en ${r.diferencias.length} partida(s): ${partes.join("; ")}.`;
}
