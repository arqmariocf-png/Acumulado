// Sistemas › Almacenamiento (17-nov-2026): cuánto pesa cada carpeta del bucket
// y recompresión de lo ya guardado con la misma regla que al subir
// (lib/comprimirArchivo). Aquí vive lo puro, con pruebas.

export interface CarpetaResumen {
  carpeta: string;
  archivos: number;
  bytes: number;
  imagenes: number;
  pdfs: number;
  recomprimible: boolean;
  candidatos: number;
  bytes_candidatos: number;
  ultimo: string | null;
}

export interface Candidato {
  ruta: string;
  mime: string | null;
  bytes: number;
  creado: string;
}

export interface AvanceRecompresion {
  hechos: number;
  total: number;
  ahorrados: number;
  sinCambio: number;
  errores: string[];
}

/** Qué es cada carpeta, para la pantalla. */
export const CARPETAS_NOMBRE: Record<string, string> = {
  rh: "Expedientes de RH",
  checador: "Selfies del checador",
  planos: "Planos de obra",
  "estados-cuenta": "Estados de cuenta",
  tareas: "Archivos de tarjetas",
  sat: "Descargas del SAT",
  pagos: "Comprobantes de pago",
  cfdi: "CFDI cargados",
  cxc: "Estados de cuenta de clientes",
  "notas-entrega": "Notas de entrega",
  "oc-excel": "Excel de OC",
  "ov-excel": "Excel de OV",
  legal: "Legal",
  comprobaciones: "Comprobaciones de gastos",
  cotizaciones: "Cotizaciones de requisiciones",
  "remisiones-produccion": "Fotos de remisiones",
};

/** Las selfies del checador se recomprimen a 800 px; lo demás a 1600. */
export function ladoParaCarpeta(carpeta: string): number {
  return carpeta === "checador" ? 800 : 1600;
}

export function mb(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "12 de 74 · ahorrados 210.3 MB · 2 sin cambio · 1 error". */
export function textoAvance(a: AvanceRecompresion): string {
  const partes = [`${a.hechos} de ${a.total}`, `ahorrados ${mb(a.ahorrados)}`];
  if (a.sinCambio) partes.push(`${a.sinCambio} sin cambio`);
  if (a.errores.length) partes.push(`${a.errores.length} error(es)`);
  return partes.join(" · ");
}

/** Lo que vale la pena recomprimir, de mayor a menor ahorro posible. */
export function ordenarCandidatos(lista: Candidato[]): Candidato[] {
  return [...lista].sort((a, b) => b.bytes - a.bytes);
}

/** Estimación conservadora del ahorro: PDF escaneados ~80 %, fotos ~60 %,
 * selfies ~40 %. Solo para que la pantalla diga "podrías liberar ~X". */
export function ahorroEstimado(c: CarpetaResumen): number {
  if (!c.recomprimible || c.candidatos === 0) return 0;
  const factor = c.carpeta === "checador" ? 0.4 : c.pdfs > c.imagenes ? 0.8 : 0.6;
  return Math.round(c.bytes_candidatos * factor);
}

/** Crecimiento mensual estimado con la compresión ya activa (para la nota de
 * retención): selfies ~80 KB × marcas con foto al mes. */
export function crecimientoMensual(fotosMes: number, bytesPorFoto = 80 * 1024): number {
  return Math.max(0, fotosMes) * bytesPorFoto;
}
