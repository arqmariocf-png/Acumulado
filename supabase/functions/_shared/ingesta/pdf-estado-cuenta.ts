// Parsea el texto ya extraído (por página) de un estado de cuenta en PDF de
// BanBajío al mismo modelo que usa estado-cuenta.ts para Excel/CSV.
//
// Confirmado contra un archivo real (PDF_BALKEN_JULIO_2026.pdf, cuenta
// BanBajío 1015 de Vigueta Bovedilla y Bloques Balken, julio 2026). Con
// unpdf (ver pdf-cargador.ts) cada movimiento normal queda en UNA sola línea
// de texto con este patrón:
//
//   <día> <MES abrev.> [<no. ref>] <descripción> $ <monto> $ <saldo>
//
// ej. "1 JUL COMISION ADMINISTRACION DE PAQUETE DE SERVICIOS $ 500.00 $ 8,306.09"
//     "3 JUL 2624276 DEPÓSITO SPEI:TRASPASO $ 32,000.00 $ 32,000.00"
//
// El PDF NO trae una columna "Cargo"/"Abono" explícita en cada línea -- solo
// <monto> y <saldo>. Se resuelve cargo vs. abono comparando el saldo de la
// fila contra el saldo de la fila anterior (que arranca en "SALDO INICIAL"):
// si sube, es abono; si baja, es cargo. Las líneas de metadata que Banbajío
// agrega después de cada depósito SPEI (INSTITUCIÓN EMISORA, ORDENANTE,
// CUENTA ORDENANTE, REFERENCIA, HORA, CLAVE DE RASTREO) no matchean el
// patrón de movimiento y se ignoran -- no son filas nuevas.
//
// El documento se autovalida: trae su propio total de movimientos
// ("TOTAL DE MOVIMIENTOS EN EL PERIODO") y saldo final ("SALDO TOTAL*"). Si
// lo que se logró parsear no cuadra con esos dos valores que el banco
// declara, se reporta como error en vez de insertar datos que podrían estar
// mal extraídos en silencio -- exactamente el riesgo que SPEC.md sección 2
// prohíbe para los parsers de Excel/CSV, aplicado aquí a PDF.

import type { FilaEstadoCuentaMapeada } from "./estado-cuenta.ts";
import type { ReferenciaTipo } from "../motor/types.ts";

export interface ResultadoParseoPdf {
  movimientos: FilaEstadoCuentaMapeada[];
  erroresPorFila: { fila: number; errores: string[] }[];
  /** Error a nivel de documento completo (no se pudo ubicar la sección de
   * movimientos, o el total/saldo parseado no cuadra con lo que el banco
   * declara en el propio PDF) -- si viene lleno, no confiar en `movimientos`. */
  errorDocumento: string | null;
}

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

const RE_LINEA_MOVIMIENTO =
  /^(\d{1,2})\s+([A-ZÁÉÍÓÚÑ]{3})\s+(?:(\d+)\s+)?(.+?)\s+\$\s*([\d,]+\.\d{2})\s+\$\s*([\d,]+\.\d{2})\s*$/;

function aNumero(texto: string): number {
  return Number(texto.replace(/,/g, ""));
}

function extraerAnio(texto: string): number | null {
  const m1 = texto.match(/PERIODO:.*?DE\s+(\d{4})/i);
  if (m1) return Number(m1[1]);
  const m2 = texto.match(/FECHA DE CORTE\s+\d{1,2}\s+[A-ZÁÉÍÓÚ]+\s+(\d{4})/i);
  if (m2) return Number(m2[1]);
  return null;
}

/**
 * @param textoCompleto Texto de todas las páginas del PDF, concatenado (ver
 *   pdf-cargador.ts para cómo extraerlo con unpdf).
 */
