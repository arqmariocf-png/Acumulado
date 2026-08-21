// Parsea el estado de cuenta de Santander en PDF, formato "Cuenta de
// cheques" (confirmado contra un archivo real: PDF_JULIO_BALKEN_SANTANDER.pdf,
// cuenta Santander 8617 de Vigueta Bovedilla y Bloques Balken, julio 2026).
//
// Mismo problema que Banorte: no hay columnas de monto fijas por posición
// -- pdf.js/unpdf aplana el texto a líneas tipo:
//
//   0043839 ABONO TRANSFERENCIA SPEI HORA 11:19:40
//   RECIBIDO DE BBVA MEXICO
//   ...
//   665.00 17,250.19
//
// donde el primer monto es el movimiento (depósito o retiro, sin indicar
// cuál) y el segundo es el saldo resultante -- se resuelve por delta contra
// el saldo anterior, igual que Banorte/BanBajío. También igual que Banorte,
// la descripción de un movimiento real casi siempre se parte en varias
// líneas de texto antes de llegar a los montos, así que se ancla cada
// movimiento por su fecha ("DD-MMM-AAAA " -- año de 4 dígitos, a diferencia
// del de 2 dígitos de Banorte) y se toma como un solo bloque todo el texto
// hasta la siguiente fecha ancla.
//
// A diferencia de Banorte, cada línea SÍ trae un folio limpio justo después
// de la fecha (ej. "03-JUL-2026 0043839 ABONO..."), así que se captura en
// el campo folio en vez de descartarse.
//
// SECCIÓN DE MOVIMIENTOS Y CUENTA ÚNICA POR ARCHIVO: el propio documento
// delimita la tabla de movimientos de cada producto con marcadores de texto
// limpios -- "SALDO FINAL DEL PERIODO ANTERIOR: $X" (saldo inicial de ESE
// producto) al principio y "SALDO FINAL DEL PERIODO: $X" (saldo final) al
// final, seguido de una línea "TOTAL <depósitos> <retiros>" con los totales
// que el banco declara para esa tabla -- así que no hace falta un resumen
// aparte como en BBVA/Banorte, estos mismos marcadores sirven de
// autovalidación. El PDF puede traer más de un producto (ej. "CUENTA
// SANTANDER PYME" + "INVERSION CRECIENTE", cada uno con su propio par de
// marcadores) -- igual que Banorte, este parser solo lee el PRIMER producto
// y bloquea todo el documento si un producto posterior también trae
// movimientos reales, porque hoy la función de ingesta no recibe el número
// de cuenta del PDF para decidir con certeza cuál tabla corresponde a la
// cuenta bancaria seleccionada.

import type { ResultadoParseoPdf } from "./pdf-estado-cuenta.ts";
import type { FilaEstadoCuentaMapeada } from "./estado-cuenta.ts";
import type { ReferenciaTipo } from "../motor/types.ts";

const MESES: Record<string, number> = {
  ENE: 1,
  FEB: 2,
  MAR: 3,
  ABR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AGO: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DIC: 12,
};

const RE_FECHA_ANCLA = /^(\d{2})-([A-Z]{3})-(\d{4})\s/gm;
const RE_FOLIO_AL_INICIO = /^(\d+)\s+/;
const RE_MONTO = /-?[\d,]+\.\d{2}/g;
const MARCADOR_SALDO_ANTERIOR = "SALDO FINAL DEL PERIODO ANTERIOR:";
const MARCADOR_SALDO_FINAL = "SALDO FINAL DEL PERIODO:";

function aNumero(texto: string): number {
  return Number(texto.replace(/,/g, ""));
}

function extraerSaldoDeMarcador(textoCompleto: string, idxMarcador: number, marcador: string): number | null {
  const ventana = textoCompleto.slice(idxMarcador, idxMarcador + marcador.length + 30);
  const m = ventana.match(/\$?\s*([\d,]+\.\d{2})/);
  return m ? aNumero(m[1]) : null;
}

/**
 * @param textoCompleto Texto de todas las páginas del PDF, concatenado (ver
 *   pdf-cargador.ts / pdfATexto).
 */
