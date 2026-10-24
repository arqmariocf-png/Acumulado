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
export function revisarOrden(o: { contraparte: string; empresaId: string; partidas: PartidaCaptura[]; formaPago?: string }, tipo: TipoOrden): string[] {
  const errores: string[] = [];
  if (!o.empresaId) errores.push("Elige la empresa.");
  if (!o.contraparte.trim()) errores.push(`Escribe el ${infoTipo(tipo).contraparte.toLowerCase()}.`);
  // Sin forma de pago de fábrica (20-oct-2026, Laura: las de efectivo se
  // guardaban como transferencia porque venía puesta): en OC/OS se elige.
  if (tipo !== "OV" && o.formaPago !== undefined && !o.formaPago.trim()) errores.push("Elige la forma de pago (efectivo, transferencia…).");
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

/** Excel (CSV) de la lista de órdenes: compras y servicios juntos en un solo
 * archivo (19-oct-2026). Más reciente primero, como en pantalla. */
/** Columnas en el orden que pidió Laura (20-oct-2026): Empresa · Folio · Tipo ·
 * Proveedor · Tipo de pago · Proyecto · Monto · Fecha · Estatus. */
export const COLUMNAS_EXCEL_ORDENES = ["Empresa", "Folio", "Tipo", "Proveedor / cliente", "Tipo de pago", "Proyecto", "Monto c/IVA", "Fecha", "Estatus"];

/** El Excel va ordenado por folio (id) de menor a mayor, como lo revisa Laura
 * (23-oct-2026). OC y OS comparten una sola serie (IA-OC-0003, IA-OS-0004,
 * IA-OC-0005…), así que se ordena por el NÚMERO del folio y no por el texto:
 * comparar el texto ponía todas las OC y luego todas las OS (Laura, 24-oct-2026:
 * "no están en orden"). Primero los folios sin serie (backoffice) y luego cada
 * serie (IA-, RQ-…) por su consecutivo. */
export function claveFolio(folio: string): { serie: string; numero: number } {
  const m = /(\d+)\s*$/.exec(folio.trim());
  const numero = m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  const serie = folio
    .trim()
    .replace(/\d+\s*$/, "")
    .replace(/-(OC|OS|OV)-$/i, "-")
    .toUpperCase();
  return { serie, numero };
}

export function ordenarPorFolio<T extends { folio: string }>(filas: T[]): T[] {
  return [...filas].sort((a, b) => {
    const ka = claveFolio(a.folio);
    const kb = claveFolio(b.folio);
    return ka.serie.localeCompare(kb.serie) || ka.numero - kb.numero || a.folio.localeCompare(b.folio, "es", { numeric: true });
  });
}

export function csvOrdenes(filas: { tipo: TipoOrden; folio: string; fecha: string | null; empresa: string; contraparte: string | null; forma_pago?: string | null; proyecto: string | null; total: number | null; estado: string }[]): string {
  const celda = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const tipoTexto: Record<TipoOrden, string> = { OC: "Compra", OS: "Servicio", OV: "Venta" };
  const renglones = [COLUMNAS_EXCEL_ORDENES];
  for (const o of ordenarPorFolio(filas)) {
    renglones.push([o.empresa, o.folio, tipoTexto[o.tipo], o.contraparte ?? "", o.forma_pago ?? "", o.proyecto ?? "", o.total == null ? "" : Number(o.total).toFixed(2), o.fecha ?? "", o.estado]);
  }
  return renglones.map((r) => r.map(celda).join(",")).join("\n");
}

export interface LineaExcelOrden {
  numero: number | null;
  concepto: string | null;
  unidad: string | null;
  cantidad: number | null;
  precio: number | null;
  iva: boolean | null;
}

export const COLUMNAS_DETALLE_ORDENES = ["Partida", "Concepto", "Unidad", "Cantidad", "Precio unitario s/IVA", "Importe c/IVA"];

/** Excel de órdenes con el detalle (Laura, 22-oct-2026: "en la descarga de
 * Excel de órdenes de venta, poner el detalle de cada una"): un renglón por
 * partida con los datos de la orden repetidos; una orden sin partidas sale en
 * un renglón con el detalle vacío. Las del backoffice traen el precio con IVA
 * (el total es la suma de cantidad × precio); las de aquí, sin IVA. */
export function csvOrdenesConDetalle(
  filas: { id: string; tipo: TipoOrden; folio: string; fecha: string | null; empresa: string; contraparte: string | null; forma_pago?: string | null; proyecto: string | null; total: number | null; estado: string; fuente: string }[],
  lineas: Map<string, LineaExcelOrden[]>,
): string {
  const celda = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const tipoTexto: Record<TipoOrden, string> = { OC: "Compra", OS: "Servicio", OV: "Venta" };
  const r2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  const renglones = [[...COLUMNAS_EXCEL_ORDENES, ...COLUMNAS_DETALLE_ORDENES]];
  for (const o of ordenarPorFolio(filas)) {
    const base = [o.empresa, o.folio, tipoTexto[o.tipo], o.contraparte ?? "", o.forma_pago ?? "", o.proyecto ?? "", o.total == null ? "" : Number(o.total).toFixed(2), o.fecha ?? "", o.estado];
    const ls = [...(lineas.get(o.id) ?? [])].sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
    if (!ls.length) {
      renglones.push([...base, "", "", "", "", "", ""]);
      continue;
    }
    const conIvaIncluido = o.fuente !== "acumulado";
    ls.forEach((l, i) => {
      const cant = Number(l.cantidad) || 0;
      const precio = Number(l.precio) || 0;
      const factor = l.iva === false ? 1 : 1.16;
      const sinIva = conIvaIncluido ? precio / factor : precio;
      const importe = conIvaIncluido ? cant * precio : cant * precio * factor;
      renglones.push([...base, String(l.numero ?? i + 1), l.concepto ?? "", l.unidad ?? "", String(cant), r2(sinIva), r2(importe)]);
    });
  }
  return renglones.map((r) => r.map(celda).join(",")).join("\n");
}
