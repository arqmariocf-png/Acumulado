/// <reference lib="dom" />
// Compresión automática de lo que la gente sube (17-nov-2026, Mario: "sí,
// comprímelos de manera automática"). Al 17-nov el bucket `cargas` pesaba
// 1.05 GB: RH 378 MB en 74 PDF escaneados (5 MB cada uno), checador 249 MB en
// 1,907 selfies, tareas 70 MB, pagos 29 MB. Todo eso entra por el navegador,
// así que se reduce ANTES de subir:
//   - Fotos (jpeg/png/webp/heic): máximo 1600 px de lado y JPEG al 82 %. Una
//     foto de celular de 3-5 MB queda en unos 300 KB. Las que ya son chicas
//     (≤ 300 KB y ≤ 1600 px) se dejan igual.
//   - PDF escaneados (casi sin texto): cada página se vuelve a dibujar a
//     130 dpi en JPEG y se rearma el PDF. Un expediente de 5 MB queda en menos
//     de 1 MB. Un PDF con texto (CFDI, contrato de Word, estado de cuenta) NO
//     se toca: rasterizarlo lo haría más pesado y le quitaría el texto.
//   - Si lo comprimido no pesa al menos 15 % menos, se sube el original.
//   - Cualquier error → se sube el original (nunca se pierde una subida).
// La parte pura (decisiones y escalas) está aquí arriba y tiene pruebas; lo
// que usa canvas/pdf.js está abajo y solo corre en el navegador.

export const LADO_MAXIMO_FOTO = 1600;
export const CALIDAD_FOTO = 0.82;
export const FOTO_MINIMA_BYTES = 300 * 1024;
export const PDF_MINIMO_BYTES = 1.5 * 1024 * 1024;
export const DPI_PDF = 130;
export const CALIDAD_PAGINA_PDF = 0.72;
/** Páginas con menos de esto en promedio se consideran escaneadas (sin texto). */
export const CARACTERES_POR_PAGINA_TEXTO = 40;
/** Solo se queda lo comprimido si ahorra al menos esta fracción. */
export const AHORRO_MINIMO = 0.15;

export type TipoCompresion = "imagen" | "pdf" | "no";

export interface ArchivoBasico {
  name: string;
  type: string;
  size: number;
}

const EXT_IMAGEN = /\.(jpe?g|png|webp|heic|heif|bmp|tiff?)$/i;

/** Qué se le hace a un archivo según tipo y tamaño. */
export function decidirCompresion(a: ArchivoBasico): TipoCompresion {
  const tipo = (a.type || "").toLowerCase();
  const nombre = a.name || "";
  if (tipo.startsWith("image/") || (tipo === "" && EXT_IMAGEN.test(nombre))) {
    if (tipo === "image/svg+xml" || tipo === "image/gif") return "no";
    return "imagen";
  }
  if (tipo === "application/pdf" || (tipo === "" && /\.pdf$/i.test(nombre))) {
    return a.size >= PDF_MINIMO_BYTES ? "pdf" : "no";
  }
  return "no";
}

/** Escala para que el lado mayor no pase del máximo (nunca agranda). */
export function escalaParaLado(ancho: number, alto: number, maximo = LADO_MAXIMO_FOTO): number {
  const mayor = Math.max(ancho, alto);
  if (!(mayor > 0)) return 1;
  return Math.min(1, maximo / mayor);
}

/** Una foto chica y dentro del tamaño no se recomprime. */
export function fotoYaEstaBien(a: ArchivoBasico, ancho: number, alto: number): boolean {
  return a.size <= FOTO_MINIMA_BYTES && Math.max(ancho, alto) <= LADO_MAXIMO_FOTO && /^image\/jpe?g$/i.test(a.type);
}

/** pdf.js dibuja a 72 dpi con escala 1; para N dpi la escala es N/72. */
export function escalaPdf(dpi = DPI_PDF): number {
  return dpi / 72;
}

/** Un PDF es "escaneado" si casi no trae texto seleccionable. */
export function esPdfEscaneado(caracteresPorPagina: number[]): boolean {
  if (caracteresPorPagina.length === 0) return false;
  const total = caracteresPorPagina.reduce((s, n) => s + n, 0);
  return total / caracteresPorPagina.length < CARACTERES_POR_PAGINA_TEXTO;
}

/** Se queda lo comprimido solo si de verdad ahorra. */
export function convieneComprimido(bytesOriginal: number, bytesNuevo: number): boolean {
  if (!(bytesNuevo > 0)) return false;
  return bytesNuevo <= bytesOriginal * (1 - AHORRO_MINIMO);
}

/** Nombre con la extensión nueva (foto.HEIC → foto.jpg). */
export function nombreComprimido(nombre: string, extension: "jpg" | "pdf"): string {
  const base = (nombre || "archivo").replace(/\.[^./\\]+$/, "");
  return `${base}.${extension}`;
}

export interface ResultadoCompresion {
  tipo: TipoCompresion;
  bytesOriginal: number;
  bytesFinal: number;
  comprimido: boolean;
}

