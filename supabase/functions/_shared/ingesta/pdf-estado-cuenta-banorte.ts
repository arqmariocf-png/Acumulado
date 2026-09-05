// Parsea el estado de cuenta de Banorte en PDF. Soporta TRES formatos reales
// distintos que Banorte genera para el mismo banco, según de dónde se haya
// descargado el PDF:
//
//   1. "ESTADO DE CUENTA" mensual formal, formato "ENLACE NEGOCIOS BASICA"
//      (confirmado contra PDF_BANORTE_ACEROS_JULIO_2026.pdf, cuenta Banorte
//      1273 de Aceros y Envasados de Puebla, julio 2026) -- función
//      parsearFormatoEstadoCuentaMensual más abajo.
//   2. "Detalle de Movimientos" exportado del portal en línea Enlace
//      (confirmado contra ESTADO_DE_CUENTA_AL_25_DE_AGOSTO.pdf, cuenta
//      Banorte 7022 de Ergodinova, del 01 al 25 de agosto 2026) -- función
//      parsearFormatoDetalleMovimientos más abajo. Se distingue por traer el
//      encabezado "Fecha Movimiento Cód. Trans. Concepto Retiros Depósitos
//      Saldos" en vez de "FECHA DESCRIPCIÓN / ESTABLECIMIENTO...".
//   3. "Cuentas de Cheques" detallado, con Depósitos/Retiros ya en columnas
//      separadas (confirmado contra ESTADO_DE_CUENTA_AL_4_DE_SEPTIEMBRE.pdf,
//      misma cuenta Banorte 1273 de Aceros, agosto 2026) -- función
//      parsearFormatoCuentaChequesDetallado más abajo. Se distingue por el
//      encabezado "MOVIMIENTO DESCRIPCIÓN DETALLADA" (ver comentario de esa
//      sección para el resto del encabezado, partido en varias líneas).
//
// parsearPdfEstadoCuentaBanorte (al final de este archivo) detecta cuál de
// los tres trae el PDF y despacha a la función correspondiente.
//
// A diferencia de BBVA (tabla real con columnas Cargos/Abonos separadas por
// posición), ninguno de los dos formatos de Banorte trae columnas de monto
// fijas por posición -- pdf.js/unpdf lo aplana a texto plano tipo:
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
// DESCRIPCIÓN..."). Cuando esto pasa, se usa la tabla "RESUMEN INTEGRAL"
// del encabezado del PDF (lista cada producto junto con su "No. de Cuenta"
// completo) para ubicar cuál tabla de movimientos corresponde a la cuenta
// bancaria seleccionada en la carga (cuentaUltimos4, los últimos 4 dígitos
// de cuentas_bancarias.ultimos_4) -- así se soporta el PDF sin adivinar ni
// mezclar productos. Si no se pasa cuentaUltimos4 (llamada sin ese dato) o
// no se pudo ubicar el producto en el RESUMEN INTEGRAL, se cae al
// comportamiento anterior: bloquear el documento si un producto posterior
// también trae movimientos reales (no "SIN MOVIMIENTOS"), en vez de
// adivinar cuál cargar.
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
// \s (no espacio literal) porque en el formato "Detalle de Movimientos" el
// monto del IVA embebido a veces cae en la línea siguiente dentro del mismo
// bloque de texto plano (ej. "RFC: AUSD881130R6A IVA:\n000000000055.17 ..."),
// a diferencia del formato de estado de cuenta mensual donde siempre es
// "IVA:00000000.00" pegado sin espacio.
const RE_IVA_EMBEBIDO = /IVA:\s*[\d,]+\.\d{2}/g;
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

interface ProductoResumenIntegral {
  producto: string;
  noCuenta: string;
}

// "RESUMEN INTEGRAL" lista cada producto del PDF junto con su número de
// cuenta completo, ej.:
//   Producto No. de Cuenta CLABE Saldo anterior Saldo al corte
//   ENLACE NEGOCIOS BASICA 1155651273 072 650 01155651273 6 $4,237.85 $3,773.86
//   INVERSION ENLACE NEGOCIOS 1155652515 072 650 01155652515 0 $0.00 $0.00
// Solo se necesita el nombre del producto y su No. de Cuenta -- el resto de
// la línea (CLABE y saldos) no se usa aquí.
const RE_FILA_RESUMEN_INTEGRAL = /^([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 .]*?)\s(\d{6,})\s\d/gm;

