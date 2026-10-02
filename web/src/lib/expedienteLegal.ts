// Expediente legal de cada empresa (Eréndira vía Mario, 2-oct-2026):
// documentos con vencimiento y observaciones / actas por protocolizar. Sin
// DOM: se prueba en node.

export const TIPOS_DOCUMENTO_EMPRESA: { clave: string; etiqueta: string; venceSugerido?: number }[] = [
  { clave: "acta_constitutiva", etiqueta: "Acta constitutiva" },
  { clave: "acta_asamblea", etiqueta: "Acta de asamblea" },
  { clave: "poder", etiqueta: "Poder notarial" },
  { clave: "folio_mercantil", etiqueta: "Folio mercantil / RPP" },
  { clave: "constancia_fiscal", etiqueta: "Constancia de situación fiscal", venceSugerido: 30 },
  { clave: "opinion_sat", etiqueta: "Opinión de cumplimiento SAT", venceSugerido: 30 },
  { clave: "opinion_imss", etiqueta: "Opinión de cumplimiento IMSS", venceSugerido: 30 },
  { clave: "opinion_infonavit", etiqueta: "Opinión de cumplimiento INFONAVIT", venceSugerido: 30 },
  { clave: "registro_patronal", etiqueta: "Registro patronal IMSS" },
  { clave: "repse", etiqueta: "REPSE", venceSugerido: 1095 },
  { clave: "licencia_funcionamiento", etiqueta: "Licencia de funcionamiento", venceSugerido: 365 },
  { clave: "proteccion_civil", etiqueta: "Dictamen de protección civil", venceSugerido: 365 },
  { clave: "contrato", etiqueta: "Contrato" },
  { clave: "otro", etiqueta: "Otro" },
];

export function etiquetaTipoDocumento(clave: string): string {
  return TIPOS_DOCUMENTO_EMPRESA.find((t) => t.clave === clave)?.etiqueta ?? clave;
}

/** Motivos frecuentes para protocolizar un acta (se sugieren al capturar;
 * se puede escribir otro). */
export const MOTIVOS_PROTOCOLIZACION: string[] = [
  "Nombramiento o cambio de administrador único / consejo",
  "Otorgamiento de poderes",
  "Revocación de poderes",
  "Aumento o reducción de capital",
  "Entrada o salida de socios / transmisión de acciones",
  "Cambio de domicilio social",
  "Modificación del objeto social",
  "Cambio de denominación",
  "Aprobación de estados financieros del ejercicio (asamblea anual)",
  "Nombramiento de comisario",
  "Fusión, escisión o transformación",
  "Disolución y liquidación",
];

export const ESTATUS_OBSERVACION: Record<string, string> = {
  pendiente: "Pendiente",
  en_notaria: "En notaría",
  protocolizada: "Protocolizada",
  atendida: "Atendida",
  descartada: "Descartada",
};

export type EstadoVencimiento = "vencido" | "por_vencer" | "vigente" | "sin_vencimiento";

function diasEntre(desdeIso: string, hastaIso: string): number {
  const [a1, m1, d1] = desdeIso.slice(0, 10).split("-").map(Number);
  const [a2, m2, d2] = hastaIso.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

/** Semáforo de un documento: vencido (rojo), por vencer en ≤ `aviso` días
 * (ámbar, 30 por defecto), vigente (verde) o sin vencimiento. */
export function estadoVencimiento(vence: string | null, hoyIso: string, aviso = 30): { estado: EstadoVencimiento; dias: number | null } {
  if (!vence) return { estado: "sin_vencimiento", dias: null };
  const dias = diasEntre(hoyIso, vence);
  if (dias < 0) return { estado: "vencido", dias };
  if (dias <= aviso) return { estado: "por_vencer", dias };
  return { estado: "vigente", dias };
}

export function textoVencimiento(vence: string | null, hoyIso: string): string {
  const { estado, dias } = estadoVencimiento(vence, hoyIso);
  if (estado === "sin_vencimiento") return "sin vencimiento";
  if (estado === "vencido") return `vencido hace ${-dias!} d`;
  if (dias === 0) return "vence hoy";
  return `vence en ${dias} d`;
}

/** Fecha de vencimiento sugerida a partir de la fecha del documento. */
export function venceSugerido(tipo: string, fechaDocumento: string | null): string | null {
  const dias = TIPOS_DOCUMENTO_EMPRESA.find((t) => t.clave === tipo)?.venceSugerido;
  if (!dias || !fechaDocumento) return null;
  const [a, m, d] = fechaDocumento.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export interface ResumenExpediente {
  vencidos: number;
  porVencer: number;
  vigentes: number;
  sinArchivo: number;
  pendientesProtocolizar: number;
}

export function resumenExpediente(
  documentos: { vence: string | null; storage_path: string | null }[],
  observaciones: { tipo: string; estatus: string }[],
  hoyIso: string,
): ResumenExpediente {
  const r: ResumenExpediente = { vencidos: 0, porVencer: 0, vigentes: 0, sinArchivo: 0, pendientesProtocolizar: 0 };
  for (const d of documentos) {
    const { estado } = estadoVencimiento(d.vence, hoyIso);
    if (estado === "vencido") r.vencidos++;
    else if (estado === "por_vencer") r.porVencer++;
    else r.vigentes++;
    if (!d.storage_path) r.sinArchivo++;
  }
  r.pendientesProtocolizar = observaciones.filter((o) => o.tipo === "protocolizacion" && (o.estatus === "pendiente" || o.estatus === "en_notaria")).length;
  return r;
}
