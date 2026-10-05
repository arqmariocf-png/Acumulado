// Seguimiento por renglón de requisición (29-sep-2026, Jonathan y Mario;
// entrega a obra 5-oct-2026 con Alma: bodega es un paso, el destino final es
// la obra): pedido, recibido en bodega, enviado a obra, recibido en obra,
// directo en obra, se queda en bodega, faltante, devolución y cambio. Los
// totales se calculan de la bitácora requisicion_linea_eventos; la base
// aplica las mismas reglas (trigger requisicion_linea_eventos_antes).
//
//   pedido     = Σ pedido − Σ devolución
//   entregado  = Σ entregado − Σ devolución − Σ cambio
//   devolución = la pieza regresa y NO se repone
//   cambio     = la pieza regresa para que la repongan (queda pendiente de
//                entregar otra vez)

export type TipoEvento =
  | "pedido"
  | "en_bodega"
  | "enviado_obra"
  | "entregado"
  | "directo_obra"
  | "queda_bodega"
  | "faltante"
  | "regreso_bodega"
  | "devolucion"
  | "cambio"
  | "comentario";

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

export type EstadoSeguimiento = "sin_pedir" | "pedido_parcial" | "pedido" | "en_bodega" | "en_transito" | "entregado_parcial" | "entregado";

/** Lo que llega de las OC del sistema para el renglón (v_requisicion_linea_entrega). */
export interface ExtraLinea {
  comprado?: number;
  ocBodega?: number;
  ocObra?: number;
}

export interface Seguimiento {
  pedido: number;
  /** Recibido en obra neto (entregado + directo + OC en obra − devolución − cambio). */
  entregado: number;
  recibidoBodega: number;
  enviado: number;
  enTransito: number;
  enBodega: number;
  quedaBodega: number;
  /** Cumplido: en obra + lo que se queda en bodega. */
  final: number;
  devuelto: number;
  enCambio: number;
  faltante: number;
  porPedir: number;
  porEntregar: number;
  /** 0-100: promedio de pedido · en bodega · en camino · en obra. */
  avance: number;
  estado: EstadoSeguimiento;
  comentarios: EventoLinea[];
}

export const ETIQUETA_EVENTO: Record<TipoEvento, string> = {
  pedido: "Pedido",
  en_bodega: "Recibido en bodega",
  enviado_obra: "Enviado a obra",
  entregado: "Recibido en obra",
  directo_obra: "Directo en obra",
  queda_bodega: "Se queda en bodega",
  faltante: "Faltante",
  regreso_bodega: "Regresa a bodega",
  devolucion: "Devolución",
  cambio: "Cambio",
  comentario: "Comentario",
};

export const ETIQUETA_SEGUIMIENTO: Record<EstadoSeguimiento, string> = {
  sin_pedir: "sin pedir",
  pedido_parcial: "pedido parcial",
  pedido: "pedido",
  en_bodega: "en bodega",
  en_transito: "en camino a obra",
  entregado_parcial: "en obra parcial",
  entregado: "en obra",
};

const redondear = (n: number) => Math.round(n * 1000) / 1000;

/** Mismas cuentas que la vista v_requisicion_linea_entrega. */
export function seguimientoLinea(solicitado: number, eventos: EventoLinea[], extra: ExtraLinea = {}): Seguimiento {
  const suma: Record<string, number> = {};
  for (const e of eventos) suma[e.tipo] = (suma[e.tipo] ?? 0) + Number(e.cantidad ?? 0);
  const v = (t: TipoEvento) => suma[t] ?? 0;
  const ocBodega = extra.ocBodega ?? 0;
  const ocObra = extra.ocObra ?? 0;
  const enObra = Math.max(0, v("entregado") + v("directo_obra") + ocObra - v("devolucion") - v("cambio"));
  const final = enObra + v("queda_bodega");
  const enTransito = Math.max(0, v("enviado_obra") - v("entregado") - v("faltante") - v("regreso_bodega"));
  const enBodega = Math.max(0, v("en_bodega") + ocBodega - v("enviado_obra") + v("regreso_bodega") - v("queda_bodega"));
  const pedidoNeto = Math.max(0, v("pedido") - v("devolucion"));
  const tope = (n: number) => Math.min(solicitado, n);
  const n4 = tope(final);
  const n3 = tope(final + enTransito);
  const n2 = tope(final + enTransito + enBodega);
  const n1 = tope(Math.max(final + enTransito + enBodega, pedidoNeto, extra.comprado ?? 0));
  const avance = solicitado > 0 ? Math.round((250 * (n1 + n2 + n3 + n4)) / solicitado) / 10 : 0;
  const porPedir = redondear(Math.max(0, solicitado - Math.max(pedidoNeto, extra.comprado ?? 0)));
  const porEntregar = redondear(Math.max(0, Math.max(pedidoNeto, solicitado) - final));
  let estado: EstadoSeguimiento = "sin_pedir";
  if (solicitado > 0 && n4 >= solicitado - 0.001) estado = "entregado";
  else if (enTransito > 0) estado = "en_transito";
  else if (enBodega > 0) estado = "en_bodega";
  else if (final > 0) estado = "entregado_parcial";
  else if (n1 >= solicitado - 0.001 && solicitado > 0) estado = "pedido";
  else if (n1 > 0) estado = "pedido_parcial";
  const comentarios = eventos
    .filter((e) => e.tipo === "comentario" || (["devolucion", "cambio", "faltante", "regreso_bodega"].includes(e.tipo) && e.nota))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    pedido: redondear(pedidoNeto),
    entregado: redondear(enObra),
    recibidoBodega: redondear(v("en_bodega") + ocBodega),
    enviado: redondear(v("enviado_obra")),
    enTransito: redondear(enTransito),
    enBodega: redondear(enBodega),
    quedaBodega: redondear(v("queda_bodega")),
    final: redondear(final),
    devuelto: redondear(v("devolucion") + v("cambio")),
    enCambio: redondear(v("cambio")),
    faltante: redondear(v("faltante")),
    porPedir,
    porEntregar,
    avance,
    estado,
    comentarios,
  };
}