function extraerProductosResumenIntegral(textoCompleto: string): ProductoResumenIntegral[] {
  const idxInicio = textoCompleto.indexOf("Producto No. de Cuenta CLABE Saldo anterior Saldo al corte");
  if (idxInicio === -1) return [];
  const idxFin = textoCompleto.indexOf("\nTOTAL", idxInicio);
  const bloque = textoCompleto.slice(idxInicio, idxFin === -1 ? undefined : idxFin);
  return [...bloque.matchAll(RE_FILA_RESUMEN_INTEGRAL)].map((m) => ({ producto: m[1].trim(), noCuenta: m[2] }));
}

function nombreProductoDeHeader(textoCompleto: string, idxHeader: number): string {
  // idxHeader - 1 es el "\n" que termina la línea anterior (el nombre del
  // producto) -- hay que buscar el "\n" ANTERIOR a ese para tomar esa línea
  // completa, no el que ya la termina.
  const idxFinLineaAnterior = idxHeader - 1;
  const idxInicioLineaAnterior = textoCompleto.lastIndexOf("\n", idxFinLineaAnterior - 1) + 1;
  return textoCompleto.slice(idxInicioLineaAnterior, idxFinLineaAnterior).trim();
}

function seccionDeHeader(textoCompleto: string, idxHeader: number, idxSiguienteHeader: number | null, idxOtros: number): string {
  const idxFinLinea = textoCompleto.indexOf("\n", idxHeader);
  const inicio = idxFinLinea === -1 ? idxHeader + RE_ENCABEZADO_TABLA.length : idxFinLinea + 1;
  const candidatosFin = [idxSiguienteHeader, idxOtros !== -1 && idxOtros > idxHeader ? idxOtros : null].filter(
    (i): i is number => i != null,
  );
  const fin = candidatosFin.length > 0 ? Math.min(...candidatosFin) : textoCompleto.length;
  return textoCompleto.slice(inicio, fin);
}

/**
 * @param textoCompleto Texto de todas las páginas del PDF, concatenado (ver
 *   pdf-cargador.ts / pdfATexto).
 * @param cuentaUltimos4 Últimos 4 dígitos de la cuenta bancaria seleccionada
 *   en la carga (cuentas_bancarias.ultimos_4) -- se usa para elegir la tabla
 *   de movimientos correcta cuando el PDF trae más de un producto. Si se
 *   omite, o no se pudo ubicar el producto en el RESUMEN INTEGRAL, se cae al
 *   comportamiento de bloquear el documento ante un segundo producto con
 *   movimientos reales.
 */
