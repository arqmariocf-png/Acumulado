import { degrees, PDFDocument, PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import { envolver, fechaCorta, limpio, moneda, numero, porcentaje } from "./formato.ts";
import { importeConLetra } from "./numero-a-letras.ts";

// Los logotipos viven como archivos estáticos en la app, no incrustados aquí:
// cambiarlos es reemplazar un archivo, y las otras siete empresas pueden sumar
// el suyo agregando un renglón a este mapa. Una empresa sin logotipo sale con
// su nombre en texto; nunca con la marca de otra.
const LOGOS: Record<string, string> = {
  ERG: "https://acumulado-nine.vercel.app/logo-ergodinova.png",
};

// La instancia de la función sobrevive a varias peticiones, así que el PNG se
// baja una vez y no en cada PDF.
const logoEnCache = new Map<string, Uint8Array | null>();

async function bajarLogo(codigo: string): Promise<Uint8Array | null> {
  if (logoEnCache.has(codigo)) return logoEnCache.get(codigo) ?? null;

  const url = LOGOS[codigo];
  if (!url) {
    logoEnCache.set(codigo, null);
    return null;
  }

  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`El servidor respondió ${respuesta.status}`);
    const bytes = new Uint8Array(await respuesta.arrayBuffer());
    logoEnCache.set(codigo, bytes);
    return bytes;
  } catch {
    // Si el logotipo no baja, la tarjeta sale con el nombre en texto. Un PDF
    // sin logo incomoda; uno que no se genera, deja al supervisor sin nada.
    logoEnCache.set(codigo, null);
    return null;
  }
}

// Tarjeta estándar de análisis de precio unitario, carta vertical. El formato
// es fijo a propósito: todos los supervisores generan el mismo documento desde
// el celular, así una revisión externa (o una dependencia) siempre encuentra
// los mismos bloques en el mismo lugar.

const ANCHO = 612;
const ALTO = 792;
const MARGEN = 36;
const DERECHA = ANCHO - MARGEN;

// Columnas de la tabla. Las numéricas se anclan por su borde derecho para que
// los importes queden alineados por el punto decimal.
const X_CODIGO = MARGEN;
const X_DESC = 96;
const ANCHO_DESC = 196;
const X_UNIDAD = 296;
const ANCHO_UNIDAD = 34;
const FIN_CANTIDAD = 400;
const FIN_PU = 484;
const FIN_IMPORTE = DERECHA;

const TINTA = rgb(0.11, 0.12, 0.14);
const TENUE = rgb(0.45, 0.47, 0.5);
const REGLA = rgb(0.78, 0.8, 0.83);
const FONDO_GRUPO = rgb(0.93, 0.94, 0.95);
const BLANCO = rgb(1, 1, 1);

const GRUPOS = [
  { titulo: "MATERIALES", tipos: ["material"] },
  { titulo: "MANO DE OBRA", tipos: ["mano_obra"] },
  { titulo: "HERRAMIENTA Y EQUIPO", tipos: ["herramienta", "equipo"] },
  { titulo: "BÁSICOS", tipos: ["auxiliar"] },
];

export interface Renglon {
  orden: number;
  base_calculo: string;
  codigo: string | null;
  descripcion: string | null;
  unidad: string | null;
  tipo: string;
  cantidad: number;
  aportacion: number;
  costo_unitario: number;
  importe: number;
  costo_cerrado: boolean;
  sin_precio: boolean;
}

export interface Pu {
  codigo: string;
  concepto: string;
  unidad: string;
  estado: string;
  es_auxiliar: boolean;
  empresa_nombre: string;
  empresa_codigo: string;
  proyecto_nombre: string | null;
  creado_por_nombre: string | null;
  factor_nombre: string | null;
  indirectos_pct: number;
  financiamiento_pct: number;
  utilidad_pct: number;
  cargos_adicionales_pct: number;
  costo_directo: number;
  importe_indirectos: number;
  importe_financiamiento: number;
  importe_utilidad: number;
  importe_cargos_adicionales: number;
  precio_unitario: number;
  updated_at: string;
}

