// Parsea el estado de cuenta de Banorte en PDF, formato "ENLACE NEGOCIOS
// BASICA" (confirmado contra un archivo real: PDF_BANORTE_ACEROS_JULIO_2026.pdf,
// cuenta Banorte 1273 de Aceros y Envasados de Puebla, julio 2026).
//
// A diferencia de BBVA (tabla real con columnas Cargos/Abonos separadas por
// posición), este formato de Banorte NO trae columnas de monto fijas por
// posición -- pdf.js/unpdf lo aplana a texto plano tipo:
//
//   15-JUL-26 PAGO DE CAPITAL 091574212 28,500.00 23,505.04
//
// donde el primer monto es el movimiento (depósito o retiro, sin indicar
// cuál) y el segundo es el saldo resultante. Igual que BanBajío, se
// resuelve depósito/retiro comparando el saldo contra el saldo anterior. La
// complicación real de este banco es que la DESCRIPCIÓN de un movimiento
// puede partirse en VARIAS líneas de texto antes de llegar a los montos
// (ej. un SPEI recibido trae 4 líneas de texto -- CLABE, RFC, referencia,
// clave de rastreo -- antes del monto), así que no se puede procesar línea
// por línea como BanBajío: en vez de eso, se ancla cada movimiento por su
// fecha (que SIEMPRE empieza una línea nueva, "DD-MMM-AA ") y se toma como
// un solo bloque todo el texto hasta la siguiente fecha ancla -- el mismo
// truco que usaba la versión anterior del parser de BBVA (por posición de
// fecha, no de línea) antes de que BBVA se migrara a clasificación por
// columna real.
//
// "IVA:00000000.00" que a veces aparece DENTRO de la descripción (ej.
// "TRASPASO A CUENTA DE TERCEROS ... IVA:00000000.00 , A LA CUENTA: ...")
// tiene formato de monto y hay que quitarlo ANTES de buscar los montos
// reales del renglón (monto + saldo), o se cuenta un monto de más y el
// renglón se reporta como error en vez de insertarse.
//
// CUENTA ÚNICA POR ARCHIVO: un estado de cuenta de Banorte puede traer más
// de un producto (ej. "ENLACE NEGOCIOS BASICA" + "INVERSION ENLACE
// NEGOCIOS" en el mismo PDF, cada uno con su propia tabla "FECHA
// DESCRIPCIÓN..."). Este parser solo lee la PRIMERA tabla de movimientos
// (el producto principal que se está cargando) -- si un producto posterior
// también trae movimientos reales (no "SIN MOVIMIENTOS"), se bloquea todo
// el documento en vez de mezclarlos o adivinar cuál cargar, porque hoy la
// función de ingesta no recibe el número de cuenta del PDF para decidir con
// certeza cuál tabla corresponde a la cuenta bancaria seleccionada.
//
// AUTOVALIDACIÓN: el documento declara su propio "Saldo actual" / "SALDO
// FINAL" y "+ Total de depósitos". Se valida que el saldo acumulado
// calculado (arrancando en "SALDO ANTERIOR") termine exactamente en el
// saldo final declarado, y que la suma de movimientos clasificados como
// depósito cuadre con el total de depósitos declarado -- si no cuadra, no
// se inserta nada. Deliberadamente NO se valida contra "Total de retiros"
// declarado: ese total del banco excluye comisiones/IVA/intereses
// cobrados, que en este parser SÍ se clasifican como cargo (salen de la
// cuenta) -- comparar directo contra "Total de retiros" bloquearía el
// documento en un PDF perfectamente bien leído, así que esa cifra no es
// una base de comparación válida para lo que este parser extrae.

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