function parsearFormatoEstadoCuentaMensual(textoCompleto: string, cuentaUltimos4?: string): ResultadoParseoPdf {
  const posicionesHeader = [...textoCompleto.matchAll(new RegExp(RE_ENCABEZADO_TABLA, "g"))].map((m) => m.index!);
  const idxOtros = textoCompleto.indexOf(RE_OTROS_MARCADOR);

  let idxElegidoPos = 0;

  if (posicionesHeader.length > 1) {
    if (cuentaUltimos4) {
      const productos = extraerProductosResumenIntegral(textoCompleto);
      const productoDeLaCuenta = productos.find((p) => p.noCuenta.endsWith(cuentaUltimos4));
      const idxEncontrado = productoDeLaCuenta
        ? posicionesHeader.findIndex((idx) => nombreProductoDeHeader(textoCompleto, idx).toUpperCase() === productoDeLaCuenta.producto.toUpperCase())
        : -1;
      if (idxEncontrado === -1) {
        return {
          movimientos: [],
          erroresPorFila: [],
          errorDocumento: `El PDF trae más de un producto y no se pudo ubicar cuál corresponde a la cuenta terminación ${cuentaUltimos4} en el RESUMEN INTEGRAL del documento -- revisa que sea el PDF correcto para esta cuenta.`,
        };
      }
      idxElegidoPos = idxEncontrado;
    } else {
      // Sin número de cuenta para desambiguar: solo es seguro seguir si
      // ningún producto posterior al primero trae movimientos reales.
      for (let i = 1; i < posicionesHeader.length; i++) {
        const idxSiguiente = i + 1 < posicionesHeader.length ? posicionesHeader[i + 1] : null;
        const seccionN = seccionDeHeader(textoCompleto, posicionesHeader[i], idxSiguiente, idxOtros);
        if (!/SIN MOVIMIENTOS/i.test(seccionN)) {
          return {
            movimientos: [],
            erroresPorFila: [],
            errorDocumento: "El PDF trae más de un producto con movimientos (ej. cuenta + inversión) -- carga de PDF con varios productos no soportada todavía, se necesita agregar el número de cuenta a la carga para saber cuál tabla corresponde.",
          };
        }
      }
    }
  }

  const idxHeaderElegido = posicionesHeader[idxElegidoPos];
  const idxSiguienteElegido = idxElegidoPos + 1 < posicionesHeader.length ? posicionesHeader[idxElegidoPos + 1] : null;
  const seccion = seccionDeHeader(textoCompleto, idxHeaderElegido, idxSiguienteElegido, idxOtros);

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
    // movimiento -- mismo rol que "SALDO INICIAL" en BanBajío. Cuando la
    // cuenta no tuvo movimientos en el periodo, el banco imprime "SIN
    // MOVIMIENTOS" pegado en la misma línea/bloque (sin otra fecha ancla que
    // lo separe, porque no hay ningún movimiento real después) -- confirmado
    // con un PDF real (Constructora Supervisión y Consultoría LOMA, cuenta
    // Banorte 7529, julio 2026: "30-JUN-26 SALDO ANTERIOR 17,184.01\nSIN
    // MOVIMIENTOS"). Sin este descuento, la comparación exacta de abajo
    // fallaba porque la descripción traía "SALDO ANTERIOR SIN MOVIMIENTOS",
    // no "SALDO ANTERIOR" a secas, y el documento se bloqueaba entero con
    // "No se pudo leer el Saldo Anterior del PDF" para una cuenta sin nada
    // que insertar -- no un error real de extracción.
    const descripcionSinAvisoVacio = descripcion.replace(/\s*SIN MOVIMIENTOS\s*$/i, "").trim();
    if (/^SALDO ANTERIOR$/i.test(descripcionSinAvisoVacio)) {
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
  // retiros" declarado. Solo se aplica cuando el producto elegido es el
  // primero del PDF: el layout con "Saldo actual $X" / "+ Total de
  // depósitos $X" etiquetados solo se confirmó contra un PDF real para el
  // producto principal -- en productos posteriores (ej. una inversión que
  // acompaña a la cuenta) ese resumen aparece colapsado sin etiquetas, así
  // que buscar esas frases en todo el documento podría comparar contra el
  // resumen de OTRO producto. La consistencia interna (saldo acumulado
  // movimiento a movimiento arrancando en "SALDO ANTERIOR" de la sección
  // elegida) ya se valida arriba sin depender de esto.
  const declarado = idxElegidoPos === 0 ? extraerTotalesDeclarados(textoCompleto) : { totalDepositos: null, saldoFinal: null };

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

// ── Formato 2: "Detalle de Movimientos" del portal Enlace ──────────────────
//
// Ejemplo real (ESTADO_DE_CUENTA_AL_25_DE_AGOSTO.pdf, cuenta 7022 de
// Ergodinova):
//
//   Fecha Movimiento Cód. Trans. Concepto Retiros Depósitos Saldos Cheque
//   03/Ago./2026 10130 511
//   COMPRA ORDEN DE PAGO SPEI 030826 =REFERENCIA CTA/CLABE:...
//   $400.00 $2,165,024.37
//
// Cada movimiento arranca con "DD/Mmm./AAAA " seguido del número de
// Movimiento y Cód. de Trans. del banco (ambos enteros, se descartan del
// texto de la descripción salvo el de Movimiento que se guarda como folio).
// A diferencia del formato mensual, este NO trae una fila "SALDO ANTERIOR"
// que ancle el saldo inicial de la tabla -- en vez de eso, el saldo inicial
// del periodo se DERIVA de lo que el documento sí declara en su encabezado
// ("Saldo Actual") y al final de la tabla ("Total: $retiros $depositos"):
// saldoInicial = saldoActual - totalDepositos + totalRetiros. Esto además
// sirve de autovalidación: si la extracción de algún monto o su
// clasificación depósito/retiro falla, la cadena de saldos (que sí se lee
// directo del texto en cada renglón, no se calcula) no va a terminar en el
// "Saldo Actual" declarado, y se bloquea el documento.
const RE_ENCABEZADO_DETALLE = "Fecha Movimiento Cód. Trans. Concepto Retiros Depósitos Saldos";
const RE_FECHA_ANCLA_DETALLE = /^(\d{2})\/([A-Za-z]{3})\.\/(\d{4})\s/gm;
const RE_MOVIMIENTO_COD_TRANS = /^(\d+)\s+(\d+)\s*/;
const RE_CUENTA_SUCURSAL = /(\d{6,})\s\|\s\d{3,4}-SUCURSAL/;

interface TotalesDetalle {
  saldoActual: number | null;
  totalRetiros: number | null;
  totalDepositos: number | null;
  numeroCuenta: string | null;
}

function extraerTotalesDetalle(textoCompleto: string): TotalesDetalle {
  const mSaldoActual = textoCompleto.match(/Saldo Actual:\s*\$([\d,]+\.\d{2})/i);
  const mTotal = textoCompleto.match(/^Total:\s*\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})/m);
  const mCuenta = textoCompleto.match(RE_CUENTA_SUCURSAL);
  return {
    saldoActual: mSaldoActual ? aNumero(mSaldoActual[1]) : null,
    totalRetiros: mTotal ? aNumero(mTotal[1]) : null,
    totalDepositos: mTotal ? aNumero(mTotal[2]) : null,
    numeroCuenta: mCuenta ? mCuenta[1] : null,
  };
}