// Este documento se le entrega al cliente, así que deja fuera todo lo que es
// gobierno interno de Grupo Loma:
//
//   - El circuito de autorización (quién firmó y qué falta). Se ve en la
//     pantalla del análisis.
//   - El proveedor de cada material. Ese dato lo cotiza almacén y sirve para
//     generar la orden de compra, no para que el cliente sepa a quién le
//     compramos.
//
// Sí van el desglose de insumos, cantidades y costos: eso es justo lo que un
// análisis de precio unitario tiene que demostrar. Y se queda la marca de agua
// cuando el PU aún no está publicado, que es lo que protege al cliente de
// recibir como precio en firme algo que todavía no lo es.
export async function construirTarjeta(pu: Pu, renglones: Renglon[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`PU ${limpio(pu.codigo)} - ${limpio(pu.concepto)}`);
  doc.setAuthor(limpio(pu.empresa_nombre));
  doc.setSubject("Análisis de precio unitario");

  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const publicado = pu.estado === "publicado";

  const bytesLogo = await bajarLogo(pu.empresa_codigo);
  const logo = bytesLogo ? await doc.embedPng(bytesLogo) : null;

  let pagina!: PDFPage;
  let y = 0;
  let numeroPagina = 0;

  const texto = (s: string, x: number, tam: number, fuente = normal, color = TINTA) =>
    pagina.drawText(limpio(s), { x, y, size: tam, font: fuente, color });

  const textoDer = (s: string, xDer: number, tam: number, fuente = normal, color = TINTA) => {
    const t = limpio(s);
    pagina.drawText(t, { x: xDer - fuente.widthOfTextAtSize(t, tam), y, size: tam, font: fuente, color });
  };

  const textoCen = (s: string, x: number, ancho: number, tam: number, fuente = normal, color = TINTA) => {
    const t = limpio(s);
    pagina.drawText(t, { x: x + (ancho - fuente.widthOfTextAtSize(t, tam)) / 2, y, size: tam, font: fuente, color });
  };

  const regla = (grosor = 0.5, color = REGLA, desplazamiento = -3) =>
    pagina.drawLine({
      start: { x: MARGEN, y: y + desplazamiento },
      end: { x: DERECHA, y: y + desplazamiento },
      thickness: grosor,
      color,
    });

  const encabezadoTabla = () => {
    pagina.drawRectangle({ x: MARGEN, y: y - 3, width: DERECHA - MARGEN, height: 13, color: TINTA });
    texto("CÓDIGO", X_CODIGO + 3, 6.5, negrita, BLANCO);
    texto("DESCRIPCIÓN", X_DESC, 6.5, negrita, BLANCO);
    textoCen("UNIDAD", X_UNIDAD, ANCHO_UNIDAD, 6.5, negrita, BLANCO);
    textoDer("CANTIDAD", FIN_CANTIDAD, 6.5, negrita, BLANCO);
    textoDer("COSTO UNIT.", FIN_PU, 6.5, negrita, BLANCO);
    textoDer("IMPORTE", FIN_IMPORTE, 6.5, negrita, BLANCO);
    y -= 16;
  };

  const nuevaPagina = (conTabla: boolean) => {
    pagina = doc.addPage([ANCHO, ALTO]);
    numeroPagina += 1;
    y = ALTO - MARGEN - 8;

    // Un PU que todavía no llega a "publicado" no sirve para cotizar. La marca
    // de agua evita que una captura de pantalla del celular circule como precio
    // bueno antes de que dirección general cierre utilidad.
    if (!publicado) {
      pagina.drawText("SIN AUTORIZAR", {
        x: 96,
        y: 300,
        size: 58,
        font: negrita,
        color: rgb(0.88, 0.89, 0.91),
        rotate: degrees(38),
      });
    }

    if (logo) {
      const dim = logo.scaleToFit(120, 26);
      pagina.drawImage(logo, { x: MARGEN, y: y - 7, width: dim.width, height: dim.height });
    } else {
      texto(pu.empresa_nombre.toUpperCase(), MARGEN, 11, negrita);
    }
    textoDer("ANÁLISIS DE PRECIO UNITARIO", DERECHA, 11, negrita);
    y -= logo ? 22 : 12;
    texto(pu.proyecto_nombre ? `Obra: ${pu.proyecto_nombre}` : "Concepto de biblioteca", MARGEN, 8, normal, TENUE);
    textoDer(`Clave ${pu.codigo}   ·   ${fechaCorta(pu.updated_at)}   ·   Hoja ${numeroPagina}`, DERECHA, 8, normal, TENUE);
    y -= 6;
    regla(1, TINTA);
    y -= 14;

    if (conTabla) {
      texto(`${pu.codigo} — ${pu.concepto}`, MARGEN, 8, negrita, TENUE);
      y -= 12;
      encabezadoTabla();
    }
  };

  // Reserva vertical: si lo que sigue no cabe, se abre hoja nueva con el
  // encabezado de tabla repetido para que ningún renglón quede huérfano.
  const espacio = (alto: number, conTabla = true) => {
    if (y - alto < MARGEN + 24) nuevaPagina(conTabla);
  };

  // ---------- Portada del concepto ----------
  nuevaPagina(false);

  pagina.drawRectangle({ x: MARGEN, y: y - 4, width: DERECHA - MARGEN, height: 14, color: FONDO_GRUPO });
  texto("CONCEPTO", MARGEN + 4, 7.5, negrita);
  y -= 18;

  for (const linea of envolver(pu.concepto, normal, 9.5, DERECHA - MARGEN - 70)) {
    texto(linea, MARGEN, 9.5, normal);
    y -= 12;
  }
  y -= 2;
  texto(`UNIDAD DE MEDIDA: ${pu.unidad}`, MARGEN, 8.5, negrita);
  if (pu.factor_nombre) textoDer(`Factor: ${pu.factor_nombre}`, DERECHA, 8, normal, TENUE);
  y -= 16;
  encabezadoTabla();

  // ---------- Renglones agrupados ----------
  let hayNota = false;

  for (const grupo of GRUPOS) {
    const filas = renglones.filter((r) => grupo.tipos.includes(r.tipo));
    if (filas.length === 0) continue;

    espacio(26);
    pagina.drawRectangle({ x: MARGEN, y: y - 3, width: DERECHA - MARGEN, height: 12, color: FONDO_GRUPO });
    texto(grupo.titulo, X_CODIGO + 3, 7, negrita);
    y -= 15;

    let subtotal = 0;

    for (const r of filas) {
      const lineasDesc = envolver(r.descripcion ?? "", normal, 7.5, ANCHO_DESC);
      const alto = Math.max(11, lineasDesc.length * 9);
      espacio(alto + 4);

      const yFila = y;
      texto(r.codigo ?? "", X_CODIGO, 7, normal, TENUE);

      for (const linea of lineasDesc) {
        texto(linea, X_DESC, 7.5);
        y -= 9;
      }

      y = yFila;
      textoCen(r.base_calculo === "pct_mano_obra" ? "%" : (r.unidad ?? ""), X_UNIDAD, ANCHO_UNIDAD, 7.5);
      textoDer(
        r.base_calculo === "pct_mano_obra" ? porcentaje(r.aportacion) : numero(r.aportacion),
        FIN_CANTIDAD,
        7.5,
      );
      textoDer(moneda(r.costo_unitario) + (r.sin_precio ? " *" : ""), FIN_PU, 7.5);
      textoDer(moneda(r.importe), FIN_IMPORTE, 7.5, r.costo_cerrado ? negrita : normal);

      if (r.sin_precio) hayNota = true;
      subtotal += Number(r.importe ?? 0);
      y = yFila - alto;
    }

    espacio(16);
    regla(0.5, REGLA, 6);
    textoDer(`SUBTOTAL ${grupo.titulo}`, FIN_PU, 7, negrita, TENUE);
    textoDer(moneda(subtotal), FIN_IMPORTE, 7.5, negrita);
    y -= 16;
  }

  // ---------- Cierre: costo directo, factores y precio ----------
  espacio(140, false);
  y -= 6;
  regla(1, TINTA, 6);
  y -= 6;

  const renglonResumen = (etiqueta: string, valor: number, detalle = "", fuerte = false) => {
    texto(etiqueta, X_DESC, fuerte ? 8.5 : 8, fuerte ? negrita : normal);
    if (detalle) textoDer(detalle, FIN_PU, 8, normal, TENUE);
    textoDer(moneda(valor), FIN_IMPORTE, fuerte ? 8.5 : 8, fuerte ? negrita : normal);
    y -= 13;
  };

  renglonResumen("COSTO DIRECTO", pu.costo_directo, "", true);

  // Un análisis básico se consume dentro de otro a costo directo: imprimirle
  // factores aquí sugeriría un precio de venta que no existe.
  if (!pu.es_auxiliar) {
    renglonResumen("Indirectos", pu.importe_indirectos, porcentaje(pu.indirectos_pct));
    renglonResumen("Financiamiento", pu.importe_financiamiento, porcentaje(pu.financiamiento_pct));
    renglonResumen("Utilidad", pu.importe_utilidad, porcentaje(pu.utilidad_pct));
    renglonResumen("Cargos adicionales", pu.importe_cargos_adicionales, porcentaje(pu.cargos_adicionales_pct));
  }

  y -= 2;
  pagina.drawRectangle({ x: X_DESC - 6, y: y - 6, width: DERECHA - X_DESC + 6, height: 20, color: TINTA });
  texto(`PRECIO UNITARIO POR ${pu.unidad}`, X_DESC, 9, negrita, BLANCO);
  textoDer(moneda(pu.precio_unitario), FIN_IMPORTE - 4, 11, negrita, BLANCO);
  y -= 20;
  textoDer(`(${importeConLetra(Number(pu.precio_unitario))})`, FIN_IMPORTE, 7.5, normal, TENUE);
  y -= 16;

  if (hayNota) {
    texto(
      "* Insumo sin costo registrado en catálogo: se computó en cero y debe cotizarse antes de usar este PU.",
      MARGEN,
      6.5,
      normal,
      TENUE,
    );
    y -= 12;
  }

  return await doc.save();
}