const RE_FECHA_ANCLA = /^(\d{2})-([A-Z]{3})-(\d{2})\s/gm;
const RE_IVA_EMBEBIDO = /IVA:[\d,]+\.\d{2}/g;
const RE_MONTO = /-?[\d,]+\.\d{2}/g;
const RE_ENCABEZADO_TABLA = "FECHA DESCRIPCIÓN / ESTABLECIMIENTO";
const RE_OTROS_MARCADOR = "OTROS▼";

function aNumero(texto: string): number {
  return Number(texto.replace(/,/g, ""));
}

interface TotalesDeclarados {
  totalDepositos: number | null;
  saldoFinal: number | null;
}

function extraerTotalesDeclarados(textoCompleto: string): TotalesDeclarados {
  const mDepositos = textoCompleto.match(/\+\s*Total de dep[oó]sitos\s*\$\s*([\d,]+\.\d{2})/i);
  const mSaldoFinal =
    textoCompleto.match(/Saldo actual\s*\$\s*([\d,]+\.\d{2})/i) ?? textoCompleto.match(/SALDO FINAL\s*\$([\d,]+\.\d{2})/i);
  return {
    totalDepositos: mDepositos ? aNumero(mDepositos[1]) : null,
    saldoFinal: mSaldoFinal ? aNumero(mSaldoFinal[1]) : null,
  };
}

/**
 * @param textoCompleto Texto de todas las páginas del PDF, concatenado (ver
 *   pdf-cargador.ts / pdfATexto).
 */
