// Generación del PDF "Grupo Loma -- Saldos Bancarios" (entradas/salidas del
// día y saldo por cuenta, para que tesorería lo suba y pueda programar los
// pagos/compras -- OS/OV -- cargados en el backoffice). Deno-only: depende
// de npm:pdf-lib. Consume los datos ya calculados/agrupados por saldos.ts
// (probado aparte con node --test, sin este archivo de por medio).

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { etiquetaCuenta, type ReporteSaldosDia } from "./saldos.ts";

const ANCHO_PAGINA = 612; // carta, en puntos
const ALTO_PAGINA = 792;
const MARGEN_X = 42;
const MARGEN_INFERIOR = 50;
const ALTO_RENGLON = 16;

const COLOR_TEXTO = rgb(0.13, 0.15, 0.19);
const COLOR_TEXTO_SUAVE = rgb(0.45, 0.48, 0.53);
const COLOR_MARCA = rgb(0.09, 0.18, 0.42);
const COLOR_ENCABEZADO_SECCION = rgb(0.09, 0.18, 0.42);
const COLOR_FILA_EMPRESA_FONDO = rgb(0.93, 0.94, 0.97);
const COLOR_SUBTOTAL_FONDO = rgb(0.97, 0.97, 0.98);
const COLOR_TOTAL_FONDO = rgb(0.87, 0.9, 0.96);
const COLOR_LINEA = rgb(0.85, 0.86, 0.89);
const COLOR_NEGATIVO = rgb(0.7, 0.16, 0.16);

