// Seguimiento por renglón de requisición (29-sep-2026, Jonathan y Mario):
// marcas de pedido, entregado, devolución y cambio, más comentarios. Los
// totales se calculan de la bitácora requisicion_linea_eventos; la base
// aplica las mismas reglas (trigger requisicion_linea_eventos_antes).
//
//   pedido     = Σ pedido − Σ devolución
//   entregado  = Σ entregado − Σ devolución − Σ cambio
//   devolución = la pieza regresa y NO se repone
//   cambio     = la pieza regresa para que la repongan (queda pendiente de
//                entregar otra vez)

export type TipoEvento = "pedido" | "entregado" | "devolucion" | "cambio" | "comentario";

export interface EventoLinea {
  id: string;
  requisicion_linea_id: string;
  tipo: TipoEvento;
  cantidad: number | null;
  nota: string | null;
  created_by: string | null;
  created_by_nombre: string | null;
  created_at: string;
}

export type EstadoSeguimiento = "sin_pedir" | "pedido_parcial" | "pedido" | "entregado_parcial" | "entregado";

export interface Seguimiento {
  pedido: number;
  entregado: number;
  devuelto: number;
  enCambio: number;
  porPedir: number;
  porEntregar: number;
  estado: EstadoSeguimiento;
  comentarios: EventoLinea[];
}

export const ETIQUETA_EVENTO: Record<TipoEvento, string> = {
  pedido: "Pedido",
  entregado: "Entregado",
  devolucion: "Devolución",
  cambio: "Cambio",
  comentario: "Comentario",
};

export const ETIQUETA_SEGUIMIENTO: Record<EstadoSeguimiento, string> = {
  sin_pedir: "sin pedir",
  pedido_parcial: "pedido parcial",
  pedido: "pedido",
  entregado_parcial: "entregado parcial",
  entregado: "entregado",
};

const redondear = (n: number) => Math.round(n * 1000) / 1000;

export function seguimientoLinea(solicitado: number, eventos: EventoLinea[]): Seguimiento {
  let pedido = 0;
  let entregado = 0;
  let devolucion = 0;
  let cambio = 0;
  for (const e of eventos) {
    const c = Number(e.cantidad ?? 0);
    if (e.tipo === "pedido") pedido += c;
    else if (e.tipo === "entregado") entregado += c;
    else if (e.tipo === "devolucion") devolucion += c;
    else if (e.tipo === "cambio") cambio += c;
  }
  const pedidoNeto = redondear(Math.max(0, pedido - devolucion));
  const entregadoNeto = redondear(Math.max(0, entregado - devolucion - cambio));
  const porPedir = redondear(Math.max(0, solicitado - pedidoNeto));
  // Lo que falta entregar se mide contra lo pedido si ya se pidió más de lo
  // entregado; si nadie marcó pedido, contra lo solicitado.
  const porEntregar = redondear(Math.max(0, Math.max(pedidoNeto, solicitado) - entregadoNeto));
  let estado: EstadoSeguimiento = "sin_pedir";
  if (entregadoNeto >= solicitado - 0.001 && solicitado > 0) estado = "entregado";
  else if (entregadoNeto > 0) estado = "entregado_parcial";
  else if (pedidoNeto >= solicitado - 0.001 && solicitado > 0) estado = "pedido";
  else if (pedidoNeto > 0) estado = "pedido_parcial";
  const comentarios = eventos
    .filter((e) => e.tipo === "comentario" || ((e.tipo === "devolucion" || e.tipo === "cambio") && e.nota))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    pedido: pedidoNeto,
    entregado: entregadoNeto,
    devuelto: redondear(devolucion + cambio),
    enCambio: redondear(cambio),
    porPedir,
    porEntregar,
    estado,
    comentarios,
  };
}

/** Cantidad que propone el botón de cada marca. */
export function cantidadSugerida(tipo: Exclude<TipoEvento, "comentario">, solicitado: number, s: Seguimiento): number {
  if (tipo === "pedido") return s.porPedir > 0 ? s.porPedir : solicitado;
  if (tipo === "entregado") return s.porEntregar > 0 ? s.porEntregar : solicitado;
  return s.entregado;
}

/** Valida una marca antes de mandarla (la base vuelve a validar). */
export function validarEvento(tipo: TipoEvento, cantidad: number | null, nota: string, s: Seguimiento): string | null {
  if (tipo === "comentario") return nota.trim() ? null : "Escribe el comentario.";
  if (cantidad == null || !(cantidad > 0)) return "La cantidad debe ser mayor a 0.";
  if (tipo === "devolucion" || tipo === "cambio") {
    if (!nota.trim()) return "Escribe el motivo de la devolución o el cambio.";
    if (cantidad > s.entregado + 0.0001) return `Solo se puede devolver lo entregado (${s.entregado}).`;
  }
  return null;
}
