// e.firma del SAT por empresa (Mario, 7-oct-2026): estado de vigencia para la
// pantalla de contabilidad y validación ligera antes de subir. La validación
// fuerte (certificado del SAT, contraseña, .cer y .key pareja) la hace la
// edge `sat-efirma`. Puro, con pruebas.

export type EstadoEfirma = "sin_efirma" | "vencida" | "por_vencer" | "vigente";

/** Días antes del vencimiento en que se avisa (renovar en el SAT toma cita). */
export const DIAS_AVISO_EFIRMA = 60;

export function estadoEfirma(vigenteHasta: string | null | undefined, hoy: Date = new Date()): EstadoEfirma {
  if (!vigenteHasta) return "sin_efirma";
  const dias = diasParaVencer(vigenteHasta, hoy);
  if (dias < 0) return "vencida";
  if (dias <= DIAS_AVISO_EFIRMA) return "por_vencer";
  return "vigente";
}

export function diasParaVencer(vigenteHasta: string, hoy: Date = new Date()): number {
  return Math.floor((new Date(vigenteHasta).getTime() - hoy.getTime()) / 86_400_000);
}

export const ETIQUETA_ESTADO: Record<EstadoEfirma, string> = {
  sin_efirma: "sin e.firma",
  vencida: "vencida",
  por_vencer: "por vencer",
  vigente: "vigente",
};

/** Revisión rápida en el navegador; devuelve el error o null. */
export function revisarArchivos(cer: { name: string; size: number } | null, key: { name: string; size: number } | null, password: string): string | null {
  if (!cer) return "Falta el archivo .cer.";
  if (!key) return "Falta el archivo .key.";
  if (!/\.cer$/i.test(cer.name)) return "El certificado debe ser el archivo .cer.";
  if (!/\.key$/i.test(key.name)) return "La llave privada debe ser el archivo .key.";
  if (cer.size > 64 * 1024 || key.size > 64 * 1024) return "Los archivos de la e.firma pesan unos cuantos KB; revisa que sean el .cer y el .key.";
  if (!password) return "Escribe la contraseña de la llave privada.";
  return null;
}

// Hasta qué día está al corriente la descarga del SAT de una empresa
// (20-oct-2026, Mario: "cada cuándo se actualiza, para que pongas ahí la última
// actualización"). La descarga corre cada hora y una vez al día pide lo del día
// anterior, así que lo normal es estar al día hasta ayer o antier.

export interface SolicitudSat {
  tipo: "emitido" | "recibido";
  estado: string;
  fecha_final: string;
  mensaje: string | null;
  created_at: string;
}

export interface ResumenDescargaSat {
  /** Último día cubierto en emitidos Y recibidos (el menor de los dos). */
  alDiaHasta: string | null;
  /** Última vez que se le preguntó al SAT. */
  ultimaSolicitud: string | null;
  /** Mensaje del SAT si la solicitud más reciente de algún tipo falló. */
  error: string | null;
  atrasada: boolean;
}

const LISTAS = new Set(["descargada", "vacia"]);
const FALLIDAS = new Set(["error", "rechazada"]);

export function resumenDescargaSat(solicitudes: SolicitudSat[], hoy: string): ResumenDescargaSat {
  const hasta: Partial<Record<SolicitudSat["tipo"], string>> = {};
  const ultima: Partial<Record<SolicitudSat["tipo"], SolicitudSat>> = {};
  let ultimaSolicitud: string | null = null;
  for (const s of solicitudes) {
    const dia = s.fecha_final.slice(0, 10);
    if (LISTAS.has(s.estado) && (!hasta[s.tipo] || dia > (hasta[s.tipo] as string))) hasta[s.tipo] = dia;
    if (!ultima[s.tipo] || s.created_at > (ultima[s.tipo] as SolicitudSat).created_at) ultima[s.tipo] = s;
    if (!ultimaSolicitud || s.created_at > ultimaSolicitud) ultimaSolicitud = s.created_at;
  }
  const alDiaHasta = hasta.emitido && hasta.recibido ? (hasta.emitido < hasta.recibido ? hasta.emitido : hasta.recibido) : null;
  const fallida = [ultima.emitido, ultima.recibido].find((s) => s && FALLIDAS.has(s.estado));
  const limite = new Date(`${hoy}T12:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - 2);
  const atrasada = solicitudes.length > 0 && (!alDiaHasta || alDiaHasta < limite.toISOString().slice(0, 10));
  return { alDiaHasta, ultimaSolicitud, error: fallida ? fallida.mensaje ?? "el SAT rechazó la solicitud" : null, atrasada };
}