function formatoMoneda(valor: number): string {
  const signo = valor < 0 ? "-" : "";
  const abs = Math.abs(valor);
  return `${signo}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatoFechaLarga(fechaIso: string): string {
  const [anio, mes, dia] = fechaIso.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

interface Columna {
  titulo: string;
  ancho: number;
  alinear: "izquierda" | "derecha";
}

/** Estado mutable de la generación -- documento + página/cursor actuales.
 * Se pasa por referencia entre los helpers de dibujo en vez de usar una
 * clase, siguiendo el estilo funcional del resto de _shared. */
interface EstadoPdf {
  doc: PDFDocument;
  fuente: PDFFont;
  fuenteNegrita: PDFFont;
  pagina: PDFPage;
  y: number;
}

function nuevaPagina(estado: EstadoPdf): void {
  estado.pagina = estado.doc.addPage([ANCHO_PAGINA, ALTO_PAGINA]);
  estado.y = ALTO_PAGINA - MARGEN_X;
}

function asegurarEspacio(estado: EstadoPdf, altoNecesario: number): void {
  if (estado.y - altoNecesario < MARGEN_INFERIOR) nuevaPagina(estado);
}

function dibujarTexto(
  estado: EstadoPdf,
  texto: string,
  x: number,
  opts: { negrita?: boolean; tamano?: number; color?: ReturnType<typeof rgb>; alinearDerecha?: number } = {},
): void {
  const fuente = opts.negrita ? estado.fuenteNegrita : estado.fuente;
  const tamano = opts.tamano ?? 9;
  const color = opts.color ?? COLOR_TEXTO;
  const xFinal = opts.alinearDerecha != null ? opts.alinearDerecha - fuente.widthOfTextAtSize(texto, tamano) : x;
  estado.pagina.drawText(texto, { x: xFinal, y: estado.y, size: tamano, font: fuente, color });
}

function dibujarLineaHorizontal(estado: EstadoPdf, y: number, color = COLOR_LINEA): void {
  estado.pagina.drawLine({
    start: { x: MARGEN_X, y },
    end: { x: ANCHO_PAGINA - MARGEN_X, y },
    thickness: 0.75,
    color,
  });
}

function dibujarEncabezadoDocumento(estado: EstadoPdf, generadoPor: string): void {
  dibujarTexto(estado, "GRUPO LOMA", MARGEN_X, { negrita: true, tamano: 18, color: COLOR_MARCA });
  estado.y -= 22;
  dibujarTexto(estado, "Reporte de Saldos Bancarios", MARGEN_X, { negrita: true, tamano: 12 });
  estado.y -= 16;
  const ahora = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" });
  dibujarTexto(estado, `Generado el ${ahora} (hora Ciudad de México) · ${generadoPor}`, MARGEN_X, {
    tamano: 8,
    color: COLOR_TEXTO_SUAVE,
  });
  estado.y -= 14;
  dibujarLineaHorizontal(estado, estado.y);
  estado.y -= 20;
}

function dibujarTituloSeccion(estado: EstadoPdf, titulo: string, subtitulo?: string): void {
  asegurarEspacio(estado, 40);
  dibujarTexto(estado, titulo, MARGEN_X, { negrita: true, tamano: 12, color: COLOR_ENCABEZADO_SECCION });
  estado.y -= 14;
  if (subtitulo) {
    dibujarTexto(estado, subtitulo, MARGEN_X, { tamano: 8.5, color: COLOR_TEXTO_SUAVE });
    estado.y -= 14;
  } else {
    estado.y -= 4;
  }
}

function dibujarEncabezadoTabla(estado: EstadoPdf, columnas: Columna[]): void {
  asegurarEspacio(estado, ALTO_RENGLON * 2);
  let x = MARGEN_X;
  for (const col of columnas) {
    dibujarTexto(estado, col.titulo, x, {
      negrita: true,
      tamano: 8,
      color: COLOR_TEXTO_SUAVE,
      alinearDerecha: col.alinear === "derecha" ? x + col.ancho : undefined,
    });
    x += col.ancho;
  }
  estado.y -= 6;
  dibujarLineaHorizontal(estado, estado.y);
  estado.y -= ALTO_RENGLON;
}

function dibujarFila(
  estado: EstadoPdf,
  columnas: Columna[],
  valores: string[],
  opts: { negrita?: boolean; fondo?: ReturnType<typeof rgb>; colorNegativoEnIndices?: number[]; valoresNumericos?: number[] } = {},
): void {
  asegurarEspacio(estado, ALTO_RENGLON);
  if (opts.fondo) {
    estado.pagina.drawRectangle({
      x: MARGEN_X - 4,
      y: estado.y - 4,
      width: ANCHO_PAGINA - 2 * MARGEN_X + 8,
      height: ALTO_RENGLON,
      color: opts.fondo,
    });
  }
  let x = MARGEN_X;
  for (let i = 0; i < columnas.length; i++) {
    const col = columnas[i];
    const esNegativo = opts.colorNegativoEnIndices?.includes(i) && (opts.valoresNumericos?.[i] ?? 0) < 0;
    dibujarTexto(estado, valores[i] ?? "", x, {
      negrita: opts.negrita,
      tamano: 9,
      color: esNegativo ? COLOR_NEGATIVO : COLOR_TEXTO,
      alinearDerecha: col.alinear === "derecha" ? x + col.ancho : undefined,
    });
    x += col.ancho;
  }
  estado.y -= ALTO_RENGLON;
}

/** Dibuja la tabla de un reporte (global o de un día) con sus grupos por
 * empresa, subtotal por empresa, y total general al final. */
function dibujarTablaReporte(
  estado: EstadoPdf,
  reporte: ReporteSaldosDia,
  columnas: Columna[],
  filaValores: (f: ReporteSaldosDia["grupos"][number]["filas"][number]) => string[],
  subtotalValores: (s: ReporteSaldosDia["total"]) => string[],
): void {
  dibujarEncabezadoTabla(estado, columnas);

  for (const grupo of reporte.grupos) {
    dibujarFila(estado, [{ ...columnas[0], ancho: ANCHO_PAGINA - 2 * MARGEN_X }], [grupo.empresaNombre], {
      negrita: true,
      fondo: COLOR_FILA_EMPRESA_FONDO,
    });
    for (const f of grupo.filas) {
      dibujarFila(estado, columnas, filaValores(f));
    }
    dibujarFila(estado, columnas, ["Subtotal", ...subtotalValores(grupo.subtotal).slice(1)], {
      negrita: true,
      fondo: COLOR_SUBTOTAL_FONDO,
    });
    estado.y -= 6;
  }

  asegurarEspacio(estado, ALTO_RENGLON + 6);
  dibujarLineaHorizontal(estado, estado.y + 10);
  dibujarFila(estado, columnas, ["TOTAL GRUPO LOMA", ...subtotalValores(reporte.total).slice(1)], {
    negrita: true,
    fondo: COLOR_TOTAL_FONDO,
  });
  estado.y -= 10;
}

function dibujarNumeroPaginas(estado: EstadoPdf): void {
  const paginas = estado.doc.getPages();
  paginas.forEach((pagina, i) => {
    pagina.drawText(`Página ${i + 1} de ${paginas.length}`, {
      x: ANCHO_PAGINA - MARGEN_X - 70,
      y: 24,
      size: 7.5,
      font: estado.fuente,
      color: COLOR_TEXTO_SUAVE,
    });
    pagina.drawText("Uso interno · Grupo Loma", {
      x: MARGEN_X,
      y: 24,
      size: 7.5,
      font: estado.fuente,
      color: COLOR_TEXTO_SUAVE,
    });
  });
}

const COLUMNAS_GLOBAL: Columna[] = [
  { titulo: "CUENTA", ancho: 330, alinear: "izquierda" },
  { titulo: "SALDO ACTUAL", ancho: 158, alinear: "derecha" },
];

const COLUMNAS_DIA: Columna[] = [
  { titulo: "CUENTA", ancho: 190, alinear: "izquierda" },
  { titulo: "SALDO INICIAL", ancho: 100, alinear: "derecha" },
  { titulo: "ENTRADAS", ancho: 100, alinear: "derecha" },
  { titulo: "SALIDAS", ancho: 100, alinear: "derecha" },
  { titulo: "SALDO FINAL", ancho: 98, alinear: "derecha" },
];

export interface DatosReportePdf {
  generadoPor: string;
  fechaHoy: string; // ISO yyyy-mm-dd
  fechaAyer: string; // ISO yyyy-mm-dd
  global: ReporteSaldosDia;
  ayer: ReporteSaldosDia;
  hoy: ReporteSaldosDia;
}

export async function generarPdfSaldosDiarios(datos: DatosReportePdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Grupo Loma - Reporte de Saldos Bancarios");
  doc.setAuthor("Acumulado - Grupo Loma");

  const estado: EstadoPdf = {
    doc,
    fuente: await doc.embedFont(StandardFonts.Helvetica),
    fuenteNegrita: await doc.embedFont(StandardFonts.HelveticaBold),
    pagina: doc.addPage([ANCHO_PAGINA, ALTO_PAGINA]),
    y: ALTO_PAGINA - MARGEN_X,
  };

  dibujarEncabezadoDocumento(estado, datos.generadoPor);

  dibujarTituloSeccion(
    estado,
    "1. Posición global (saldo actual por cuenta)",
    "Último saldo conocido de cada cuenta, sin importar la fecha del último movimiento.",
  );
  dibujarTablaReporte(
    estado,
    datos.global,
    COLUMNAS_GLOBAL,
    (f) => [etiquetaCuenta(f), formatoMoneda(f.saldoFinal)],
    (s) => ["", formatoMoneda(s.saldoFinal)],
  );

  estado.y -= 10;
  dibujarTituloSeccion(estado, `2. Movimientos de ayer — ${formatoFechaLarga(datos.fechaAyer)}`);
  dibujarTablaReporte(
    estado,
    datos.ayer,
    COLUMNAS_DIA,
    (f) => [etiquetaCuenta(f), formatoMoneda(f.saldoInicial), formatoMoneda(f.entradas), formatoMoneda(f.salidas), formatoMoneda(f.saldoFinal)],
    (s) => ["", formatoMoneda(s.saldoInicial), formatoMoneda(s.entradas), formatoMoneda(s.salidas), formatoMoneda(s.saldoFinal)],
  );

  estado.y -= 10;
  dibujarTituloSeccion(estado, `3. Movimientos de hoy — ${formatoFechaLarga(datos.fechaHoy)}`);
  dibujarTablaReporte(
    estado,
    datos.hoy,
    COLUMNAS_DIA,
    (f) => [etiquetaCuenta(f), formatoMoneda(f.saldoInicial), formatoMoneda(f.entradas), formatoMoneda(f.salidas), formatoMoneda(f.saldoFinal)],
    (s) => ["", formatoMoneda(s.saldoInicial), formatoMoneda(s.entradas), formatoMoneda(s.salidas), formatoMoneda(s.saldoFinal)],
  );

  dibujarNumeroPaginas(estado);

  return doc.save();
}