function parsearFormatoDetalleMovimientos(textoCompleto: string, cuentaUltimos4?: string): ResultadoParseoPdf {
  const declarado = extraerTotalesDetalle(textoCompleto);

  if (cuentaUltimos4 && declarado.numeroCuenta && !declarado.numeroCuenta.endsWith(cuentaUltimos4)) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: `El PDF es de la cuenta terminación ${declarado.numeroCuenta.slice(-4)}, no de la cuenta terminación ${cuentaUltimos4} seleccionada -- revisa que sea el PDF correcto.`,
    };
  }

  if (declarado.saldoActual == null || declarado.totalRetiros == null || declarado.totalDepositos == null) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: "No se pudo determinar el saldo inicial del periodo -- faltan 'Saldo Actual:' o la fila 'Total: $... $...' que el PDF debe declarar al final de la tabla de movimientos.",
    };
  }

  const idxHeader = textoCompleto.indexOf(RE_ENCABEZADO_DETALLE);
  const idxFinLinea = textoCompleto.indexOf("\n", idxHeader);
  const idxInicioTabla = idxFinLinea === -1 ? idxHeader + RE_ENCABEZADO_DETALLE.length : idxFinLinea + 1;
  const mFinTabla = textoCompleto.slice(idxInicioTabla).match(/^Total:/m);
  const idxFinTabla = mFinTabla ? idxInicioTabla + mFinTabla.index! : -1;
  const seccion = textoCompleto.slice(idxInicioTabla, idxFinTabla === -1 ? undefined : idxFinTabla);

  const anclas = [...seccion.matchAll(RE_FECHA_ANCLA_DETALLE)];
  if (anclas.length === 0) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se encontró ningún movimiento (fecha DD/Mmm./AAAA) en la tabla del PDF" };
  }

  // Ver comentario de la sección arriba: no hay "SALDO ANTERIOR" en este
  // formato, así que el saldo inicial se deriva de lo declarado.
  let saldoAnterior = Math.round((declarado.saldoActual - declarado.totalDepositos + declarado.totalRetiros) * 100) / 100;

  const movimientos: FilaEstadoCuentaMapeada[] = [];
  const erroresPorFila: { fila: number; errores: string[] }[] = [];
  let filaNum = 0;

  for (let i = 0; i < anclas.length; i++) {
    const m = anclas[i];
    const inicioBloque = m.index!;
    const finBloque = i + 1 < anclas.length ? anclas[i + 1].index! : seccion.length;
    const bloque = seccion.slice(inicioBloque, finBloque);

    const [, diaStr, mesAbrev, anioStr] = m;
    const mes = MESES[mesAbrev.toUpperCase()];
    filaNum++;
    if (!mes) {
      erroresPorFila.push({ fila: filaNum, errores: [`Mes no reconocido: "${mesAbrev}"`] });
      continue;
    }
    const fechaIso = `${anioStr}-${String(mes).padStart(2, "0")}-${diaStr}`;

    const textoSinFecha = bloque.slice(m[0].length);
    const mMovCod = textoSinFecha.match(RE_MOVIMIENTO_COD_TRANS);
    const folio = mMovCod ? mMovCod[1] : null;
    const textoSinMovCod = mMovCod ? textoSinFecha.slice(mMovCod[0].length) : textoSinFecha;
    const textoSinIva = textoSinMovCod.replace(RE_IVA_EMBEBIDO, "");
    const montos = textoSinIva.match(RE_MONTO) ?? [];
    const descripcion = textoSinIva
      .replace(RE_MONTO, "")
      .replace(/\s+/g, " ")
      .trim();

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
      observacion: "Extraído automáticamente de un PDF de Banorte (Detalle de Movimientos)",
    });
    saldoAnterior = saldo;
  }

  if (Math.abs(saldoAnterior - declarado.saldoActual) > 0.01) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: `El PDF declara un Saldo Actual de ${declarado.saldoActual} pero el saldo de los movimientos extraídos termina en ${saldoAnterior} -- no se insertó nada, revisa el archivo manualmente`,
    };
  }

  const sumaDepositos = Math.round(movimientos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
  if (Math.abs(sumaDepositos - declarado.totalDepositos) > 0.01) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: `El PDF declara un total de Depósitos de ${declarado.totalDepositos} pero los movimientos clasificados como depósito suman ${sumaDepositos} -- no se insertó nada, revisa el archivo manualmente`,
    };
  }

  const sumaRetiros = Math.round(movimientos.reduce((a, m) => a + (m.cargoTotal ?? 0), 0) * 100) / 100;
  if (Math.abs(sumaRetiros - declarado.totalRetiros) > 0.01) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: `El PDF declara un total de Retiros de ${declarado.totalRetiros} pero los movimientos clasificados como retiro suman ${sumaRetiros} -- no se insertó nada, revisa el archivo manualmente`,
    };
  }

  return { movimientos, erroresPorFila, errorDocumento: null };
}