export function parsearPdfEstadoCuentaBanBajio(textoCompleto: string): ResultadoParseoPdf {
  const anio = extraerAnio(textoCompleto);
  if (!anio) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se pudo determinar el año del periodo en el PDF" };
  }

  const idxInicio = textoCompleto.indexOf("SALDO INICIAL");
  const idxFin = textoCompleto.indexOf("SALDO TOTAL", idxInicio);
  if (idxInicio === -1 || idxFin === -1 || idxFin <= idxInicio) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se encontró la sección de movimientos (SALDO INICIAL...SALDO TOTAL) en el PDF" };
  }
  const seccion = textoCompleto.slice(idxInicio, idxFin);

  const matchSaldoInicial = seccion.match(/SALDO INICIAL\s*\$?\s*([\d,]+\.\d{2})/i);
  if (!matchSaldoInicial) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se pudo leer el Saldo Inicial del PDF" };
  }

  const movimientos: FilaEstadoCuentaMapeada[] = [];
  const erroresPorFila: { fila: number; errores: string[] }[] = [];
  let saldoAnterior = aNumero(matchSaldoInicial[1]);
  let fila = 0;

  for (const linea of seccion.split("\n")) {
    const m = linea.trim().match(RE_LINEA_MOVIMIENTO);
    if (!m) continue;
    fila++;

    const [, diaStr, mesAbrev, refNumero, descripcion, montoStr, saldoStr] = m;
    const mes = MESES[mesAbrev.toUpperCase()];
    if (!mes) {
      erroresPorFila.push({ fila, errores: [`Mes no reconocido: "${mesAbrev}"`] });
      continue;
    }

    const monto = aNumero(montoStr);
    const saldo = aNumero(saldoStr);
    const delta = Math.round((saldo - saldoAnterior) * 100) / 100;
    const esAbono = Math.abs(delta - monto) < 0.01;
    const esCargo = Math.abs(delta + monto) < 0.01;

    if (!esAbono && !esCargo) {
      erroresPorFila.push({
        fila,
        errores: [`El saldo (${saldo}) no cuadra con el saldo anterior (${saldoAnterior}) +/- el monto (${monto}) -- posible línea mal extraída`],
      });
      saldoAnterior = saldo;
      continue;
    }

    movimientos.push({
      fechaPago: `${anio}-${String(mes).padStart(2, "0")}-${diaStr.padStart(2, "0")}`,
      fechaOrden: null,
      folio: refNumero ?? null,
      proyecto: null,
      nombreRazonSocial: descripcion.trim(),
      cargoTotal: esCargo ? monto : null,
      abonoTotal: esAbono ? monto : null,
      saldo,
      referenciaTipo: null as ReferenciaTipo | null,
      referenciaNumero: null,
      factura: null,
      comentarios: null,
      observacion: "Extraído automáticamente de un PDF de BanBajío",
    });
    saldoAnterior = saldo;
  }

  // Autovalidación contra lo que el propio documento declara -- si no
  // cuadra, no se puede confiar en que la extracción leyó todas las líneas
  // correctamente (ej. una página que el extractor de PDF no devolvió).
  const matchTotalDeclarado = textoCompleto.match(/TOTAL DE MOVIMIENTOS EN EL PERIODO\s+(\d+)/i);
  if (matchTotalDeclarado) {
    const totalDeclarado = Number(matchTotalDeclarado[1]);
    const totalParseado = movimientos.length + erroresPorFila.length;
    if (totalDeclarado !== totalParseado) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `El PDF declara ${totalDeclarado} movimientos en el periodo pero se extrajeron ${totalParseado} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
  }

  const matchSaldoFinalDeclarado = textoCompleto.slice(idxFin).match(/SALDO TOTAL\*?\s*\$?\s*([\d,]+\.\d{2})/i);
  if (matchSaldoFinalDeclarado && movimientos.length > 0) {
    const saldoFinalDeclarado = aNumero(matchSaldoFinalDeclarado[1]);
    const saldoFinalParseado = movimientos[movimientos.length - 1].saldo;
    if (Math.abs(saldoFinalDeclarado - saldoFinalParseado) > 0.01) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `El PDF declara un Saldo Total de ${saldoFinalDeclarado} pero el último movimiento extraído queda en ${saldoFinalParseado} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
  }

  return { movimientos, erroresPorFila, errorDocumento: null };
}