/** Promedio de avance de varias partidas (la requisición). */
export function avancePartidas(partidas: Seguimiento[]): number {
  if (partidas.length === 0) return 0;
  return Math.round((10 * partidas.reduce((s, p) => s + p.avance, 0)) / partidas.length) / 10;
}

export type GrupoEvento = "todos" | "bodega" | "obra";
/** Quién marca cada paso (misma regla que requisicion_linea_eventos_antes):
 * bodega = almacén; obra = quien pidió o responsable/comprador del proyecto. */
export const GRUPO_EVENTO: Record<TipoEvento, GrupoEvento> = {
  pedido: "todos",
  comentario: "todos",
  en_bodega: "bodega",
  enviado_obra: "bodega",
  queda_bodega: "bodega",
  regreso_bodega: "bodega",
  entregado: "obra",
  directo_obra: "obra",
  faltante: "obra",
  devolucion: "obra",
  cambio: "obra",
};

export function puedeMarcarEvento(tipo: TipoEvento, rol: string | null | undefined, esDeLaObra: boolean): boolean {
  const g = GRUPO_EVENTO[tipo];
  if (g === "todos") return !!rol;
  if (g === "bodega") return ["almacen", "empresa", "admin", "corporativo"].includes(rol ?? "");
  return esDeLaObra || ["admin", "corporativo", "empresa"].includes(rol ?? "");
}

/** Cantidad que propone el botón de cada marca. */
export function cantidadSugerida(tipo: Exclude<TipoEvento, "comentario">, solicitado: number, s: Seguimiento): number {
  switch (tipo) {
    case "pedido":
      return s.porPedir > 0 ? s.porPedir : solicitado;
    case "en_bodega":
      return Math.max(0, solicitado - s.recibidoBodega) || solicitado;
    case "enviado_obra":
    case "queda_bodega":
      return s.enBodega;
    case "entregado":
    case "faltante":
    case "regreso_bodega":
      return s.enTransito > 0 ? s.enTransito : s.porEntregar;
    case "directo_obra":
      return s.porEntregar > 0 ? s.porEntregar : solicitado;
    default:
      return s.entregado;
  }
}

/** Valida una marca antes de mandarla (la base vuelve a validar). */
export function validarEvento(tipo: TipoEvento, cantidad: number | null, nota: string, s: Seguimiento): string | null {
  if (tipo === "comentario") return nota.trim() ? null : "Escribe el comentario.";
  if (cantidad == null || !(cantidad > 0)) return "La cantidad debe ser mayor a 0.";
  if (["devolucion", "cambio", "faltante", "regreso_bodega"].includes(tipo) && !nota.trim()) return "Escribe el motivo.";
  if ((tipo === "devolucion" || tipo === "cambio") && cantidad > s.entregado + 0.0001) return `Solo se puede devolver lo recibido en obra (${s.entregado}).`;
  if ((tipo === "enviado_obra" || tipo === "queda_bodega") && cantidad > s.enBodega + 0.0001) return `En bodega solo hay ${s.enBodega}.`;
  if ((tipo === "faltante" || tipo === "regreso_bodega") && cantidad > s.enTransito + 0.0001) return `En camino a obra solo hay ${s.enTransito}.`;
  return null;
}