// ── Formato 3: "Cuentas de Cheques" detallado ───────────────────────────
//
// Confirmado contra un PDF real (ESTADO_DE_CUENTA_AL_4_DE_SEPTIEMBRE.pdf,
// misma cuenta 1273 de Aceros y Envasados de Puebla, agosto 2026) -- un
// tercer export de Banorte, distinto tanto del "ESTADO DE CUENTA" mensual
// como del "Detalle de Movimientos" de arriba. El encabezado real es:
//
//   CUENTA FECHA DE
//   OPERACIÓN FECHA REFERENCIA DESCRIPCIÓN COD.
//   TRANSAC SUCURSAL DEPÓSITOS RETIROS SALDO MOVIMIENTO DESCRIPCIÓN DETALLADA CHEQUE
//
// pdf.js lo parte en esas 3 líneas por el ancho de columna -- se detecta
// solo por el fragmento "MOVIMIENTO DESCRIPCIÓN DETALLADA", que siempre
// queda junto y no aparece en los otros 2 formatos.
//
// A diferencia de los otros dos, Depósitos y Retiros YA vienen en columnas
// separadas (con "-" como relleno de la columna vacía) -- no hace falta
// inferir por delta de saldo, y cada movimiento SÍ trae su propio SALDO
// real impreso (a diferencia del formato mensual, que solo lo imprime en
// SALDO ANTERIOR). Cada renglón arranca con el número de cuenta completo
// repetido (ej. "1155651273"), seguido de FECHA DE OPERACIÓN, FECHA,
// REFERENCIA -- se ancla por ese patrón fijo (ver RE_ANCLA_DETALLADO) en
// vez de por la fecha sola, porque una fecha DD/MM/AAAA por sí sola no es
// lo bastante única para no confundirse con una fecha mencionada dentro de
// la descripción detallada de un SPEI (ej. "REFERENCIA: 0140826").
//
// Justo después de Depósitos/Retiros/Saldo viene el número de MOVIMIENTO
// (un consecutivo del banco, ej. 657, 658...) pegado sin nada en medio --
// se usa como ancla para extraer los 3 montos + el consecutivo en un solo
// match (ver RE_MONTOS_MOVIMIENTO), y el consecutivo se guarda como folio,
// mismo criterio que "Movimiento" en el formato "Detalle de Movimientos".
// COD. TRANSAC (3 dígitos) y SUCURSAL (3-4 dígitos) siempre son los
// últimos 2 números antes de esa ancla -- se recortan de la descripción
// porque no aportan nada legible (ver limpiarDescripcionDetallado).
//
// CUENTA ÚNICA POR ARCHIVO: no se ha visto todavía un PDF real de este
// formato con más de un producto -- solo se valida que el número de cuenta
// completo (repetido en cada renglón) termine en cuentaUltimos4, igual que
// el formato "Detalle de Movimientos".
//
// AUTOVALIDACIÓN, más fuerte que los otros 2 formatos: cada renglón ya
// trae su saldo real, así que la cadena se valida directo entre renglones
// consecutivos (saldo[i] = saldo[i-1] +/- el monto clasificado, en orden
// ASCENDENTE -- este documento sí viene más antiguo primero) SIN depender
// de ningún saldo inicial declarado -- y el documento declara cantidad +
// suma tanto de depósitos como de retiros ("OPERACIONES: X Y" / "TOTAL: $X
// $Y"), a diferencia del formato mensual (que solo declara depósitos).
//
// Deliberadamente NO se valida contra "Final Mes Anterior" / "Inicial del
// día" declarados: confirmado con el PDF real que ambos quedan en
// $2,678.68 -- el mismo valor que "Saldo Actual" al FINAL del periodo, no
// el saldo antes de los movimientos (que la cadena interna sí reconstruye
// correcto, en $3,773.86) -- una etiqueta del propio banco que no describe
// lo que dice describir, mismo tipo de quirk ya visto en Santander "Saldo
// Inicial" y BBVA "Saldo disponible". La cadena de saldos (fuerte) y los
// totales de depósitos/retiros/Saldo Actual (fuertes) ya dan suficiente
// confianza sin depender de este campo.
const RE_ENCABEZADO_DETALLADO = "MOVIMIENTO DESCRIPCIÓN DETALLADA";
const RE_ANCLA_DETALLADO = /^(\d+) \d{2}\/\d{2}\/\d{4} (\d{2})\/(\d{2})\/(\d{4}) \d+ /gm;
const RE_MONTOS_MOVIMIENTO_DETALLADO = /(-|\$[\d,]+\.\d{2})\s+(-|\$[\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+(\d+)/;

interface TotalesDetallado {
  numeroDepositos: number | null;
  numeroRetiros: number | null;
  totalDepositos: number | null;
  totalRetiros: number | null;
  saldoActual: number | null;
}

function extraerTotalesDetallado(textoCompleto: string): TotalesDetallado {
  const mOperaciones = textoCompleto.match(/OPERACIONES:\s*(\d+)\s+(\d+)/i);
  const mTotal = textoCompleto.match(/TOTAL:\s*\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})/i);
  const mSaldoActual = textoCompleto.match(/Saldo Actual:\s*\$([\d,]+\.\d{2})/i);
  return {
    numeroDepositos: mOperaciones ? Number(mOperaciones[1]) : null,
    numeroRetiros: mOperaciones ? Number(mOperaciones[2]) : null,
    totalDepositos: mTotal ? aNumero(mTotal[1]) : null,
    totalRetiros: mTotal ? aNumero(mTotal[2]) : null,
    saldoActual: mSaldoActual ? aNumero(mSaldoActual[1]) : null,
  };
}

