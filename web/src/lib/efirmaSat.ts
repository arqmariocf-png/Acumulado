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
