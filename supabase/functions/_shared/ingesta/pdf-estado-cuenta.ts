// Parsea el texto ya extraído (por página) de un estado de cuenta en PDF de
// BanBajío al mismo modelo que usa estado-cuenta.ts para Excel/CSV. Soporta
// DOS formatos reales distintos:
//
//   1. Estado de cuenta "clásico" (confirmado contra PDF_BALKEN_JULIO_2026.pdf,
//      cuenta BanBajío 1015 de Vigueta Bovedilla y Bloques Balken, julio
//      2026) -- función parsearFormatoClasico más abajo.
//   2. Portal "Conecta BanBajío" (confirmado contra ESTADO_DE_CUENTA_AL_25_
//      DE_AGOSTO.pdf, cuenta BanBajío 9403 de Mallas y Clavos Clavicón,
//      agosto 2026) -- función parsearFormatoConectaBanBajio más abajo. Se
//      distingue por traer el encabezado "# Fecha Hora Recibo Descripción
//      Cargos Abonos Saldo" en vez de "SALDO INICIAL...SALDO TOTAL".
//
// parsearPdfEstadoCuentaBanBajio (al final de este archivo) detecta cuál de
// los dos trae el PDF y despacha a la función correspondiente.
//
// FORMATO 1 (clásico): con unpdf (ver pdf-cargador.ts) cada movimiento
// normal queda en UNA sola línea de texto con este patrón:
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

