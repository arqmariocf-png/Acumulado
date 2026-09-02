// Parsea el estado de cuenta de Santander en PDF. Soporta DOS formatos
// reales distintos:
//
//   1. "Cuenta de cheques" (confirmado contra un archivo real:
//      PDF_JULIO_BALKEN_SANTANDER.pdf, cuenta Santander 8617 de Vigueta
//      Bovedilla y Bloques Balken, julio 2026) -- función
//      parsearFormatoCuentaCheques más abajo.
//   2. "Consulta de Movimientos de la Cuenta de Cheques" (confirmado contra
//      un archivo real: ESTADO_DE_CUENTA_AL_31_DE_AGOSTO.pdf, misma cuenta
//      8617, agosto 2026 -- un export distinto del portal Enlace de
//      Santander, con su propio layout) -- función
//      parsearFormatoConsultaMovimientos más abajo. Se distingue por el
//      título "Consulta de Movimientos de la Cuenta de Cheques" en la
//      primera línea del documento.
//
// parsearPdfEstadoCuentaSantander (al final de este archivo) detecta cuál
// de los dos trae el PDF y despacha a la función correspondiente.

import type { ResultadoParseoPdf } from "./pdf-estado-cuenta.ts";
import type { FilaEstadoCuentaMapeada } from "./estado-cuenta.ts";
import type { ReferenciaTipo } from "../motor/types.ts";

const RE_MONTO = /-?[\d,]+\.\d{2}/g;

function aNumero(texto: string): number {
  return Number(texto.replace(/,/g, ""));
}

// ── Formato 1: "Cuenta de cheques" ────────────────────────────────────────
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
const MARCADOR_SALDO_ANTERIOR = "SALDO FINAL DEL PERIODO ANTERIOR:";
const MARCADOR_SALDO_FINAL = "SALDO FINAL DEL PERIODO:";

function extraerSaldoDeMarcador(textoCompleto: string, idxMarcador: number, marcador: string): number | null {
  const ventana = textoCompleto.slice(idxMarcador, idxMarcador + marcador.length + 30);
  const m = ventana.match(/\$?\s*([\d,]+\.\d{2})/);
  return m ? aNumero(m[1]) : null;
}