export function parsearPdfEstadoCuentaSantander(textoCompleto: string): ResultadoParseoPdf {
  const idxInicio = textoCompleto.indexOf(MARCADOR_SALDO_ANTERIOR);
  if (idxInicio === -1) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: `No se encontró el marcador "${MARCADOR_SALDO_ANTERIOR}" en el PDF` };
  }
  const idxFin = textoCompleto.indexOf(MARCADOR_SALDO_FINAL, idxInicio);
  if (idxFin === -1) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: `No se encontró el marcador "${MARCADOR_SALDO_FINAL}" en el PDF` };
  }

  const saldoInicial = extraerSaldoDeMarcador(textoCompleto, idxInicio, MARCADOR_SALDO_ANTERIOR);
  if (saldoInicial == null) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: `No se pudo leer el monto de "${MARCADOR_SALDO_ANTERIOR}" en el PDF` };
  }
  const saldoFinalDeclarado = extraerSaldoDeMarcador(textoCompleto, idxFin, MARCADOR_SALDO_FINAL);

  // Si un segundo producto en el mismo PDF también trae movimientos reales,
  // no hay forma de saber con certeza cuál tabla corresponde a la cuenta
  // bancaria seleccionada en la carga -- se bloquea en vez de adivinar (ver
  // comentario del encabezado).
  const idxInicio2 = textoCompleto.indexOf(MARCADOR_SALDO_ANTERIOR, idxFin);
  if (idxInicio2 !== -1) {
    const idxFin2 = textoCompleto.indexOf(MARCADOR_SALDO_FINAL, idxInicio2);
    const seccion2 = textoCompleto.slice(idxInicio2, idxFin2 === -1 ? textoCompleto.length : idxFin2);
    RE_FECHA_ANCLA.lastIndex = 0;
    if (RE_FECHA_ANCLA.test(seccion2)) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: "El PDF trae más de un producto con movimientos (ej. cuenta + inversión) -- carga de PDF con varios productos no soportada todavía, se necesita agregar el número de cuenta a la carga para saber cuál tabla corresponde.",
      };
    }
  }

  const seccion = textoCompleto.slice(idxInicio + MARCADOR_SALDO_ANTERIOR.length, idxFin);

  // La línea "TOTAL <depósitos> <retiros>" cierra la tabla justo antes de
  // "SALDO FINAL DEL PERIODO:". Si se deja dentro de la sección de
  // movimientos, sus 2 montos quedan pegados al bloque del ÚLTIMO
  // movimiento (que no tiene un ancla de fecha siguiente que lo delimite),
  // dando 4 montos en vez de 2 y reportándolo como error en vez de
  // insertarlo -- por eso se recorta la sección ANTES de esa línea para
  // anclar/parsear movimientos, aunque la línea TOTAL sí se lee (de
  // `seccion` completa, sin recortar) para la autovalidación de más abajo.
  const matchTotal = seccion.match(/\bTOTAL\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/);
  const seccionMovimientos = matchTotal ? seccion.slice(0, matchTotal.index) : seccion;

  RE_FECHA_ANCLA.lastIndex = 0;
  const anclas = [...seccionMovimientos.matchAll(RE_FECHA_ANCLA)];
  if (anclas.length === 0) {
    // Producto sin movimientos (ej. "INVERSION CRECIENTE" vacía) -- no es un
    // error, simplemente no hay nada que insertar para este producto.
    return { movimientos: [], erroresPorFila: [], errorDocumento: null };
  }

  const movimientos: FilaEstadoCuentaMapeada[] = [];
  const erroresPorFila: { fila: number; errores: string[] }[] = [];
  let saldoAnterior = saldoInicial;
  let filaNum = 0;

  for (let i = 0; i < anclas.length; i++) {
    const m = anclas[i];
    const inicioBloque = m.index!;
    const finBloque = i + 1 < anclas.length ? anclas[i + 1].index! : seccionMovimientos.length;
    const bloque = seccionMovimientos.slice(inicioBloque, finBloque);
    filaNum++;

    const [, diaStr, mesAbrev, anioStr] = m;
    const mes = MESES[mesAbrev];
    if (!mes) {
      erroresPorFila.push({ fila: filaNum, errores: [`Mes no reconocido: "${mesAbrev}"`] });
      continue;
    }
    const fechaIso = `${anioStr}-${String(mes).padStart(2, "0")}-${diaStr}`;

    const textoSinFecha = bloque.slice(m[0].length);
    const matchFolio = textoSinFecha.match(RE_FOLIO_AL_INICIO);
    const folio = matchFolio ? matchFolio[1] : null;
    const textoSinFolio = matchFolio ? textoSinFecha.slice(matchFolio[0].length) : textoSinFecha;

    const montos = textoSinFolio.match(RE_MONTO) ?? [];
    if (montos.length !== 2) {
      const descripcionCorta = textoSinFolio.replace(RE_MONTO, "").replace(/\s+/g, " ").trim().slice(0, 120);
      erroresPorFila.push({
        fila: filaNum,
        errores: [`Se esperaban 2 montos (movimiento y saldo) y se encontraron ${montos.length} -- posible línea mal extraída: "${descripcionCorta}"`],
      });
      continue;
    }

    const monto = aNumero(montos[0]);
    const saldo = aNumero(montos[1]);
    const delta = Math.round((saldo - saldoAnterior) * 100) / 100;
    const esDeposito = Math.abs(delta - monto) < 0.01;
    const esRetiro = Math.abs(delta + monto) < 0.01;

    if (!esDeposito && !esRetiro) {
      erroresPorFila.push({
        fila: filaNum,
        errores: [`El saldo (${saldo}) no cuadra con el saldo anterior (${saldoAnterior}) +/- el monto (${monto}) -- posible línea mal extraída`],
      });
      saldoAnterior = saldo;
      continue;
    }

    const descripcion = textoSinFolio
      .replace(RE_MONTO, "")
      .replace(/\s+/g, " ")
      .trim();

    movimientos.push({
      fechaPago: fechaIso,
      fechaOrden: null,
      folio,
      proyecto: null,
      nombreRazonSocial: descripcion || null,
      cargoTotal: esRetiro ? monto : null,
      abonoTotal: esDeposito ? monto : null,
      saldo,
      referenciaTipo: null as ReferenciaTipo | null,
      referenciaNumero: null,
      factura: null,
      comentarios: null,
      observacion: "Extraído automáticamente de un PDF de Santander",
    });
    saldoAnterior = saldo;
  }

  // Autovalidación: el saldo acumulado debe cuadrar con el saldo final
  // declarado, y la suma de depósitos/retiros clasificados debe cuadrar con
  // la línea "TOTAL <depósitos> <retiros>" que el propio documento imprime
  // justo antes de "SALDO FINAL DEL PERIODO:" para esta misma tabla.
  if (saldoFinalDeclarado != null && Math.abs(saldoAnterior - saldoFinalDeclarado) > 0.01) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: `El PDF declara un Saldo Final de ${saldoFinalDeclarado} pero el saldo calculado de los movimientos extraídos termina en ${saldoAnterior} -- no se insertó nada, revisa el archivo manualmente`,
    };
  }

  if (matchTotal) {
    const totalDepositosDeclarado = aNumero(matchTotal[1]);
    const totalRetirosDeclarado = aNumero(matchTotal[2]);
    const sumaDepositos = Math.round(movimientos.reduce((a, mv) => a + (mv.abonoTotal ?? 0), 0) * 100) / 100;
    const sumaRetiros = Math.round(movimientos.reduce((a, mv) => a + (mv.cargoTotal ?? 0), 0) * 100) / 100;
    if (Math.abs(sumaDepositos - totalDepositosDeclarado) > 0.01 || Math.abs(sumaRetiros - totalRetirosDeclarado) > 0.01) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `El PDF declara TOTAL depósitos ${totalDepositosDeclarado} / retiros ${totalRetirosDeclarado} pero lo extraído suma depósitos ${sumaDepositos} / retiros ${sumaRetiros} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
  }

  return { movimientos, erroresPorFila, errorDocumento: null };
}
