/** Órdenes propias de Acumulado (OC / OS / OV con folio IA-<tipo>-0001).
 * Costos y precios de partida van SIN IVA; el IVA se calcula por partida.
 * Puro, con pruebas. La base recalcula todo en fn_orden_ia_guardar. */

export type TipoOrden = "OC" | "OS" | "OV";

export const TIPOS_ORDEN: { tipo: TipoOrden; titulo: string; corto: string; contraparte: string; importe: string }[] = [
  { tipo: "OC", titulo: "ORDEN DE COMPRA", corto: "Compras (OC)", contraparte: "Proveedor", importe: "Costo s/IVA" },
  { tipo: "OS", titulo: "ORDEN DE SERVICIO", corto: "Servicios (OS)", contraparte: "Proveedor", importe: "Costo s/IVA" },
  { tipo: "OV", titulo: "ORDEN DE VENTA", corto: "Ventas (OV)", contraparte: "Cliente", importe: "Precio s/IVA" },
];

export const infoTipo = (t: TipoOrden) => TIPOS_ORDEN.find((x) => x.tipo === t)!;

export const FORMAS_PAGO = ["Transferencia electrónica de fondos", "Efectivo", "Tarjeta de débito", "Tarjeta de crédito", "Cheque"];

export interface PartidaCaptura {
  item: string;
  unidad: string;
  cantidad: number | string;
  costo: number | string;
  iva: boolean;
}

export const partidaVacia = (): PartidaCaptura => ({ item: "", unidad: "", cantidad: "", costo: "", iva: true });

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Renglones capturados de verdad (los vacíos al final no cuentan). */
export function partidasCapturadas(p: PartidaCaptura[]): PartidaCaptura[] {
  return p.filter((l) => l.item.trim() !== "" || String(l.cantidad).trim() !== "" || String(l.costo).trim() !== "");
}

export function importePartida(l: Pick<PartidaCaptura, "cantidad" | "costo">): number {
  return r2(Number(l.cantidad || 0) * Number(l.costo || 0));
}

/** Subtotal, IVA (por partida, 16 %) y total; mismo redondeo que la base. */
export function totalesPartidas(p: PartidaCaptura[]): { subtotal: number; iva: number; total: number } {
  let subtotal = 0;
  let iva = 0;
  for (const l of partidasCapturadas(p)) {
    const imp = Number(l.cantidad || 0) * Number(l.costo || 0);
    subtotal += r2(imp);
    if (l.iva) iva += r2(imp * 0.16);
  }
  return { subtotal: r2(subtotal), iva: r2(iva), total: r2(subtotal + iva) };
}

/** Problemas que impiden guardar (vacío = se puede). */
export function revisarOrden(o: { contraparte: string; empresaId: string; partidas: PartidaCaptura[] }, tipo: TipoOrden): string[] {
  const errores: string[] = [];
  if (!o.empresaId) errores.push("Elige la empresa.");
  if (!o.contraparte.trim()) errores.push(`Escribe el ${infoTipo(tipo).contraparte.toLowerCase()}.`);
  const filas = partidasCapturadas(o.partidas);
  if (filas.length === 0) errores.push("Agrega al menos una partida.");
  filas.forEach((l, i) => {
    const n = i + 1;
    if (!l.item.trim()) errores.push(`Partida ${n}: falta la descripción.`);
    if (!(Number(l.cantidad) > 0)) errores.push(`Partida ${n}: cantidad inválida.`);
    if (String(l.costo).trim() === "" || !(Number(l.costo) >= 0)) errores.push(`Partida ${n}: falta el ${infoTipo(tipo).importe.toLowerCase()}.`);
  });
  return errores;
}

/** Lo que se manda a fn_orden_ia_guardar. */
export function partidasParaGuardar(p: PartidaCaptura[]) {
  return partidasCapturadas(p).map((l) => ({
    item: l.item.trim(),
    unidad: l.unidad.trim() || null,
    cantidad: Number(l.cantidad),
    costo: Number(l.costo),
    iva: l.iva,
  }));
}

export interface EstadoOrdenCompra {
  fuente: string;
  autorizacion: string | null;
  rechazo_motivo?: string | null;
  saldo?: number | null;
  total?: number | null;
  programado?: number | null;
  recepcion_estado?: string | null;
}

/** Etapa de una OC/OS para la lista: cancelada · rechazada · por autorizar ·
 * autorizada · programada · pagada · recibida. */
export function etapaOrdenCompra(o: EstadoOrdenCompra, tipo: "OC" | "OS"): { etiqueta: string; tono: "gris" | "rojo" | "ambar" | "azul" | "verde" } {
  if (o.autorizacion === "rechazada") {
    return (o.rechazo_motivo ?? "").startsWith("Cancelada") ? { etiqueta: "cancelada", tono: "gris" } : { etiqueta: "rechazada", tono: "rojo" };
  }
  if (o.autorizacion !== "autorizada") return { etiqueta: "por autorizar", tono: "ambar" };
  const pagada = Number(o.saldo ?? 0) <= 0.01 && Number(o.total ?? 0) > 0;
  if (pagada && (tipo === "OS" || o.recepcion_estado === "recibida")) return { etiqueta: tipo === "OS" ? "pagada" : "pagada y recibida", tono: "verde" };
  if (pagada) return { etiqueta: "pagada · por recibir", tono: "azul" };
  if (Number(o.programado ?? 0) > 0) return { etiqueta: "pago programado", tono: "azul" };
  return { etiqueta: "autorizada", tono: "azul" };
}

/** Se edita solo lo propio que aún no está autorizado ni cancelado. */
export function ordenEditable(o: { fuente: string; autorizacion?: string | null; cancelada?: boolean }): boolean {
  if (o.fuente !== "acumulado") return false;
  if (o.cancelada) return false;
  return o.autorizacion == null || o.autorizacion === "pendiente";
}
