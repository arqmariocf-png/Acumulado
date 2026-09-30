// Pagos por orden de compra (dirección, 29-sep-2026). Sin DOM: se prueba
// en node. La regla de verdad vive en fn_oc_programar_pago; aquí se replica
// para proponer monto y fecha en la pantalla.

export type CondicionPago = "contado" | "credito" | "anticipo" | "efectivo";

export const ETIQUETA_CONDICION: Record<CondicionPago, string> = { contado: "Contado", credito: "Crédito", anticipo: "Anticipo", efectivo: "Efectivo" };

export interface OcConSaldo {
  total: number | null;
  pagado: number;
  fecha_creacion: string | null;
  dias_credito: number | null;
}

function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Saldo pendiente de la OC: total menos lo pagado (nunca negativo). */
export function saldoOc(oc: Pick<OcConSaldo, "total" | "pagado">): number {
  return Math.max(0, Math.round((Number(oc.total ?? 0) - Number(oc.pagado ?? 0)) * 100) / 100);
}

/** Fecha propuesta para el pago: crédito = fecha de la OC + días de crédito
 * del proveedor (30 si no tiene línea); contado y anticipo = hoy. Nunca en
 * el pasado. */
export function fechaPagoSugerida(condicion: CondicionPago, oc: OcConSaldo, hoy: string): string {
  if (condicion !== "credito") return hoy;
  const base = oc.fecha_creacion ?? hoy;
  const f = sumarDias(base, oc.dias_credito ?? 30);
  return f < hoy ? hoy : f;
}

/** Monto propuesto: el saldo completo, salvo anticipo (la mitad, redondeada). */
export function montoPagoSugerido(condicion: CondicionPago, oc: OcConSaldo): number {
  const saldo = saldoOc(oc);
  if (condicion === "anticipo") return Math.round((saldo / 2) * 100) / 100;
  return saldo;
}

/** Estado de pago de la OC para la etiqueta de la lista. */
export function estadoPagoOc(oc: OcConSaldo & { programado?: number }): "pagada" | "parcial" | "programada" | "sin_programar" {
  const saldo = saldoOc(oc);
  if (saldo <= 0.005) return "pagada";
  if (Number(oc.pagado ?? 0) > 0) return "parcial";
  if (Number(oc.programado ?? 0) > 0) return "programada";
  return "sin_programar";
}

export type Autorizacion = "autorizada" | "pendiente" | "rechazada";

export const ETIQUETA_AUTORIZACION: Record<Autorizacion, string> = { autorizada: "autorizada", pendiente: "pendiente de autorización", rechazada: "rechazada" };

export type EstadoVencimientoOc = "vencida" | "por_vencer" | "vigente";

function diasEntre(a: string, b: string): number {
  const x = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const y = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((x - y) / 86_400_000);
}

/** Vencimiento del crédito de una OC (fecha OC + días del proveedor): rojo
 * vencida, ámbar a 7 días o menos, verde vigente. Null si no es a crédito. */
export function vencimientoCredito(vence: string | null | undefined, hoy: string): { estado: EstadoVencimientoOc; dias: number } | null {
  if (!vence) return null;
  const dias = diasEntre(vence, hoy);
  if (dias < 0) return { estado: "vencida", dias };
  if (dias <= 7) return { estado: "por_vencer", dias };
  return { estado: "vigente", dias };
}

/** Texto corto del vencimiento para la lista. */
export function textoVencimiento(v: { estado: EstadoVencimientoOc; dias: number } | null): string {
  if (!v) return "";
  if (v.estado === "vencida") return v.dias === -1 ? "vencida ayer" : `vencida hace ${-v.dias} días`;
  if (v.dias === 0) return "vence hoy";
  if (v.dias === 1) return "vence mañana";
  return `vence en ${v.dias} días`;
}

/** Cadena Laura → Delia → Alma (29-sep-2026): en qué paso va la OC. */
export type EtapaOc = "por_autorizar" | "rechazada" | "por_programar" | "programada" | "pagada" | "recibida";

export const ETIQUETA_ETAPA_OC: Record<EtapaOc, string> = {
  por_autorizar: "por autorizar",
  rechazada: "rechazada",
  por_programar: "por programar",
  programada: "programado a pago",
  pagada: "pagada",
  recibida: "recibida",
};

export interface OcEnCadena {
  autorizacion: Autorizacion;
  total: number | null;
  pagado: number;
  programado?: number;
  pagada_backoffice?: boolean;
  recepcion_estado?: "recibida" | "parcial" | "sin_recibir" | "sin_partidas" | null;
}

/** Orden de los pasos para pintar el avance (rechazada no avanza). */
export const PASOS_OC: EtapaOc[] = ["por_autorizar", "por_programar", "programada", "pagada", "recibida"];

export function etapaOc(oc: OcEnCadena): EtapaOc {
  if (oc.autorizacion === "rechazada") return "rechazada";
  if (oc.autorizacion === "pendiente") return "por_autorizar";
  const saldo = saldoOc(oc);
  const pagada = saldo <= 0.005 || !!oc.pagada_backoffice;
  if (pagada && oc.recepcion_estado === "recibida") return "recibida";
  if (pagada) return "pagada";
  if (Number(oc.pagado ?? 0) > 0 || Number(oc.programado ?? 0) > 0) return "programada";
  return "por_programar";
}

/** Orden de la lista de OC (Laura, 30-sep-2026: "no salen acomodadas por
 * id, están revueltas"). El folio es texto: se compara como número. */
export type OrdenOc = "folio_desc" | "folio_asc" | "fecha_desc" | "proveedor" | "saldo_desc" | "vence";

export const ETIQUETA_ORDEN_OC: Record<OrdenOc, string> = {
  folio_desc: "Folio (más nuevo primero)",
  folio_asc: "Folio (más viejo primero)",
  fecha_desc: "Fecha de la OC",
  proveedor: "Proveedor (A-Z)",
  saldo_desc: "Saldo (mayor primero)",
  vence: "Vencimiento (más próximo)",
};

interface OcOrdenable {
  id_orden: string;
  fecha_creacion: string | null;
  proveedor: string | null;
  total: number | null;
  pagado: number;
  vence?: string | null;
}

const porFolio = (a: OcOrdenable, b: OcOrdenable) => a.id_orden.localeCompare(b.id_orden, "es", { numeric: true });

export function ordenarOcs<T extends OcOrdenable>(lista: T[], orden: OrdenOc): T[] {
  const copia = [...lista];
  const fecha = (o: OcOrdenable) => o.fecha_creacion ?? "";
  switch (orden) {
    case "folio_asc":
      return copia.sort(porFolio);
    case "fecha_desc":
      return copia.sort((a, b) => fecha(b).localeCompare(fecha(a)) || porFolio(b, a));
    case "proveedor":
      return copia.sort((a, b) => (a.proveedor ?? "").localeCompare(b.proveedor ?? "", "es", { sensitivity: "base" }) || porFolio(b, a));
    case "saldo_desc":
      return copia.sort((a, b) => saldoOc(b) - saldoOc(a) || porFolio(b, a));
    case "vence":
      return copia.sort((a, b) => (a.vence ?? "9999").localeCompare(b.vence ?? "9999") || porFolio(a, b));
    default:
      return copia.sort((a, b) => porFolio(b, a));
  }
}