function parsearFormatoClasico(textoCompleto: string): ResultadoParseoPdf {
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

// ── Formato 2: portal "Conecta BanBajío" ────────────────────────────────
//
// Ejemplo real (ESTADO_DE_CUENTA_AL_25_DE_AGOSTO.pdf, cuenta 9403 de Mallas
// y Clavos Clavicón):
//
//   # Fecha Hora Recibo Descripción Cargos Abonos Saldo
//   1 21-Ago-2026 12:01:52 1602889016258
//   SPEI Recibido: | Institucion contraparte: BBVA MEXICO Ordenante:...
//   $30,000.00 $37,635.05
//
// Cada movimiento arranca con "<numero de fila> DD-Mmm-AAAA HH:MM:SS
// <no. de recibo>" seguido de la descripción y, al final del bloque, monto +
// saldo. A diferencia del formato clásico, los movimientos vienen en orden
// MÁS RECIENTE PRIMERO (descendente) y NO hay una fila "SALDO INICIAL" --
// solo un resumen al inicio con "Cargos Totales"/"Abonos Totales" (el saldo
// inicial del periodo se DERIVA de esos totales + el saldo del movimiento
// más reciente, mismo criterio que el formato "Detalle de Movimientos" de
// Banorte: saldoInicial = saldoMasReciente - abonosTotales + cargosTotales).
//
// Algunos movimientos (ej. "IVA Comisión" cuando el banco no cobra IVA en
// esa transferencia) declaran monto $0.00 -- ahí el delta contra el saldo
// anterior es cero y NO sirve para distinguir cargo de abono (ambas
// condiciones se cumplen trivialmente). Como en los casos reales estas
// líneas de $0.00 son siempre conceptos de comisión/IVA, se clasifican
// como cargo por convención (monto cero de cualquier forma, no afecta
// ninguna suma) en vez de dejar la fila ambigua o insertar cargo+abono a la
// vez (violaría la constraint de la BD de que un movimiento es exactamente
// uno de los dos).
const RE_ENCABEZADO_CONECTA = "# Fecha Hora Recibo Descripción Cargos Abonos Saldo";
const RE_FECHA_ANCLA_CONECTA = /^(\d{1,3})\s(\d{1,2})-([A-Za-z]{3})-(\d{4})\s(\d{2}:\d{2}:\d{2})\s(\S+)/gm;
const RE_MONTO_CONECTA = /-?[\d,]+\.\d{2}/g;

interface TotalesConecta {
  cargosTotales: number | null;
  abonosTotales: number | null;
}

function extraerTotalesConecta(textoCompleto: string): TotalesConecta {
  const m = textoCompleto.match(/Cargos Totales\s*Abonos Totales\s*\$(-?[\d,]+\.\d{2})\s*\$([\d,]+\.\d{2})/);
  return {
    cargosTotales: m ? Math.abs(aNumero(m[1])) : null,
    abonosTotales: m ? aNumero(m[2]) : null,
  };
}

function parsearFormatoConectaBanBajio(textoCompleto: string): ResultadoParseoPdf {
  const declarado = extraerTotalesConecta(textoCompleto);
  if (declarado.cargosTotales == null || declarado.abonosTotales == null) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: "No se pudieron leer los 'Cargos Totales'/'Abonos Totales' declarados en el PDF -- no se puede calcular el saldo inicial del periodo sin ellos.",
    };
  }

  const idxHeader = textoCompleto.indexOf(RE_ENCABEZADO_CONECTA);
  if (idxHeader === -1) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se encontró la tabla de movimientos (encabezado '# Fecha Hora Recibo Descripción Cargos Abonos Saldo') en el PDF" };
  }
  const idxFinLinea = textoCompleto.indexOf("\n", idxHeader);
  const idxInicioTabla = idxFinLinea === -1 ? idxHeader + RE_ENCABEZADO_CONECTA.length : idxFinLinea + 1;
  const seccion = textoCompleto.slice(idxInicioTabla);

  // Documento en orden MÁS RECIENTE PRIMERO -- se anclan los bloques en ese
  // orden y se procesan en reversa (más antiguo primero) para poder
  // encadenar el saldo cronológicamente, igual que el resto de los parsers.
  const anclas = [...seccion.matchAll(RE_FECHA_ANCLA_CONECTA)];
  if (anclas.length === 0) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se encontró ningún movimiento (fecha DD-Mmm-AAAA) en la tabla del PDF" };
  }

  interface BloqueConecta {
    fechaIso: string;
    recibo: string;
    descripcion: string;
    monto: number;
    saldo: number;
  }
  const bloques: (BloqueConecta | { errorFila: string })[] = [];

  for (let i = 0; i < anclas.length; i++) {
    const m = anclas[i];
    const inicioBloque = m.index!;
    const finBloque = i + 1 < anclas.length ? anclas[i + 1].index! : seccion.length;
    const bloque = seccion.slice(inicioBloque, finBloque);

    const [, , diaStr, mesAbrev, anioStr, , recibo] = m;
    const mes = MESES[mesAbrev.toUpperCase()];
    if (!mes) {
      bloques.push({ errorFila: `Mes no reconocido: "${mesAbrev}"` });
      continue;
    }
    const fechaIso = `${anioStr}-${String(mes).padStart(2, "0")}-${diaStr.padStart(2, "0")}`;

    const textoSinAncla = bloque.slice(m[0].length);
    const montos = textoSinAncla.match(RE_MONTO_CONECTA) ?? [];
    const descripcion = textoSinAncla.replace(RE_MONTO_CONECTA, "").replace(/\$/g, "").replace(/\s+/g, " ").trim();

    // La descripción a veces repite el monto embebido dentro del texto (ej.
    // "TRASPASO por (17,000.00) mxn ... $17,000.00 $7,635.05", o incluso un
    // tercer monto no relacionado como "$ 80.00 IVA Comisión" mencionado de
    // paso dentro de la descripción de otra fila) -- los 2 montos REALES del
    // renglón (movimiento + saldo) siempre son los ÚLTIMOS dos de la línea,
    // porque son los que el banco imprime al final de cada bloque; cualquier
    // monto anterior es solo texto descriptivo.
    if (montos.length < 2) {
      bloques.push({ errorFila: `Se esperaban al menos 2 montos (movimiento y saldo) y se encontraron ${montos.length} -- posible línea mal extraída: "${descripcion.slice(0, 120)}"` });
      continue;
    }

    const [monto, saldo] = montos.slice(-2);
    bloques.push({ fechaIso, recibo, descripcion, monto: aNumero(monto), saldo: aNumero(saldo) });
  }

  const primerBloque = bloques[0];
  if ("errorFila" in primerBloque) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: `No se pudo leer el movimiento más reciente del PDF (${primerBloque.errorFila}) -- no se puede calcular el saldo inicial del periodo sin él.` };
  }
  const saldoMasReciente = primerBloque.saldo;

  // Ver comentario de la sección: no hay "SALDO INICIAL" declarado en este
  // formato, así que se deriva de los totales + el saldo más reciente.
  let saldoAnterior = Math.round((saldoMasReciente - declarado.abonosTotales + declarado.cargosTotales) * 100) / 100;

  const movimientos: FilaEstadoCuentaMapeada[] = [];
  const erroresPorFila: { fila: number; errores: string[] }[] = [];

  // Procesa en reversa (más antiguo -> más reciente) para poder encadenar
  // el saldo cronológicamente a partir de la semilla derivada arriba.
  for (let i = bloques.length - 1; i >= 0; i--) {
    const filaNum = bloques.length - i;
    const bloque = bloques[i];
    if ("errorFila" in bloque) {
      erroresPorFila.push({ fila: filaNum, errores: [bloque.errorFila] });
      continue;
    }

    if (Math.abs(bloque.monto) < 0.01) {
      // Ver comentario de la sección: monto $0.00 no distingue cargo/abono
      // por delta -- se clasifica como cargo por convención.
      movimientos.push({
        fechaPago: bloque.fechaIso,
        fechaOrden: null,
        folio: bloque.recibo,
        proyecto: null,
        nombreRazonSocial: bloque.descripcion || null,
        cargoTotal: 0,
        abonoTotal: null,
        saldo: bloque.saldo,
        referenciaTipo: null as ReferenciaTipo | null,
        referenciaNumero: null,
        factura: null,
        comentarios: null,
        observacion: "Extraído automáticamente de un PDF de BanBajío (portal Conecta BanBajío)",
      });
      saldoAnterior = bloque.saldo;
      continue;
    }

    const delta = Math.round((bloque.saldo - saldoAnterior) * 100) / 100;
    const esAbono = Math.abs(delta - bloque.monto) < 0.01;
    const esCargo = Math.abs(delta + bloque.monto) < 0.01;

    if (!esAbono && !esCargo) {
      erroresPorFila.push({
        fila: filaNum,
        errores: [`El saldo (${bloque.saldo}) no cuadra con el saldo anterior (${saldoAnterior}) +/- el monto (${bloque.monto}) -- posible línea mal extraída`],
      });
      saldoAnterior = bloque.saldo;
      continue;
    }

    movimientos.push({
      fechaPago: bloque.fechaIso,
      fechaOrden: null,
      folio: bloque.recibo,
      proyecto: null,
      nombreRazonSocial: bloque.descripcion || null,
      cargoTotal: esCargo ? bloque.monto : null,
      abonoTotal: esAbono ? bloque.monto : null,
      saldo: bloque.saldo,
      referenciaTipo: null as ReferenciaTipo | null,
      referenciaNumero: null,
      factura: null,
      comentarios: null,
      observacion: "Extraído automáticamente de un PDF de BanBajío (portal Conecta BanBajío)",
    });
    saldoAnterior = bloque.saldo;
  }

  if (Math.abs(saldoAnterior - saldoMasReciente) > 0.01) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: `El saldo calculado del movimiento más reciente (${saldoAnterior}) no cuadra con el declarado en el PDF (${saldoMasReciente}) -- no se insertó nada, revisa el archivo manualmente`,
    };
  }

  const sumaAbonos = Math.round(movimientos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
  if (Math.abs(sumaAbonos - declarado.abonosTotales) > 0.01) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: `El PDF declara Abonos Totales de ${declarado.abonosTotales} pero los movimientos clasificados como abono suman ${sumaAbonos} -- no se insertó nada, revisa el archivo manualmente`,
    };
  }

  const sumaCargos = Math.round(movimientos.reduce((a, m) => a + (m.cargoTotal ?? 0), 0) * 100) / 100;
  if (Math.abs(sumaCargos - declarado.cargosTotales) > 0.01) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: `El PDF declara Cargos Totales de ${declarado.cargosTotales} pero los movimientos clasificados como cargo suman ${sumaCargos} -- no se insertó nada, revisa el archivo manualmente`,
    };
  }

  return { movimientos, erroresPorFila, errorDocumento: null };
}

/**
 * @param textoCompleto Texto de todas las páginas del PDF, concatenado (ver
 *   pdf-cargador.ts para cómo extraerlo con unpdf).
 */
export function parsearPdfEstadoCuentaBanBajio(textoCompleto: string): ResultadoParseoPdf {
  const esFormatoConecta = textoCompleto.includes(RE_ENCABEZADO_CONECTA);
  const esFormatoClasico = textoCompleto.includes("SALDO INICIAL");

  if (esFormatoConecta) return parsearFormatoConectaBanBajio(textoCompleto);
  if (esFormatoClasico) return parsearFormatoClasico(textoCompleto);

  return { movimientos: [], erroresPorFila: [], errorDocumento: "No se pudo determinar el año del periodo en el PDF" };
}