export function parsearPdfEstadoCuentaBanorte(textoCompleto: string): ResultadoParseoPdf {
  const idxHeader1 = textoCompleto.indexOf(RE_ENCABEZADO_TABLA);
  if (idxHeader1 === -1) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se encontró la tabla de movimientos (encabezado FECHA DESCRIPCIÓN / ESTABLECIMIENTO...) en el PDF" };
  }
  const idxFinHeader1 = textoCompleto.indexOf("\n", idxHeader1);
  const inicioSeccion = idxFinHeader1 === -1 ? idxHeader1 + RE_ENCABEZADO_TABLA.length : idxFinHeader1 + 1;

  const idxHeader2 = textoCompleto.indexOf(RE_ENCABEZADO_TABLA, idxHeader1 + 1);
  const idxOtros = textoCompleto.indexOf(RE_OTROS_MARCADOR, idxHeader1 + 1);
  const candidatosFin = [idxHeader2, idxOtros].filter((i) => i !== -1);
  const finSeccion = candidatosFin.length > 0 ? Math.min(...candidatosFin) : textoCompleto.length;

  // Si un segundo producto en el mismo PDF también trae movimientos reales
  // (no "SIN MOVIMIENTOS"), no hay forma de saber con certeza cuál tabla
  // corresponde a la cuenta bancaria seleccionada en la carga -- se bloquea
  // en vez de adivinar.
  if (idxHeader2 !== -1) {
    const idxFinHeader2 = textoCompleto.indexOf("\n", idxHeader2);
    const inicioSeccion2 = idxFinHeader2 === -1 ? idxHeader2 : idxFinHeader2 + 1;
    const finSeccion2 = idxOtros !== -1 && idxOtros > idxHeader2 ? idxOtros : textoCompleto.length;
    const seccion2 = textoCompleto.slice(inicioSeccion2, finSeccion2);
    if (!/SIN MOVIMIENTOS/i.test(seccion2)) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: "El PDF trae más de un producto con movimientos (ej. cuenta + inversión) -- carga de PDF con varios productos no soportada todavía, se necesita agregar el número de cuenta a la carga para saber cuál tabla corresponde.",
      };
    }
  }

  const seccion = textoCompleto.slice(inicioSeccion, finSeccion);

  const anclas = [...seccion.matchAll(RE_FECHA_ANCLA)];
  if (anclas.length === 0) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se encontró ningún movimiento (fecha DD-MMM-AA) en la tabla del PDF" };
  }

  const movimientos: FilaEstadoCuentaMapeada[] = [];
  const erroresPorFila: { fila: number; errores: string[] }[] = [];
  let saldoAnterior: number | null = null;
  let filaNum = 0;

  for (let i = 0; i < anclas.length; i++) {
    const m = anclas[i];
    const inicioBloque = m.index!;
    const finBloque = i + 1 < anclas.length ? anclas[i + 1].index! : seccion.length;
    const bloque = seccion.slice(inicioBloque, finBloque);

    const [, diaStr, mesAbrev, anioStr] = m;
    const mes = MESES[mesAbrev];
    if (!mes) {
      filaNum++;
      erroresPorFila.push({ fila: filaNum, errores: [`Mes no reconocido: "${mesAbrev}"`] });
      continue;
    }
    const fechaIso = `20${anioStr}-${String(mes).padStart(2, "0")}-${diaStr}`;

    const textoSinFecha = bloque.slice(m[0].length);
    const textoSinIva = textoSinFecha.replace(RE_IVA_EMBEBIDO, "");
    const montos = textoSinIva.match(RE_MONTO) ?? [];
    const descripcion = textoSinIva
      .replace(RE_MONTO, "")
      .replace(/\s+/g, " ")
      .trim();

    // "SALDO ANTERIOR" es el ancla del saldo inicial de la sección, no un
    // movimiento -- mismo rol que "SALDO INICIAL" en BanBajío.
    if (/^SALDO ANTERIOR$/i.test(descripcion)) {
      if (montos.length !== 1) {
        return { movimientos: [], erroresPorFila: [], errorDocumento: `No se pudo leer el Saldo Anterior del PDF (se encontraron ${montos.length} monto(s) en esa línea, se esperaba 1)` };
      }
      saldoAnterior = aNumero(montos[0]);
      continue;
    }

    filaNum++;
    if (saldoAnterior === null) {
      erroresPorFila.push({ fila: filaNum, errores: ["Se encontró un movimiento antes de poder leer el Saldo Anterior -- no se puede clasificar depósito/retiro"] });
      continue;
    }
    if (montos.length !== 2) {
      erroresPorFila.push({
        fila: filaNum,
        errores: [`Se esperaban 2 montos (movimiento y saldo) y se encontraron ${montos.length} -- posible línea mal extraída: "${descripcion.slice(0, 120)}"`],
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

    movimientos.push({
      fechaPago: fechaIso,
      fechaOrden: null,
      folio: null,
      proyecto: null,
      nombreRazonSocial: descripcion || null,
      cargoTotal: esRetiro ? monto : null,
      abonoTotal: esDeposito ? monto : null,
      saldo,
      referenciaTipo: null as ReferenciaTipo | null,
      referenciaNumero: null,
      factura: null,
      comentarios: null,
      observacion: "Extraído automáticamente de un PDF de Banorte",
    });
    saldoAnterior = saldo;
  }

  if (saldoAnterior === null) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se pudo leer el Saldo Anterior del PDF" };
  }

  // Autovalidación contra lo que el propio documento declara -- ver
  // comentario del encabezado para por qué no se valida contra "Total de
  // retiros" declarado.
  const declarado = extraerTotalesDeclarados(textoCompleto);

  if (declarado.saldoFinal != null && Math.abs(saldoAnterior - declarado.saldoFinal) > 0.01) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: `El PDF declara un Saldo Final de ${declarado.saldoFinal} pero el saldo calculado de los movimientos extraídos termina en ${saldoAnterior} -- no se insertó nada, revisa el archivo manualmente`,
    };
  }

  if (declarado.totalDepositos != null) {
    const sumaDepositos = Math.round(movimientos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
    if (Math.abs(sumaDepositos - declarado.totalDepositos) > 0.01) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `El PDF declara un Total de Depósitos de ${declarado.totalDepositos} pero los movimientos clasificados como depósito suman ${sumaDepositos} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
  }

  return { movimientos, erroresPorFila, errorDocumento: null };
}
