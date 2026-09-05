// Dibujo de la tarjeta de análisis de precio unitario. Deno-only: depende de
// npm:pdf-lib. Consume lo que ya agrupó pu-tarjeta.ts (shaping puro, probado
// aparte con node --test) -- aquí no se calcula ningún importe.
//
// El circuito de firmas NO va en el PDF a propósito: la tarjeta se le
// entrega al cliente, y quién autorizó internamente es gobierno de Grupo
// Loma, no información del entregable. Eso se ve en pantalla
// (web/src/pages/precios/CircuitoFirmas.tsx).

import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "npm:pdf-lib@1.17.1";
import {
  celdaCantidad,
  dinero,
  etiquetaEstado,
  type TarjetaPu,
} from "./pu-tarjeta.ts";

const ANCHO_PAGINA = 612; // carta, en puntos
const ALTO_PAGINA = 792;
const MARGEN_X = 42;
const MARGEN_INFERIOR = 56;
const ALTO_RENGLON = 15;

const COLOR_TEXTO = rgb(0.13, 0.15, 0.19);
const COLOR_TEXTO_SUAVE = rgb(0.45, 0.48, 0.53);
const COLOR_MARCA = rgb(0.09, 0.18, 0.42);
const COLOR_GRUPO_FONDO = rgb(0.93, 0.94, 0.97);
const COLOR_SUBTOTAL_FONDO = rgb(0.97, 0.97, 0.98);
const COLOR_LINEA = rgb(0.85, 0.86, 0.89);
const COLOR_AVISO = rgb(0.6, 0.4, 0.05);
const COLOR_MARCA_AGUA = rgb(0.85, 0.3, 0.3);

// Los cuatro anchos suman ANCHO_PAGINA - 2*MARGEN_X (528pt). Si sumaran más,
// la última columna se dibujaría fuera del área imprimible en todas las
// filas, no sólo en las de texto largo.
interface Columna {
  titulo: string;
  ancho: number;
  alinear: "izquierda" | "derecha";
}

const COLUMNAS: Columna[] = [
  { titulo: "CONCEPTO", ancho: 258, alinear: "izquierda" },
  { titulo: "CANTIDAD", ancho: 80, alinear: "derecha" },
  { titulo: "COSTO UNITARIO", ancho: 95, alinear: "derecha" },
  { titulo: "IMPORTE", ancho: 95, alinear: "derecha" },
];

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
  const xFinal = opts.alinearDerecha != null ? opts.alinearDerecha - fuente.widthOfTextAtSize(texto, tamano) : x;
  estado.pagina.drawText(texto, { x: xFinal, y: estado.y, size: tamano, font: fuente, color: opts.color ?? COLOR_TEXTO });
}

/** Recorta con "…" hasta que quepa: sin esto una descripción larga de
 * concepto se dibuja completa igual y su ancho real invade la columna de
 * cantidad, encimando el texto sobre los montos. */
function truncar(fuente: PDFFont, texto: string, tamano: number, anchoMax: number): string {
  if (fuente.widthOfTextAtSize(texto, tamano) <= anchoMax) return texto;
  let recortado = texto;
  while (recortado.length > 1 && fuente.widthOfTextAtSize(`${recortado}…`, tamano) > anchoMax) {
    recortado = recortado.slice(0, -1);
  }
  return `${recortado}…`;
}

/** Parte un texto largo en renglones que quepan en `anchoMax`, cortando por
 * palabra. Se usa para el concepto del encabezado, que es una descripción de
 * obra completa y no se debe recortar: es lo que define qué se está
 * cotizando. */
