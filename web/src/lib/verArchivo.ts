// Visor de archivos privados (Fernando, 6-oct-2026: "InvalidJWT exp claim
// timestamp check failed"). Las funciones devuelven una liga firmada de
// Storage que caduca en 1-60 minutos; abrirla directo en una pestaña hacía
// que, al volver a la pestaña o al recargarla Safari, saliera ese error. Ahora
// la pestaña abre /archivo?f=<fuente>&id=<id> (una ruta de la app) y la
// página pide una liga nueva cada vez que se carga. Puro, sin DOM.

export const FUENTES_ARCHIVO = {
  rh: { funcion: "rh-documentos", param: "documentoId", titulo: "Documento del expediente" },
  checador: { funcion: "checador-marcar", param: "registroId", titulo: "Foto del checador" },
  tarea: { funcion: "tareas-archivos", param: "archivoId", titulo: "Archivo de la tarea" },
  plano: { funcion: "proyecto-archivos", param: "planoId", titulo: "Plano" },
  pago: { funcion: "pagos-comprobante", param: "id", titulo: "Comprobante de pago" },
  cotizacion: { funcion: "requisiciones-cotizacion", param: "id", titulo: "Cotización" },
  gasto: { funcion: "gastos-comprobar", param: "id", titulo: "Comprobante de gasto" },
} as const;

export type FuenteArchivo = keyof typeof FUENTES_ARCHIVO;

export function esFuenteArchivo(v: string | null | undefined): v is FuenteArchivo {
  return !!v && Object.prototype.hasOwnProperty.call(FUENTES_ARCHIVO, v);
}

/** Ruta de la app que muestra el archivo (lo que se abre en la pestaña nueva). */
export function rutaVerArchivo(fuente: FuenteArchivo, id: string): string {
  return `/archivo?f=${fuente}&id=${encodeURIComponent(id)}`;
}

/** Ruta (relativa a functions/v1) que devuelve { url } firmada y fresca. */
export function consultaFirmada(fuente: FuenteArchivo, id: string): string {
  const { funcion, param } = FUENTES_ARCHIVO[fuente];
  return `${funcion}?${param}=${encodeURIComponent(id)}`;
}

export type ClaseArchivo = "imagen" | "pdf" | "otro";

/** Por la extensión del archivo en la liga firmada (antes del ?token=). */
export function claseArchivo(url: string): ClaseArchivo {
  const ruta = url.split("?")[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/.test(ruta)) return "imagen";
  if (ruta.endsWith(".pdf")) return "pdf";
  return "otro";
}