/** Texto corto para la pantalla: "3.8 MB → 290 KB". */
export function textoCompresion(r: ResultadoCompresion): string | null {
  if (!r.comprimido) return null;
  return `${mb(r.bytesOriginal)} → ${mb(r.bytesFinal)}`;
}

function mb(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ─── Lo que corre en el navegador ────────────────────────────────────────

/**
 * Devuelve el archivo listo para subir: comprimido si conviene, el original si
 * no. Nunca lanza. `onResultado` recibe qué pasó, por si la pantalla quiere
 * decir "3.8 MB → 290 KB".
 */
export async function prepararArchivo(archivo: File, onResultado?: (r: ResultadoCompresion) => void): Promise<File> {
  const tipo = decidirCompresion(archivo);
  let salida: File = archivo;
  try {
    if (tipo === "imagen") salida = await comprimirImagen(archivo);
    else if (tipo === "pdf") salida = await comprimirPdfEscaneado(archivo);
  } catch {
    salida = archivo;
  }
  onResultado?.({ tipo, bytesOriginal: archivo.size, bytesFinal: salida.size, comprimido: salida !== archivo });
  return salida;
}

/** Varias a la vez (lista de un input multiple). */
export async function prepararArchivos(archivos: File[] | FileList): Promise<File[]> {
  const lista = Array.from(archivos);
  const salida: File[] = [];
  for (const a of lista) salida.push(await prepararArchivo(a));
  return salida;
}

/** Foto → JPEG de máximo 1600 px. Si no se puede leer (HEIC en un navegador
 * sin soporte) se devuelve el original. */
export async function comprimirImagen(archivo: File, lado = LADO_MAXIMO_FOTO, calidad = CALIDAD_FOTO): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return archivo;
  const bitmap = await createImageBitmap(archivo).catch(() => null);
  if (!bitmap) return archivo;
  try {
    if (fotoYaEstaBien(archivo, bitmap.width, bitmap.height)) return archivo;
    const escala = escalaParaLado(bitmap.width, bitmap.height, lado);
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(bitmap.width * escala));
    lienzo.height = Math.max(1, Math.round(bitmap.height * escala));
    const ctx = lienzo.getContext("2d");
    if (!ctx) return archivo;
    // Fondo blanco: los PNG con transparencia no se vuelven negros al pasar a JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, "image/jpeg", calidad));
    if (!blob) return archivo;
    const reducida = escala < 1 || !/^image\/jpe?g$/i.test(archivo.type);
    if (!reducida && !convieneComprimido(archivo.size, blob.size)) return archivo;
    if (reducida && blob.size >= archivo.size) return archivo;
    return new File([blob], nombreComprimido(archivo.name, "jpg"), { type: "image/jpeg", lastModified: archivo.lastModified });
  } finally {
    bitmap.close?.();
  }
}

/** PDF escaneado → páginas a 130 dpi en JPEG, rearmado con jsPDF. Los PDF con
 * texto se devuelven tal cual. Las librerías se cargan solo cuando hacen falta. */
export async function comprimirPdfEscaneado(archivo: File): Promise<File> {
  if (typeof document === "undefined") return archivo;
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const datos = await archivo.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: datos }).promise;
  try {
    const paginas = doc.numPages;
    if (paginas === 0 || paginas > 60) return archivo;
    const caracteres: number[] = [];
    for (let i = 1; i <= paginas; i++) {
      const pagina = await doc.getPage(i);
      const texto = await pagina.getTextContent();
      caracteres.push(texto.items.reduce((s, it) => s + (("str" in it ? it.str : "") || "").trim().length, 0));
    }
    if (!esPdfEscaneado(caracteres)) return archivo;

    const { jsPDF } = await import("jspdf");
    let salida: InstanceType<typeof jsPDF> | null = null;
    const escala = escalaPdf();
    for (let i = 1; i <= paginas; i++) {
      const pagina = await doc.getPage(i);
      const vista = pagina.getViewport({ scale: escala });
      const lienzo = document.createElement("canvas");
      lienzo.width = Math.round(vista.width);
      lienzo.height = Math.round(vista.height);
      const ctx = lienzo.getContext("2d");
      if (!ctx) return archivo;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
      const jpeg = lienzo.toDataURL("image/jpeg", CALIDAD_PAGINA_PDF);
      // Tamaño de página en puntos (72 dpi), igual al original.
      const base = pagina.getViewport({ scale: 1 });
      const orientacion = base.width > base.height ? "l" : "p";
      if (!salida) salida = new jsPDF({ orientation: orientacion, unit: "pt", format: [base.width, base.height], compress: true });
      else salida.addPage([base.width, base.height], orientacion);
      salida.addImage(jpeg, "JPEG", 0, 0, base.width, base.height, undefined, "FAST");
    }
    if (!salida) return archivo;
    const blob = salida.output("blob");
    if (!convieneComprimido(archivo.size, blob.size)) return archivo;
    return new File([blob], nombreComprimido(archivo.name, "pdf"), { type: "application/pdf", lastModified: archivo.lastModified });
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