function parsearFormatoCuentaCheques(textoCompleto: string): ResultadoParseoPdf {
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

// ── Formato 2: "Consulta de Movimientos de la Cuenta de Cheques" ─────────
//
// Confirmado contra un PDF real (ESTADO_DE_CUENTA_AL_31_DE_AGOSTO.pdf,
// misma cuenta 8617 de Vigueta Bovedilla y Bloques Balken, agosto 2026) --
// un export distinto del portal Enlace de Santander (probablemente una
// consulta/historial en vez del estado de cuenta mensual), con tabla real
// de columnas "Cuenta Fecha Hora Sucursal Descripción Importe Cargo Importe
// Abono Saldo Referencia Concepto Descripción Larga".
//
// FECHA PARTIDA EN DOS LÍNEAS: pdf.js/unpdf rompe la fecha "DDMMAAAA" (8
// dígitos, sin separadores) siempre en el mismo punto -- 5 dígitos, salto de
// línea, 3 dígitos -- confirmado en los 15 movimientos reales del PDF
// (ej. "03082\n026" = 03/08/2026). Es un artefacto del ancho de columna del
// PDF, no algo semántico -- se concatenan los 2 grupos y se corta en
// DD/MM/AAAA.
//
// CARGO Y ABONO YA VIENEN EN COLUMNAS SEPARADAS (a diferencia del formato 1
// y de Banorte/BanBajío) -- no hace falta inferir por delta de saldo. Cada
// bloque de movimiento trae, en orden de lectura, exactamente: Descripción
// (texto, sin dígitos con punto decimal) → Importe Cargo → Importe Abono →
// Saldo → Referencia → Concepto (puede traer sus propios montos embebidos,
// ej. "IVA 4827.59") → Descripción Larga. Por eso los PRIMEROS 3 montos con
// formato decimal de cada bloque son, en ese orden, Cargo/Abono/Saldo --
// cualquier monto que aparezca después (dentro de Concepto) se ignora para
// clasificar, aunque si se limpia de la descripción igual.
//
// SALDO YA VIENE REAL POR FILA (no hay que inferir cargo/abono por delta,
// pero SÍ sirve para autovalidar la cadena completa: saldo[i] debe ser
// saldo[i-1] +/- el monto clasificado, en orden ASCENDENTE -- a diferencia
// del formato 1 y de BBVA/Banorte "Detalle...", este documento SÍ viene en
// orden cronológico ascendente, más antiguo primero).
//
// AUTOVALIDACIÓN, más completa que el formato 1: el documento declara
// "Número de Abonos"/"Número de Cargos" (cantidad) Y "Importe Total
// Abonos"/"Importe Total Cargos" (suma) por separado -- confirmado contra
// el PDF real que ambos cuadran exacto (6 abonos por $66,568.65, 9 cargos
// por $76,649.34) -- y "Saldo Final". Si algo no cuadra con cualquiera de
// esos tres, se bloquea todo el documento.
//
// "Saldo Inicial" declarado NO se usa para autovalidar -- confirmado con el
// PDF real que ese campo trae el saldo DESPUÉS del primer movimiento (el
// mismo valor que el propio primer renglón, aunque ese renglón ya incluya
// su abono), no el saldo antes -- una etiqueta del propio banco que no
// describe lo que dice describir. La cadena de saldos (fuerte) y el Saldo
// Final declarado (fuerte) ya dan suficiente confianza sin depender de este
// campo, así que ni se compara ni se advierte por él.

const MARCADOR_TITULO_CONSULTA = "Consulta de Movimientos de la Cuenta de Cheques";
const RE_ENCABEZADO_CONSULTA = "Cuenta Fecha Hora Sucursal Descripción";
const RE_ANCLA_CONSULTA = /^(\d+) (\d{5})\n(\d{3})\n(\d{2}:\d{2}) (\d{4}) /gm;

interface TotalesConsulta {
  saldoFinal: number | null;
  numeroAbonos: number | null;
  numeroCargos: number | null;
  importeTotalAbonos: number | null;
  importeTotalCargos: number | null;
}

function extraerTotalesConsulta(textoCompleto: string): TotalesConsulta {
  const mSaldoFinal = textoCompleto.match(/Saldo Final:\s*\$([\d,]+\.\d{2})/i);
  const mNumAbonos = textoCompleto.match(/N[uú]mero de Abonos:\s*(\d+)/i);
  const mNumCargos = textoCompleto.match(/N[uú]mero de Cargos:\s*(\d+)/i);
  const mImpAbonos = textoCompleto.match(/Importe Total Abonos:\s*\$([\d,]+\.\d{2})/i);
  const mImpCargos = textoCompleto.match(/Importe Total Cargos:\s*\$([\d,]+\.\d{2})/i);
  return {
    saldoFinal: mSaldoFinal ? aNumero(mSaldoFinal[1]) : null,
    numeroAbonos: mNumAbonos ? Number(mNumAbonos[1]) : null,
    numeroCargos: mNumCargos ? Number(mNumCargos[1]) : null,
    importeTotalAbonos: mImpAbonos ? aNumero(mImpAbonos[1]) : null,
    importeTotalCargos: mImpCargos ? aNumero(mImpCargos[1]) : null,
  };
}

function parsearFormatoConsultaMovimientos(textoCompleto: string): ResultadoParseoPdf {
  if (!textoCompleto.includes(RE_ENCABEZADO_CONSULTA)) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: `No se encontró el encabezado de columnas ("${RE_ENCABEZADO_CONSULTA}...") en el PDF`,
    };
  }

  RE_ANCLA_CONSULTA.lastIndex = 0;
  const anclas = [...textoCompleto.matchAll(RE_ANCLA_CONSULTA)];
  if (anclas.length === 0) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se encontró ningún movimiento (cuenta + fecha + hora + sucursal) en la tabla del PDF" };
  }

  const movimientos: FilaEstadoCuentaMapeada[] = [];
  const erroresPorFila: { fila: number; errores: string[] }[] = [];

  for (let i = 0; i < anclas.length; i++) {
    const m = anclas[i];
    const inicio = m.index!;
    const finCrudo = i + 1 < anclas.length ? anclas[i + 1].index! : textoCompleto.length;
    const bloqueCrudo = textoCompleto.slice(inicio, finCrudo);
    // El último movimiento de cada página arrastra el pie de página ("Para
    // dudas o aclaraciones...") y, si hay más páginas, el encabezado
    // repetido de la siguiente -- se recorta ahí si aparece, mismo criterio
    // que los demás parsers de este archivo/proyecto.
    const idxPie = bloqueCrudo.indexOf("Para dudas");
    const bloque = idxPie === -1 ? bloqueCrudo : bloqueCrudo.slice(0, idxPie);
    const filaNum = i + 1;

    const [textoAncla, , diaMes5, diaMes3] = m;
    const fechaDdmmaaaa = diaMes5 + diaMes3; // 8 dígitos: DDMMAAAA, ver comentario de la sección
    const dia = fechaDdmmaaaa.slice(0, 2);
    const mesNum = fechaDdmmaaaa.slice(2, 4);
    const anio = fechaDdmmaaaa.slice(4, 8);
    if (Number(mesNum) < 1 || Number(mesNum) > 12) {
      erroresPorFila.push({ fila: filaNum, errores: [`Mes no reconocido en la fecha "${fechaDdmmaaaa}"`] });
      continue;
    }

    const textoSinAncla = bloque.slice(textoAncla.length);
    const montos = textoSinAncla.match(RE_MONTO) ?? [];
    if (montos.length < 3) {
      erroresPorFila.push({
        fila: filaNum,
        errores: [`Se esperaban al menos 3 montos (Cargo, Abono, Saldo) y se encontraron ${montos.length} -- posible línea mal extraída`],
      });
      continue;
    }
    const cargo = aNumero(montos[0]);
    const abono = aNumero(montos[1]);
    const saldo = aNumero(montos[2]);

    if (cargo !== 0 && abono !== 0) {
      erroresPorFila.push({
        fila: filaNum,
        errores: [`La fila trae Importe Cargo (${cargo}) e Importe Abono (${abono}) a la vez -- posible columna mal identificada`],
      });
      continue;
    }
    // Ambos en $0.00 no se ha visto en un PDF real todavía, pero de
    // aparecer se clasifica como cargo por convención (igual que BanBajío
    // Conecta) para no violar la constraint de la BD de exactamente uno.
    const cargoTotal = cargo !== 0 ? cargo : abono === 0 ? 0 : null;
    const abonoTotal = cargo !== 0 ? null : abono !== 0 ? abono : null;

    const descripcion = textoSinAncla.replace(RE_MONTO, "").replace(/\s+/g, " ").trim();

    movimientos.push({
      fechaPago: `${anio}-${mesNum}-${dia}`,
      fechaOrden: null,
      folio: null,
      proyecto: null,
      nombreRazonSocial: descripcion || null,
      cargoTotal,
      abonoTotal,
      saldo,
      referenciaTipo: null as ReferenciaTipo | null,
      referenciaNumero: null,
      factura: null,
      comentarios: null,
      observacion: "Extraído automáticamente de un PDF de Santander (Consulta de Movimientos)",
    });
  }

  // Autovalidación FUERTE #1: cadena de saldos en orden ascendente (ver
  // comentario de la sección) -- si algo no cuadra, no se puede confiar en
  // el saldo de ningún movimiento ya acumulado.
  for (let i = 1; i < movimientos.length; i++) {
    const anterior = movimientos[i - 1];
    const actual = movimientos[i];
    const esperado = Math.round((anterior.saldo + (actual.abonoTotal ?? 0) - (actual.cargoTotal ?? 0)) * 100) / 100;
    if (Math.abs(esperado - actual.saldo) > 0.01) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `El saldo del movimiento del ${actual.fechaPago} (${actual.saldo}) no cuadra con el saldo del movimiento anterior (${anterior.saldo}) +/- el monto clasificado -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
  }

  // Autovalidación FUERTE #2 y #3: cantidad + suma de cargos/abonos, y saldo
  // final, contra lo que el propio documento declara (ver comentario de la
  // sección).
  const declarado = extraerTotalesConsulta(textoCompleto);
  const cargosExtraidos = movimientos.filter((mv) => mv.cargoTotal != null);
  const abonosExtraidos = movimientos.filter((mv) => mv.abonoTotal != null);
  const sumaCargos = Math.round(cargosExtraidos.reduce((a, mv) => a + (mv.cargoTotal ?? 0), 0) * 100) / 100;
  const sumaAbonos = Math.round(abonosExtraidos.reduce((a, mv) => a + (mv.abonoTotal ?? 0), 0) * 100) / 100;

  if (declarado.numeroCargos != null && declarado.importeTotalCargos != null) {
    if (cargosExtraidos.length !== declarado.numeroCargos || Math.abs(sumaCargos - declarado.importeTotalCargos) > 0.01) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `El PDF declara ${declarado.numeroCargos} cargo(s) por $${declarado.importeTotalCargos} pero se extrajeron ${cargosExtraidos.length} por $${sumaCargos} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
  }

  if (declarado.numeroAbonos != null && declarado.importeTotalAbonos != null) {
    if (abonosExtraidos.length !== declarado.numeroAbonos || Math.abs(sumaAbonos - declarado.importeTotalAbonos) > 0.01) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `El PDF declara ${declarado.numeroAbonos} abono(s) por $${declarado.importeTotalAbonos} pero se extrajeron ${abonosExtraidos.length} por $${sumaAbonos} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
  }

  if (declarado.saldoFinal != null && movimientos.length > 0) {
    const ultimoSaldo = movimientos[movimientos.length - 1].saldo;
    if (Math.abs(ultimoSaldo - declarado.saldoFinal) > 0.01) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `El PDF declara un Saldo Final de ${declarado.saldoFinal} pero el último movimiento extraído queda en ${ultimoSaldo} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
  }

  return { movimientos, erroresPorFila, errorDocumento: null };
}

/**
 * @param textoCompleto Texto de todas las páginas del PDF, concatenado (ver
 *   pdf-cargador.ts / pdfATexto).
 */
export function parsearPdfEstadoCuentaSantander(textoCompleto: string): ResultadoParseoPdf {
  if (textoCompleto.includes(MARCADOR_TITULO_CONSULTA)) {
    return parsearFormatoConsultaMovimientos(textoCompleto);
  }
  return parsearFormatoCuentaCheques(textoCompleto);
}