function envolver(fuente: PDFFont, texto: string, tamano: number, anchoMax: number): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = "";

  for (const palabra of palabras) {
    const tentativa = actual ? `${actual} ${palabra}` : palabra;
    if (fuente.widthOfTextAtSize(tentativa, tamano) <= anchoMax) {
      actual = tentativa;
    } else {
      if (actual) lineas.push(actual);
      // Una sola palabra más ancha que el renglón (una clave larga sin
      // espacios) se recorta, si no el bucle no avanzaría nunca.
      actual = fuente.widthOfTextAtSize(palabra, tamano) > anchoMax
        ? truncar(fuente, palabra, tamano, anchoMax)
        : palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length > 0 ? lineas : [""];
}

function dibujarLinea(estado: EstadoPdf, y: number, color = COLOR_LINEA, grosor = 0.75): void {
  estado.pagina.drawLine({
    start: { x: MARGEN_X, y },
    end: { x: ANCHO_PAGINA - MARGEN_X, y },
    thickness: grosor,
    color,
  });
}

function dibujarFila(
  estado: EstadoPdf,
  valores: string[],
  opts: { negrita?: boolean; fondo?: ReturnType<typeof rgb>; color?: ReturnType<typeof rgb> } = {},
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
  for (let i = 0; i < COLUMNAS.length; i++) {
    const col = COLUMNAS[i];
    const fuente = opts.negrita ? estado.fuenteNegrita : estado.fuente;
    dibujarTexto(estado, truncar(fuente, valores[i] ?? "", 9, col.ancho - 6), x, {
      negrita: opts.negrita,
      color: opts.color,
      alinearDerecha: col.alinear === "derecha" ? x + col.ancho : undefined,
    });
    x += col.ancho;
  }
  estado.y -= ALTO_RENGLON;
}

function dibujarEncabezado(estado: EstadoPdf, tarjeta: TarjetaPu): void {
  const c = tarjeta.cabecera;

  dibujarTexto(estado, "GRUPO LOMA", MARGEN_X, { negrita: true, tamano: 18, color: COLOR_MARCA });
  dibujarTexto(estado, c.empresaNombre, MARGEN_X, {
    tamano: 8,
    color: COLOR_TEXTO_SUAVE,
    alinearDerecha: ANCHO_PAGINA - MARGEN_X,
  });
  estado.y -= 20;

  dibujarTexto(estado, "Análisis de Precio Unitario", MARGEN_X, { negrita: true, tamano: 12 });
  dibujarTexto(estado, etiquetaEstado(c.estado), MARGEN_X, {
    tamano: 9,
    color: COLOR_TEXTO_SUAVE,
    alinearDerecha: ANCHO_PAGINA - MARGEN_X,
  });
  estado.y -= 18;

  dibujarTexto(estado, `${c.codigo}    ·    unidad ${c.unidad}`, MARGEN_X, { negrita: true, tamano: 10 });
  estado.y -= 14;

  for (const linea of envolver(estado.fuente, c.concepto, 9.5, ANCHO_PAGINA - 2 * MARGEN_X)) {
    dibujarTexto(estado, linea, MARGEN_X, { tamano: 9.5 });
    estado.y -= 12;
  }
  estado.y -= 2;

  const pie = [
    c.proyectoNombre ?? "Biblioteca de precios",
    c.creadoPorNombre ? `elaboró ${c.creadoPorNombre}` : null,
    c.factorNombre ? `factor ${c.factorNombre}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  dibujarTexto(estado, pie, MARGEN_X, { tamano: 8, color: COLOR_TEXTO_SUAVE });
  estado.y -= 14;

  dibujarLinea(estado, estado.y);
  estado.y -= 18;
}

function dibujarTabla(estado: EstadoPdf, tarjeta: TarjetaPu): void {
  asegurarEspacio(estado, ALTO_RENGLON * 2);
  let x = MARGEN_X;
  for (const col of COLUMNAS) {
    dibujarTexto(estado, col.titulo, x, {
      negrita: true,
      tamano: 8,
      color: COLOR_TEXTO_SUAVE,
      alinearDerecha: col.alinear === "derecha" ? x + col.ancho : undefined,
    });
    x += col.ancho;
  }
  estado.y -= 6;
  dibujarLinea(estado, estado.y);
  estado.y -= ALTO_RENGLON;

  for (const grupo of tarjeta.grupos) {
    dibujarFila(estado, [grupo.titulo.toUpperCase()], { negrita: true, fondo: COLOR_GRUPO_FONDO });

    for (const r of grupo.renglones) {
      const descripcion = r.descripcion ?? r.codigo ?? "";
      dibujarFila(estado, [descripcion, celdaCantidad(r), dinero(r.costoUnitario), dinero(r.importe)]);

      // La clave, el proveedor y el aviso de "sin precio" van en una segunda
      // línea chica: son de quien revisa el análisis, no del total.
      const detalle = [r.codigo, r.proveedor, r.sinPrecio ? "SIN PRECIO EN CATÁLOGO" : null]
        .filter(Boolean)
        .join("  ·  ");
      if (detalle) {
        asegurarEspacio(estado, 11);
        dibujarTexto(estado, detalle, MARGEN_X + 8, {
          tamano: 7.5,
          color: r.sinPrecio ? COLOR_AVISO : COLOR_TEXTO_SUAVE,
        });
        estado.y -= 11;
      }
    }

    // El fondo del subtotal se dibuja unos puntos por encima de su línea
    // base; sin este respiro se le come la cola de la última línea chica de
    // detalle ("proveedor", "prueba") y se leen encimadas.
    estado.y -= 4;
    dibujarFila(estado, [`Subtotal ${grupo.titulo.toLowerCase()}`, "", "", dinero(grupo.subtotal)], {
      negrita: true,
      fondo: COLOR_SUBTOTAL_FONDO,
    });
    estado.y -= 6;
  }

  if (tarjeta.grupos.length === 0) {
    dibujarFila(estado, ["Sin renglones capturados."], { color: COLOR_TEXTO_SUAVE });
  }
}

function dibujarPie(estado: EstadoPdf, tarjeta: TarjetaPu): void {
  // El pie no se parte entre páginas: el costo directo, el sobrecosto y el
  // precio se leen juntos o no se leen.
  asegurarEspacio(estado, ALTO_RENGLON * (tarjeta.sobrecosto.length + 3) + 20);

  estado.y -= 4;
  dibujarLinea(estado, estado.y + 10, COLOR_TEXTO, 1.2);
  dibujarFila(estado, ["Costo directo", "", "", dinero(tarjeta.costoDirecto)], { negrita: true });

  for (const linea of tarjeta.sobrecosto) {
    dibujarFila(estado, [linea.etiqueta, "", "", dinero(linea.importe)], { color: COLOR_TEXTO_SUAVE });
  }

  dibujarLinea(estado, estado.y + 10);
  estado.y -= 2;
  asegurarEspacio(estado, ALTO_RENGLON + 4);
  dibujarTexto(estado, tarjeta.cabecera.esAuxiliar ? "Costo directo del básico" : "PRECIO UNITARIO", MARGEN_X, {
    negrita: true,
    tamano: 11,
  });
  dibujarTexto(estado, `${dinero(tarjeta.precioUnitario)} / ${tarjeta.cabecera.unidad}`, MARGEN_X, {
    negrita: true,
    tamano: 11,
    alinearDerecha: ANCHO_PAGINA - MARGEN_X,
  });
  estado.y -= ALTO_RENGLON + 4;

  if (tarjeta.cabecera.esAuxiliar) {
    dibujarTexto(estado, "Análisis básico: se consume dentro de otros a costo directo, sin indirectos ni utilidad.", MARGEN_X, {
      tamano: 7.5,
      color: COLOR_TEXTO_SUAVE,
    });
    estado.y -= 12;
  }

  for (const aviso of tarjeta.advertencias) {
    asegurarEspacio(estado, 12);
    for (const linea of envolver(estado.fuente, aviso, 8, ANCHO_PAGINA - 2 * MARGEN_X)) {
      dibujarTexto(estado, linea, MARGEN_X, { tamano: 8, color: COLOR_AVISO });
      estado.y -= 11;
    }
  }
}

/** Diagonal en cada página, dibujada al final para que quede encima de la
 * tabla: un borrador impreso tiene que ser inconfundible aunque alguien lo
 * fotocopie en blanco y negro. */
function dibujarMarcaDeAgua(estado: EstadoPdf, texto: string): void {
  for (const pagina of estado.doc.getPages()) {
    pagina.drawText(texto, {
      x: 90,
      y: 230,
      size: 62,
      font: estado.fuenteNegrita,
      color: COLOR_MARCA_AGUA,
      opacity: 0.18,
      rotate: degrees(38),
    });
  }
}

function dibujarNumeroPaginas(estado: EstadoPdf, tarjeta: TarjetaPu): void {
  const paginas = estado.doc.getPages();
  const generado = new Date().toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "long",
    timeStyle: "short",
  });

  paginas.forEach((pagina, i) => {
    pagina.drawText(`${tarjeta.cabecera.codigo} · generado el ${generado}`, {
      x: MARGEN_X,
      y: 24,
      size: 7,
      font: estado.fuente,
      color: COLOR_TEXTO_SUAVE,
    });
    pagina.drawText(`Página ${i + 1} de ${paginas.length}`, {
      x: ANCHO_PAGINA - MARGEN_X - 62,
      y: 24,
      size: 7,
      font: estado.fuente,
      color: COLOR_TEXTO_SUAVE,
    });
  });
}

export async function generarPdfTarjetaPu(tarjeta: TarjetaPu): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`PU ${tarjeta.cabecera.codigo} - ${tarjeta.cabecera.concepto}`);
  doc.setAuthor("Acumulado - Grupo Loma");

  const estado: EstadoPdf = {
    doc,
    fuente: await doc.embedFont(StandardFonts.Helvetica),
    fuenteNegrita: await doc.embedFont(StandardFonts.HelveticaBold),
    pagina: doc.addPage([ANCHO_PAGINA, ALTO_PAGINA]),
    y: ALTO_PAGINA - MARGEN_X,
  };

  dibujarEncabezado(estado, tarjeta);
  dibujarTabla(estado, tarjeta);
  dibujarPie(estado, tarjeta);
  if (tarjeta.marcaDeAgua) dibujarMarcaDeAgua(estado, tarjeta.marcaDeAgua);
  dibujarNumeroPaginas(estado, tarjeta);

  return doc.save();
}