/** COD. TRANSAC (3 dígitos) + SUCURSAL (3-4 dígitos) son siempre los
 * últimos 2 números antes de los montos -- ver comentario de la sección. */
function limpiarDescripcionDetallado(texto: string): string {
  return texto
    .replace(/\s+\d{3}\s+\d{3,4}\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsearFormatoCuentaChequesDetallado(textoCompleto: string, cuentaUltimos4?: string): ResultadoParseoPdf {
  RE_ANCLA_DETALLADO.lastIndex = 0;
  const anclas = [...textoCompleto.matchAll(RE_ANCLA_DETALLADO)];
  if (anclas.length === 0) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se encontró ningún movimiento (cuenta + fecha + referencia) en la tabla del PDF" };
  }

  const numeroCuenta = anclas[0][1];
  if (cuentaUltimos4 && !numeroCuenta.endsWith(cuentaUltimos4)) {
    return {
      movimientos: [],
      erroresPorFila: [],
      errorDocumento: `El PDF es de la cuenta terminación ${numeroCuenta.slice(-4)}, no de la cuenta terminación ${cuentaUltimos4} seleccionada -- revisa que sea el PDF correcto.`,
    };
  }

  const movimientos: FilaEstadoCuentaMapeada[] = [];
  const erroresPorFila: { fila: number; errores: string[] }[] = [];

  for (let i = 0; i < anclas.length; i++) {
    const m = anclas[i];
    const inicio = m.index!;
    const fin = i + 1 < anclas.length ? anclas[i + 1].index! : textoCompleto.length;
    const bloque = textoCompleto.slice(inicio, fin);
    const filaNum = i + 1;

    const [, , dia, mes, anio] = m;
    if (Number(mes) < 1 || Number(mes) > 12) {
      erroresPorFila.push({ fila: filaNum, errores: [`Mes no reconocido en la fecha "${dia}/${mes}/${anio}"`] });
      continue;
    }

    const textoSinAncla = bloque.slice(m[0].length);
    const matchMontos = textoSinAncla.match(RE_MONTOS_MOVIMIENTO_DETALLADO);
    if (!matchMontos) {
      erroresPorFila.push({ fila: filaNum, errores: ["No se encontraron los montos de Depósitos/Retiros/Saldo/Movimiento en esta fila -- posible línea mal extraída"] });
      continue;
    }

    const [textoMontos, depositoTxt, retiroTxt, saldoTxt, folio] = matchMontos;
    if (depositoTxt !== "-" && retiroTxt !== "-") {
      erroresPorFila.push({ fila: filaNum, errores: [`La fila trae Depósito (${depositoTxt}) y Retiro (${retiroTxt}) a la vez -- posible columna mal identificada`] });
      continue;
    }
    const deposito = depositoTxt === "-" ? null : aNumero(depositoTxt.replace(/^\$/, ""));
    const retiro = retiroTxt === "-" ? null : aNumero(retiroTxt.replace(/^\$/, ""));
    if (deposito == null && retiro == null) {
      erroresPorFila.push({ fila: filaNum, errores: ["No se encontró ni Depósito ni Retiro para esta fila"] });
      continue;
    }
    const saldo = aNumero(saldoTxt);

    const idxMontos = textoSinAncla.indexOf(textoMontos);
    const descripcion = limpiarDescripcionDetallado(textoSinAncla.slice(0, idxMontos));
    // Lo que sigue a los montos es DESCRIPCIÓN DETALLADA (texto libre del
    // SPEI, o "-" si no aplica) + CHEQUE ("-" o un número) -- se pegan a la
    // descripción principal quitando los "-" de relleno de ambas columnas.
    // El ÚLTIMO movimiento del documento arrastra el resumen de pie de
    // página ("DEPÓSITOS RETIROS\nOPERACIONES:...\nTOTAL:...") porque no hay
    // otra ancla que lo delimite -- se recorta ahí si aparece, mismo
    // criterio que otros parsers de este proyecto con su pie de página.
    const restoCrudo = textoSinAncla.slice(idxMontos + textoMontos.length);
    const idxPie = restoCrudo.indexOf("DEPÓSITOS RETIROS");
    const detalle = (idxPie === -1 ? restoCrudo : restoCrudo.slice(0, idxPie))
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((t) => t !== "-")
      .join(" ")
      .trim();

    movimientos.push({
      fechaPago: `${anio}-${mes}-${dia}`,
      fechaOrden: null,
      folio,
      proyecto: null,
      nombreRazonSocial: [descripcion, detalle].filter(Boolean).join(" ") || null,
      cargoTotal: retiro,
      abonoTotal: deposito,
      saldo,
      referenciaTipo: null as ReferenciaTipo | null,
      referenciaNumero: null,
      factura: null,
      comentarios: null,
      observacion: "Extraído automáticamente de un PDF de Banorte (Cuentas de Cheques detallado)",
    });
  }

  // Autovalidación FUERTE #1: cadena de saldos en orden ascendente (ver
  // comentario de la sección).
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

  // Autovalidación FUERTE #2 y #3: cantidad + suma de depósitos/retiros, y
  // Saldo Actual, contra lo que el propio documento declara.
  const declarado = extraerTotalesDetallado(textoCompleto);
  const depositosExtraidos = movimientos.filter((mv) => mv.abonoTotal != null);
  const retirosExtraidos = movimientos.filter((mv) => mv.cargoTotal != null);
  const sumaDepositos = Math.round(depositosExtraidos.reduce((a, mv) => a + (mv.abonoTotal ?? 0), 0) * 100) / 100;
  const sumaRetiros = Math.round(retirosExtraidos.reduce((a, mv) => a + (mv.cargoTotal ?? 0), 0) * 100) / 100;

  if (declarado.numeroDepositos != null && declarado.totalDepositos != null) {
    if (depositosExtraidos.length !== declarado.numeroDepositos || Math.abs(sumaDepositos - declarado.totalDepositos) > 0.01) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `El PDF declara ${declarado.numeroDepositos} depósito(s) por $${declarado.totalDepositos} pero se extrajeron ${depositosExtraidos.length} por $${sumaDepositos} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
  }

  if (declarado.numeroRetiros != null && declarado.totalRetiros != null) {
    if (retirosExtraidos.length !== declarado.numeroRetiros || Math.abs(sumaRetiros - declarado.totalRetiros) > 0.01) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `El PDF declara ${declarado.numeroRetiros} retiro(s) por $${declarado.totalRetiros} pero se extrajeron ${retirosExtraidos.length} por $${sumaRetiros} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
  }

  if (declarado.saldoActual != null && movimientos.length > 0) {
    const ultimoSaldo = movimientos[movimientos.length - 1].saldo;
    if (Math.abs(ultimoSaldo - declarado.saldoActual) > 0.01) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `El PDF declara un Saldo Actual de ${declarado.saldoActual} pero el último movimiento extraído queda en ${ultimoSaldo} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
  }

  return { movimientos, erroresPorFila, errorDocumento: null };
}

/**
 * @param textoCompleto Texto de todas las páginas del PDF, concatenado (ver
 *   pdf-cargador.ts / pdfATexto).
 * @param cuentaUltimos4 Últimos 4 dígitos de la cuenta bancaria seleccionada
 *   en la carga (cuentas_bancarias.ultimos_4) -- se usa para elegir la tabla
 *   de movimientos correcta cuando el PDF trae más de un producto (formato
 *   1) o para confirmar que el PDF es de la cuenta correcta (formatos 2 y 3).
 */
export function parsearPdfEstadoCuentaBanorte(textoCompleto: string, cuentaUltimos4?: string): ResultadoParseoPdf {
  const esFormatoDetallado = textoCompleto.includes(RE_ENCABEZADO_DETALLADO);
  const esFormatoDetalle = textoCompleto.includes(RE_ENCABEZADO_DETALLE);
  const esFormatoMensual = textoCompleto.includes(RE_ENCABEZADO_TABLA);

  if (esFormatoDetallado) return parsearFormatoCuentaChequesDetallado(textoCompleto, cuentaUltimos4);
  if (esFormatoDetalle) return parsearFormatoDetalleMovimientos(textoCompleto, cuentaUltimos4);
  if (esFormatoMensual) return parsearFormatoEstadoCuentaMensual(textoCompleto, cuentaUltimos4);

  return {
    movimientos: [],
    erroresPorFila: [],
    errorDocumento: "No se encontró la tabla de movimientos (encabezado FECHA DESCRIPCIÓN / ESTABLECIMIENTO...) en el PDF",
  };
}
