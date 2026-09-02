// Parsea el estado de cuenta de BBVA en PDF, formato oficial "MAESTRA PYME
// BBVA" (confirmado por el usuario como el modelo general que va a subir --
// PDF_ACEROS_5859_JULIO_2026.pdf, cuenta BBVA 5859 de Aceros y Envasados de
// Puebla, julio 2026).
//
// Este formato es una TABLA real (columnas Cargos/Abonos/Saldo Operación/
// Saldo Liquidación), pero pdf.js aplana el texto en el orden del stream del
// PDF, no en el orden visual por columna -- un monto de $3,209.80 en la
// columna "Cargos" y uno de $25,998.35 en la columna "Abonos" son
// indistinguibles como texto plano. Por eso este parser usa pdfAPosiciones
// (ver pdf-cargador.ts) en vez de pdfATexto: cada monto se clasifica por su
// posición horizontal (x1, el borde DERECHO -- los montos están alineados a
// la derecha, así que x1 es constante por columna sin importar cuántos
// dígitos tenga el número, a diferencia de x0), así que NO hace falta
// inferir cargo/abono por delta de saldo (a diferencia de BanBajío y del
// formato BBVA anterior) -- el documento ya lo dice directamente por
// columna, lo cual es más confiable que adivinar por delta.
//
// POSICIONES DINÁMICAS POR DOCUMENTO: la primera versión de este parser
// usaba constantes fijas de x1 (Cargos≈407.9, Abonos≈468.9, etc.),
// confirmadas contra UN solo PDF real (Aceros, cuenta 5859). Al probar un
// segundo PDF real de otra cuenta (Mario Contreras, cuenta 2047) se
// descubrió que esas posiciones NO son constantes entre cuentas/documentos
// -- en ese archivo Cargos cae en x1≈416 (no 407.9) y hasta varía unos
// puntos entre páginas del MISMO documento. Lo que SÍ es estable es que el
// propio PDF imprime el encabezado de columna ("CARGOS ABONOS OPERACIÓN
// LIQUIDACIÓN") en cada página de movimientos, con esos labels alineados
// (mismo x1 que los montos, ±unos puntos) -- así que las posiciones se leen
// del encabezado real de CADA documento (extraerAnclasColumnas) en vez de
// asumir constantes globales, y la tolerancia se ensancha lo suficiente
// para absorber el corrimiento de unos puntos entre el label y los montos
// sin poner en riesgo confundir columnas distintas (que están separadas por
// ~50-60pt entre sí).
//
// SALDO POR MOVIMIENTO: a diferencia de Cargos/Abonos, la columna Saldo
// Operación NO aparece en cada línea de movimiento -- el PDF real solo la
// imprime en la ÚLTIMA fila de cada día (un saldo de corte diario), dejando
// vacías las filas intermedias de ese mismo día. Como public.movimientos.
// saldo es NOT NULL (y SPEC.md sección 2 lo exige: "saldo real... tras el
// movimiento"), no basta con leer la columna cuando está presente -- para
// las filas intermedias se calcula acumulando Abonos/Cargos a partir de
// "Saldo de Operación Inicial" (resumen de la página 1), en el mismo orden
// en que aparecen los movimientos en el documento. Donde el PDF SÍ imprime
// un saldo de corte, ese valor declarado se usa tal cual (es el dato real
// del banco, corrige cualquier arrastre de redondeo) Y sirve de
// autovalidación: si no coincide con lo acumulado hasta ahí, algo se
// clasificó o se perdió antes de ese punto -- se bloquea todo el documento
// (mismo criterio que "Saldo Total" en BanBajío), porque a diferencia de un
// movimiento faltante (ver más abajo, no bloquea), un saldo mal calculado
// contaminaría el campo saldo de TODOS los movimientos ya insertados.
//
// AUTOVALIDACIÓN: el documento declara sus propios totales ("TOTAL IMPORTE
// CARGOS", "TOTAL MOVIMIENTOS CARGOS", "TOTAL IMPORTE ABONOS", "TOTAL
// MOVIMIENTOS ABONOS"). Contra el PDF real (139 movimientos: 116 cargos por
// $1,260,239.17 + 23 abonos por $902,140.22) cuadran exactamente -- pero se
// dejó la comparación explícita en vez de confiar ciegamente en la
// extracción, por el mismo motivo que BanBajío:
//   - Si lo extraído es MÁS de lo declarado (en cantidad o en suma), algo se
//     clasificó mal -- se bloquea todo el documento (errorDocumento).
//   - Si lo extraído es MENOS (subconjunto limpio), no se bloquea todo el
//     documento -- se insertan los movimientos que sí se pudieron leer con
//     confianza (clasificados por columna, no adivinados) y se agrega una
//     advertencia de fila 0 (documento completo) pidiendo captura manual del
//     faltante. Nota de depuración: al prototipar esto se detectó que
//     pdf.js/unpdf puede "perder" un par de montos si la extracción de texto
//     arranca en una página intermedia en vez de la página 1 del documento
//     (aparente efecto de orden de carga de fuentes) -- por eso
//     pdfAPosiciones (pdf-cargador.ts) SIEMPRE extrae desde la página 1,
//     aunque el parser solo use del resumen esa página. Este camino de
//     "subconjunto limpio" queda como red de seguridad para un PDF real
//     futuro que sí tenga una limitación genuina, no porque se haya
//     confirmado en este archivo.
//
// SEGUNDO FORMATO DE BBVA -- "Detalle de movimientos" (banca en línea):
// además del PDF oficial MAESTRA PYME de arriba, BBVA también genera un PDF
// distinto cuando alguien lo imprime/descarga desde el portal en línea
// ("Cerrar Imprimir" al final del documento) -- confirmado contra un
// archivo real (ESTADO_DE_CUENTA_AL_20_DE_AGOSTO.pdf, cuenta BBVA 5859 de
// Aceros y Envasados de Puebla, agosto 2026). Ambos formatos comparten el
// banco ("BBVA" en cuentas_bancarias), así que `parsearPaginasBBVA` intenta
// ubicar las anclas de columna de CADA formato y usa el que encuentre --
// nunca adivina el layout por el nombre del archivo.
//
// Diferencias clave de este segundo formato:
//   - Encabezado de columnas: "Fecha Concepto / Referencia Cargo Abono
//     Saldo" (3 columnas de monto, no 4) -- también hay que leer x1 del
//     propio documento (extraerAnclasColumnasWeb), mismo motivo que arriba.
//   - Fecha SIN año: "DD-MM" (ej. "20-08"), no "DD/MES". El año se toma de
//     la fecha de generación del documento en la página 1 (ej.
//     "20/08/2026"), válido porque el propio documento se limita a "Mes
//     actual" -- no cruza años.
//   - Saldo SÍ se imprime en TODAS las filas (a diferencia de MAESTRA PYME,
//     que solo lo imprime en la última fila de cada día) -- no hace falta
//     acumular Cargos/Abonos para rellenar filas intermedias, cada
//     movimiento ya trae su propio saldo real declarado por el banco.
//   - Los movimientos vienen en orden MÁS RECIENTE PRIMERO (descendente),
//     al revés que MAESTRA PYME.
//   - No hay tabla de "TOTAL IMPORTE CARGOS/ABONOS" para autovalidar contra
//     un total declarado -- en su lugar se usa: (a) "Saldo disponible: $X"
//     de la página 1, que debe coincidar con el saldo del movimiento más
//     reciente, y (b) consistencia interna entre saldos consecutivos ya
//     impresos (saldo[i] debe ser saldo[i-1] +/- el monto clasificado por
//     columna en la fila i) -- si algo no cuadra, se bloquea todo el
//     documento, mismo criterio de "no confiar" que el resto de los
//     parsers.

import type { ResultadoParseoPdf } from "./pdf-estado-cuenta.ts";
import type { FilaEstadoCuentaMapeada } from "./estado-cuenta.ts";
import type { ReferenciaTipo } from "../motor/types.ts";
import type { ItemPdfPosicionado } from "./pdf-tipos.ts";

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

// Prefijo, no match exacto -- ver comentario en el bucle principal sobre
// por qué la fecha puede venir fusionada con el inicio de la descripción
// en el mismo item de texto.
const RE_FECHA_PREFIJO = /^(\d{1,2})\/([A-ZÑ]{3})\b/;
const RE_FECHA_GLOBAL = /\b\d{1,2}\/[A-ZÑ]{3}\b/g;
const RE_MONTO = /^-?[\d,]+\.\d{2}$/;
const RE_CODIGO_AL_INICIO = /^[A-Z]\d{2}\s+/;

// Tolerancia entre la posición del label de encabezado y la posición real
// de los montos de esa columna -- ver comentario del encabezado (se
// observó hasta ~8pt de corrimiento en Cargos en un PDF real). Los huecos
// entre columnas son de ~50-60pt, así que esto no arriesga confundir
// columnas distintas.
const TOLERANCIA_X = 15;

function aNumero(texto: string): number {
  return Number(texto.replace(/,/g, ""));
}

function extraerAnio(paginaUno: ItemPdfPosicionado[]): number | null {
  const texto = paginaUno.map((i) => i.texto).join(" ");
  const m = texto.match(/DEL\s+\d{2}\/\d{2}\/(\d{4})\s+AL/) ?? texto.match(/Fecha de Corte\s+\d{2}\/\d{2}\/(\d{4})/);
  return m ? Number(m[1]) : null;
}

interface TotalDeclarado {
  cantidadCargos: number | null;
  sumaCargos: number | null;
  cantidadAbonos: number | null;
  sumaAbonos: number | null;
}

function extraerTotalesDeclarados(paginas: ItemPdfPosicionado[][]): TotalDeclarado {
  const texto = paginas.map((p) => p.map((i) => i.texto).join(" ")).join(" ");
  const mCantCargos = texto.match(/TOTAL MOVIMIENTOS CARGOS\s+(\d+)/i);
  const mSumaCargos = texto.match(/TOTAL IMPORTE CARGOS\s+([\d,]+\.\d{2})/i);
  const mCantAbonos = texto.match(/TOTAL MOVIMIENTOS ABONOS\s+(\d+)/i);
  const mSumaAbonos = texto.match(/TOTAL IMPORTE ABONOS\s+([\d,]+\.\d{2})/i);
  return {
    cantidadCargos: mCantCargos ? Number(mCantCargos[1]) : null,
    sumaCargos: mSumaCargos ? aNumero(mSumaCargos[1]) : null,
    cantidadAbonos: mCantAbonos ? Number(mCantAbonos[1]) : null,
    sumaAbonos: mSumaAbonos ? aNumero(mSumaAbonos[1]) : null,
  };
}

/** "Saldo de Operación Inicial"/"Saldo de Operación Final" del resumen de la
 * página 1 -- ancla y cierre para el cálculo de saldo acumulado por
 * movimiento (ver comentario del encabezado). Se usa "Operación", no
 * "Liquidación", por la misma razón que la columna por movimiento.
 *
 * No todas las cuentas BBVA imprimen esas etiquetas exactas -- confirmado
 * contra un segundo PDF real (Mario Contreras, cuenta 2047) que en vez de
 * eso usa "Saldo Anterior" / "Saldo Final (+)" en el mismo resumen
 * "Comportamiento" (mismo valor, el saldo antes/después del periodo
 * completo -- confirmado que coinciden con "Saldo de Operación
 * Inicial/Final" en el PDF de Aceros, donde el documento trae AMBAS
 * etiquetas). Se intenta primero la etiqueta "de Operación" (más precisa,
 * evita cualquier ambigüedad con Liquidación) y se cae a la genérica solo
 * si la primera no aparece. */
function extraerSaldosResumen(paginas: ItemPdfPosicionado[][]): { saldoInicial: number | null; saldoFinal: number | null } {
  const texto = paginas.map((p) => p.map((i) => i.texto).join(" ")).join(" ");
  const mInicial =
    texto.match(/Saldo de Operaci[oó]n Inicial\s+([\d,]+\.\d{2})/i) ?? texto.match(/Saldo Anterior\s+([\d,]+\.\d{2})/i);
  const mFinal =
    texto.match(/Saldo de Operaci[oó]n Final\s+([\d,]+\.\d{2})/i) ?? texto.match(/Saldo Final\s*\(\+\)\s+([\d,]+\.\d{2})/i);
  return {
    saldoInicial: mInicial ? aNumero(mInicial[1]) : null,
    saldoFinal: mFinal ? aNumero(mFinal[1]) : null,
  };
}

interface AnclasColumnas {
  cargo: number;
  abono: number;
  saldoOperacion: number;
}

/** Lee del propio PDF dónde caen (x1) las columnas Cargos/Abonos/Operación
 * de ESE documento en particular -- ver comentario del encabezado para por
 * qué no se puede usar una constante fija entre documentos. Busca una fila
 * (mismo y redondeado) que traiga los 4 labels de encabezado juntos, para
 * no confundirla con la tabla de "Otros productos (inversiones)" del
 * resumen, que reusa palabras parecidas ("OPERACION"/"LIQUIDACION", sin
 * acento, en posiciones totalmente distintas) para una tabla más angosta. */
function extraerAnclasColumnas(paginas: ItemPdfPosicionado[][]): AnclasColumnas | null {
  for (const itemsPagina of paginas) {
    const porFila = new Map<number, ItemPdfPosicionado[]>();
    for (const item of itemsPagina) {
      const clave = Math.round(item.y * 10) / 10;
      const lista = porFila.get(clave);
      if (lista) lista.push(item);
      else porFila.set(clave, [item]);
    }
    for (const itemsFila of porFila.values()) {
      const cargo = itemsFila.find((i) => i.texto === "CARGOS");
      const abono = itemsFila.find((i) => i.texto === "ABONOS");
      const saldoOp = itemsFila.find((i) => i.texto === "OPERACIÓN");
      const saldoLiq = itemsFila.find((i) => i.texto === "LIQUIDACIÓN");
      if (cargo && abono && saldoOp && saldoLiq) {
        return { cargo: cargo.x1, abono: abono.x1, saldoOperacion: saldoOp.x1 };
      }
    }
  }
  return null;
}

/** Lógica pura de parseo, ya con los items posicionados en mano -- separada
 * de la extracción (pdfAPosiciones, que hace IO) para poder probarla con un
 * fixture de datos reales sin tener que re-parsear el PDF en cada test.
 *
 * Intenta ubicar las anclas de columna de cada formato de BBVA conocido (ver
 * comentario del encabezado) y usa el que encuentre -- nunca adivina el
 * layout por el nombre del archivo ni por cuál banco es. */
export function parsearPaginasBBVA(paginas: ItemPdfPosicionado[][]): ResultadoParseoPdf {
  if (paginas.length === 0 || paginas.every((p) => p.length === 0)) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "El PDF no tiene contenido de texto extraíble" };
  }

  const anclasMaestraPyme = extraerAnclasColumnas(paginas);
  if (anclasMaestraPyme) {
    return parsearComoMaestraPyme(paginas, anclasMaestraPyme);
  }

  const anclasWeb = extraerAnclasColumnasWeb(paginas);
  if (anclasWeb) {
    return parsearComoWeb(paginas, anclasWeb);
  }

  if (esFormatoApp(paginas)) {
    return parsearComoApp(paginas);
  }

  // Ninguno de los formatos conocidos -- el diagnóstico más útil casi
  // siempre es que ni siquiera se pudo leer el periodo/año (mismo texto de
  // error que antes de que existiera el segundo/tercer formato).
  const anio = extraerAnio(paginas[0] ?? []);
  if (!anio) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se pudo determinar el año del periodo en el PDF" };
  }
  return {
    movimientos: [],
    erroresPorFila: [],
    errorDocumento:
      "No se pudo ubicar el encabezado de columnas de ningún formato de BBVA conocido (ni CARGOS/ABONOS/OPERACIÓN/LIQUIDACIÓN del PDF oficial, ni Fecha/Cargo/Abono/Saldo de banca en línea, ni FECHA/DESCRIPCIÓN/ABONO/CARGO/SALDO del formato app) en el documento",
  };
}

function parsearComoMaestraPyme(paginas: ItemPdfPosicionado[][], anclas: AnclasColumnas): ResultadoParseoPdf {
  const anio = extraerAnio(paginas[0] ?? []);
  if (!anio) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se pudo determinar el año del periodo en el PDF" };
  }

  const movimientos: FilaEstadoCuentaMapeada[] = [];
  // Checkpoint de saldo declarado por el banco para el movimiento en la
  // misma posición de `movimientos` (null cuando esa fila no trae columna
  // de saldo -- ver comentario del encabezado). Se usa después del bucle
  // para anclar/autovalidar el saldo acumulado.
  const checkpoints: (number | null)[] = [];
  const erroresPorFila: { fila: number; errores: string[] }[] = [];
  let filaNum = 0;

  for (const itemsPagina of paginas) {
    const porFila = new Map<number, ItemPdfPosicionado[]>();
    for (const item of itemsPagina) {
      const clave = Math.round(item.y * 10) / 10;
      const lista = porFila.get(clave);
      if (lista) lista.push(item);
      else porFila.set(clave, [item]);
    }
    // De arriba hacia abajo de la página (y descendente en el sistema de
    // pdf.js, que tiene el origen abajo-izquierda).
    const filasOrdenadas = [...porFila.entries()].sort((a, b) => b[0] - a[0]);

    for (const [, itemsFilaSinOrden] of filasOrdenadas) {
      // Ordenados de izquierda a derecha -- necesario porque pdf.js no
      // siempre parte la fecha OPER, la fecha LIQ y la descripción en items
      // separados (ver comentario del encabezado): en un PDF real la fecha
      // LIQ vino fusionada con el inicio de la descripción en un solo item
      // ("01/JUL PAGO CUENTA DE TERCERO"). Por eso la fecha del movimiento
      // se busca por PREFIJO (no por posición x0 exacta) en el item más a
      // la izquierda que empiece con un patrón de fecha, y la descripción
      // se arma con TODO el texto de la fila que no sea un monto, quitando
      // después cualquier fecha que haya quedado embebida.
      const itemsFila = [...itemsFilaSinOrden].sort((a, b) => a.x0 - b.x0);
      const itemFecha = itemsFila.find((i) => RE_FECHA_PREFIJO.test(i.texto));
      if (!itemFecha) continue; // no es una fila de movimiento (encabezado, metadata, etc.)
      filaNum++;

      const m = itemFecha.texto.match(RE_FECHA_PREFIJO)!;
      const mes = MESES[m[2]];
      if (!mes) {
        erroresPorFila.push({ fila: filaNum, errores: [`Mes no reconocido: "${itemFecha.texto}"`] });
        continue;
      }

      const itemCargo = itemsFila.find((i) => RE_MONTO.test(i.texto) && Math.abs(i.x1 - anclas.cargo) < TOLERANCIA_X);
      const itemAbono = itemsFila.find((i) => RE_MONTO.test(i.texto) && Math.abs(i.x1 - anclas.abono) < TOLERANCIA_X);
      const itemSaldo = itemsFila.find((i) => RE_MONTO.test(i.texto) && Math.abs(i.x1 - anclas.saldoOperacion) < TOLERANCIA_X);

      if (itemCargo && itemAbono) {
        erroresPorFila.push({
          fila: filaNum,
          errores: [`La fila trae un monto en Cargos (${itemCargo.texto}) Y en Abonos (${itemAbono.texto}) a la vez -- posible columna mal identificada`],
        });
        continue;
      }
      if (!itemCargo && !itemAbono) {
        erroresPorFila.push({ fila: filaNum, errores: [`No se encontró un monto de Cargo ni de Abono para la fecha ${itemFecha.texto}`] });
        continue;
      }

      const descripcion = itemsFila
        .filter((i) => !RE_MONTO.test(i.texto))
        .map((i) => i.texto)
        .join(" ")
        .replace(RE_FECHA_GLOBAL, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(RE_CODIGO_AL_INICIO, "")
        .trim();

      movimientos.push({
        fechaPago: `${anio}-${String(mes).padStart(2, "0")}-${m[1].padStart(2, "0")}`,
        fechaOrden: null,
        folio: null,
        proyecto: null,
        nombreRazonSocial: descripcion || null,
        cargoTotal: itemCargo ? aNumero(itemCargo.texto) : null,
        abonoTotal: itemAbono ? aNumero(itemAbono.texto) : null,
        saldo: 0, // placeholder -- se calcula/ancla después del bucle, ver más abajo
        referenciaTipo: null as ReferenciaTipo | null,
        referenciaNumero: null,
        factura: null,
        comentarios: null,
        observacion: 'Extraído automáticamente de un PDF de BBVA (formato "MAESTRA PYME BBVA")',
      });
      checkpoints.push(itemSaldo ? aNumero(itemSaldo.texto) : null);
    }
  }

  // Calcula el saldo acumulado por movimiento (ver comentario del
  // encabezado) y lo autovalida contra los saldos de corte que el propio
  // documento imprime -- si no cuadra, algo se clasificó o se perdió antes
  // de ese punto y no se puede confiar en el saldo de ningún movimiento ya
  // acumulado, así que se bloquea todo el documento.
  const { saldoInicial, saldoFinal } = extraerSaldosResumen(paginas);
  if (saldoInicial == null) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: 'No se pudo leer el "Saldo de Operación Inicial" declarado en el PDF' };
  }

  try {
    let saldoAcumulado = saldoInicial;
    for (let i = 0; i < movimientos.length; i++) {
      const mov = movimientos[i];
      saldoAcumulado = Math.round((saldoAcumulado + (mov.abonoTotal ?? 0) - (mov.cargoTotal ?? 0)) * 100) / 100;

      const declarado = checkpoints[i];
      if (declarado != null) {
        if (Math.abs(saldoAcumulado - declarado) > 0.01) {
          throw new Error(
            `El saldo acumulado hasta el movimiento del ${mov.fechaPago} (${saldoAcumulado}) no cuadra con el saldo de corte que declara el PDF (${declarado}) -- algo se clasificó o se perdió antes de este punto`,
          );
        }
        saldoAcumulado = declarado; // ancla al valor real del banco, corrige arrastre de redondeo
      }
      mov.saldo = saldoAcumulado;
    }

    if (saldoFinal != null && movimientos.length > 0 && Math.abs(saldoAcumulado - saldoFinal) > 0.01) {
      throw new Error(
        `El PDF declara un Saldo de Operación Final de ${saldoFinal} pero el saldo acumulado de los movimientos extraídos termina en ${saldoAcumulado} -- no se insertó nada, revisa el archivo manualmente`,
      );
    }
  } catch (e) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: (e as Error).message };
  }

  // Autovalidación contra los totales que el propio documento declara.
  const declarado = extraerTotalesDeclarados(paginas);
  const cargosExtraidos = movimientos.filter((m) => m.cargoTotal != null);
  const abonosExtraidos = movimientos.filter((m) => m.abonoTotal != null);
  const sumaCargosExtraidos = Math.round(cargosExtraidos.reduce((a, m) => a + (m.cargoTotal ?? 0), 0) * 100) / 100;
  const sumaAbonosExtraidos = Math.round(abonosExtraidos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;

  function validarColumna(nombre: string, cantidadExtraida: number, sumaExtraida: number, cantidadDeclarada: number | null, sumaDeclarada: number | null): string | null {
    if (cantidadDeclarada == null || sumaDeclarada == null) return null; // no se pudo leer el total -- no se puede validar, se deja pasar
    if (cantidadExtraida > cantidadDeclarada || sumaExtraida > sumaDeclarada + 0.01) {
      throw new Error(
        `El PDF declara ${cantidadDeclarada} movimiento(s) de ${nombre} por $${sumaDeclarada} pero se extrajeron ${cantidadExtraida} por $${sumaExtraida} -- MÁS de lo declarado, algo se clasificó mal`,
      );
    }
    if (cantidadExtraida < cantidadDeclarada || Math.abs(sumaExtraida - sumaDeclarada) > 0.01) {
      const faltante = Math.round((sumaDeclarada - sumaExtraida) * 100) / 100;
      return `El PDF declara ${cantidadDeclarada} movimiento(s) de ${nombre} por $${sumaDeclarada} pero solo se pudieron extraer ${cantidadExtraida} por $${sumaExtraida} como texto -- ${cantidadDeclarada - cantidadExtraida} movimiento(s) por $${faltante} no se pudieron leer (limitación de extracción de texto del PDF, no de este parser) y deben capturarse manualmente.`;
    }
    return null;
  }

  try {
    const advertenciaCargos = validarColumna("Cargos", cargosExtraidos.length, sumaCargosExtraidos, declarado.cantidadCargos, declarado.sumaCargos);
    const advertenciaAbonos = validarColumna("Abonos", abonosExtraidos.length, sumaAbonosExtraidos, declarado.cantidadAbonos, declarado.sumaAbonos);
    const advertencias = [advertenciaCargos, advertenciaAbonos].filter((a): a is string => a !== null);
    if (advertencias.length > 0) {
      erroresPorFila.unshift({ fila: 0, errores: advertencias });
    }
  } catch (e) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: (e as Error).message };
  }

  return { movimientos, erroresPorFila, errorDocumento: null };
}

// ── Segundo formato: "Detalle de movimientos" (banca en línea) ───────────
// Ver comentario del encabezado del archivo para el contraste completo con
// MAESTRA PYME.

interface AnclasColumnasWeb {
  cargo: number;
  abono: number;
  saldo: number;
}

/** Igual idea que extraerAnclasColumnas (MAESTRA PYME) pero para las
 * etiquetas de este formato ("Fecha Concepto / Referencia Cargo Abono
 * Saldo") -- ese encabezado solo se imprime en la página 1, así que se
 * busca en todas las páginas y se usa el primero que aparezca; las
 * posiciones son las mismas en las páginas siguientes porque es la misma
 * tabla continuando. */
function extraerAnclasColumnasWeb(paginas: ItemPdfPosicionado[][]): AnclasColumnasWeb | null {
  for (const itemsPagina of paginas) {
    const porFila = new Map<number, ItemPdfPosicionado[]>();
    for (const item of itemsPagina) {
      const clave = Math.round(item.y * 10) / 10;
      const lista = porFila.get(clave);
      if (lista) lista.push(item);
      else porFila.set(clave, [item]);
    }
    for (const itemsFila of porFila.values()) {
      const fecha = itemsFila.find((i) => i.texto === "Fecha");
      const cargo = itemsFila.find((i) => i.texto === "Cargo");
      const abono = itemsFila.find((i) => i.texto === "Abono");
      const saldo = itemsFila.find((i) => i.texto === "Saldo");
      if (fecha && cargo && abono && saldo) {
        return { cargo: cargo.x1, abono: abono.x1, saldo: saldo.x1 };
      }
    }
  }
  return null;
}

const RE_FECHA_CORTA_WEB = /^(\d{2})-(\d{2})$/;
// Si el primer movimiento queda pegado al encabezado de la tabla (ver
// comentario del bucle principal sobre el desplazamiento de una fila hacia
// atrás), esto evita que "Fecha"/"Concepto / Referencia" se cuelen en la
// descripción del primer movimiento.
const ETIQUETAS_ENCABEZADO_WEB = new Set(["Fecha", "Concepto / Referencia", "Cargo", "Abono", "Saldo"]);
// Los montos vienen como "$ 15,759.70" (con signo de pesos y espacio) en
// vez de un número plano como en MAESTRA PYME.
const RE_MONTO_WEB = /^\$\s*[\d,]+\.\d{2}$/;

function aNumeroWeb(texto: string): number {
  return Number(texto.replace(/[^0-9.]/g, ""));
}

/** El documento no trae "DEL...AL" ni "Fecha de Corte" -- el año se toma de
 * la fecha de generación en la página 1 (ej. "20/08/2026 - 1:42:33 PM"),
 * válido porque el documento se limita a "Mes actual" (no cruza años). */
function extraerAnioWeb(paginaUno: ItemPdfPosicionado[]): number | null {
  const texto = paginaUno.map((i) => i.texto).join(" ");
  const m = texto.match(/\b\d{2}\/\d{2}\/(\d{4})\b/);
  return m ? Number(m[1]) : null;
}

function extraerSaldoDisponible(paginas: ItemPdfPosicionado[][]): number | null {
  const texto = paginas.map((p) => p.map((i) => i.texto).join(" ")).join(" ");
  const m = texto.match(/Saldo disponible:\s*\$?\s*([\d,]+\.\d{2})/i);
  return m ? aNumeroWeb(m[1]) : null;
}

function parsearComoWeb(paginas: ItemPdfPosicionado[][], anclas: AnclasColumnasWeb): ResultadoParseoPdf {
  const anio = extraerAnioWeb(paginas[0] ?? []);
  if (!anio) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se pudo determinar el año del periodo en el PDF" };
  }

  // Aplana todas las filas (agrupadas por y real, no por orden de stream --
  // ver comentario del encabezado) de todas las páginas, en orden visual:
  // página tras página, de arriba hacia abajo dentro de cada una.
  const filas: ItemPdfPosicionado[][] = [];
  for (const itemsPagina of paginas) {
    const porFila = new Map<number, ItemPdfPosicionado[]>();
    for (const item of itemsPagina) {
      const clave = Math.round(item.y * 10) / 10;
      const lista = porFila.get(clave);
      if (lista) lista.push(item);
      else porFila.set(clave, [item]);
    }
    const filasOrdenadas = [...porFila.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => [...items].sort((a, b) => a.x0 - b.x0));
    filas.push(...filasOrdenadas);
  }

  // Cada movimiento ocupa varias filas reales (línea de concepto, línea de
  // fecha+montos, línea de RFC/detalle) -- se ancla por la fila que trae la
  // fecha corta "DD-MM" y se agrupa todo hasta la siguiente fecha ancla,
  // mismo truco que Banorte/Santander pero con filas ya agrupadas por
  // posición en vez de texto plano.
  const indicesAncla: number[] = [];
  for (let i = 0; i < filas.length; i++) {
    if (filas[i].some((it) => RE_FECHA_CORTA_WEB.test(it.texto))) indicesAncla.push(i);
  }
  if (indicesAncla.length === 0) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se encontró ningún movimiento (fecha DD-MM) en la tabla del PDF" };
  }

  const movimientos: FilaEstadoCuentaMapeada[] = [];
  const erroresPorFila: { fila: number; errores: string[] }[] = [];

  // El layout NO es uniforme: la mayoría de los movimientos traen su
  // "concepto" (ej. "PAGO CUENTA DE TERCERO/ 0094186039") en la fila justo
  // ANTES de su fecha ancla, más una fila de detalle/RFC después -- pero
  // movimientos con descripción corta (ej. comisiones "IVA COM SERV BCA
  // INTERNET") vienen COMPLETOS en una sola fila junto con la fecha, sin
  // fila de concepto separada ni de detalle. NO se puede distinguir por la
  // distancia (en filas) a la fecha ancla vecina -- se probó y falla: la
  // fila de detalle de UN movimiento (ej. "0060826PAGO ERGODINOVA") puede
  // quedar a solo 1 fila de la fecha ancla del SIGUIENTE movimiento aunque
  // ese siguiente movimiento sea compacto y no la necesite, robándole esa
  // fila al movimiento anterior. En vez de eso, se revisa el CONTENIDO de la
  // propia fila ancla: si ya trae texto de descripción además de la fecha y
  // los montos, es compacta (no necesita fila prestada de ningún lado); si
  // no, sí necesita una fila de concepto antes.
  const esCompacta = (idx: number): boolean =>
    filas[idx].some((it) => !RE_FECHA_CORTA_WEB.test(it.texto) && !RE_MONTO_WEB.test(it.texto) && !ETIQUETAS_ENCABEZADO_WEB.has(it.texto));

  for (let a = 0; a < indicesAncla.length; a++) {
    const inicioBloque = esCompacta(indicesAncla[a])
      ? indicesAncla[a]
      : Math.max(a > 0 ? indicesAncla[a - 1] + 1 : 0, indicesAncla[a] - 1);
    const finBloqueCrudo =
      a + 1 >= indicesAncla.length
        ? filas.length
        : esCompacta(indicesAncla[a + 1])
          ? indicesAncla[a + 1]
          : indicesAncla[a + 1] - 1;
    // El ÚLTIMO movimiento del documento se extiende hasta el final de la
    // página, arrastrando el aviso legal de pie de página ("En cumplimiento
    // a la Ley...", "Cerrar", "Imprimir") a su descripción -- se recorta ahí
    // si aparece, mismo criterio que Santander recortando su línea "TOTAL".
    const idxAvisoLegal = filas.slice(inicioBloque, finBloqueCrudo).findIndex((fila) => fila.some((it) => it.texto.startsWith("En cumplimiento")));
    const finBloque = idxAvisoLegal === -1 ? finBloqueCrudo : inicioBloque + idxAvisoLegal;
    const bloque = filas.slice(inicioBloque, finBloque).flat();
    const filaNum = a + 1;

    const itemFecha = bloque.find((it) => RE_FECHA_CORTA_WEB.test(it.texto))!;
    const [, dia, mes] = itemFecha.texto.match(RE_FECHA_CORTA_WEB)!;
    if (Number(mes) < 1 || Number(mes) > 12) {
      erroresPorFila.push({ fila: filaNum, errores: [`Mes no reconocido: "${itemFecha.texto}"`] });
      continue;
    }

    // El Saldo es siempre la columna MÁS A LA DERECHA de las dos que trae
    // cada movimiento (el monto de Cargo/Abono + el Saldo -- nunca los tres
    // juntos, Cargo y Abono son mutuamente excluyentes) -- se identifica por
    // posición RELATIVA entre los montos de la fila, no por tolerancia fija
    // contra el x1 del label "Saldo" del encabezado. Confirmado con un PDF
    // real (Aceros, cuenta 1226) donde un saldo de 7 cifras ($1,805,436.58)
    // cae ~16pt a la derecha del label -- más que TOLERANCIA_X (15) -- así
    // que la tolerancia fija fallaba en encontrar el Saldo justo en las
    // filas con saldos más grandes/anchos. El monto restante (Cargo o
    // Abono) sí se sigue clasificando contra las anclas de columna: ahí solo
    // hay que decidir entre dos opciones, así que "más cercano a cuál" es
    // robusto sin importar qué tan ancho sea el número.
    const itemsMonto = bloque.filter((i) => RE_MONTO_WEB.test(i.texto)).sort((a, b) => a.x1 - b.x1);
    if (itemsMonto.length !== 2) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `Se esperaban 2 montos (Cargo/Abono + Saldo) para el movimiento del ${itemFecha.texto} y se encontraron ${itemsMonto.length} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
    const [itemMovimiento, itemSaldo] = itemsMonto;
    const masCercaDeCargo = Math.abs(itemMovimiento.x1 - anclas.cargo) <= Math.abs(itemMovimiento.x1 - anclas.abono);
    const itemCargo = masCercaDeCargo ? itemMovimiento : undefined;
    const itemAbono = masCercaDeCargo ? undefined : itemMovimiento;

    const descripcion = bloque
      .filter((i) => i !== itemFecha && !RE_MONTO_WEB.test(i.texto) && !ETIQUETAS_ENCABEZADO_WEB.has(i.texto))
      .map((i) => i.texto)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    movimientos.push({
      fechaPago: `${anio}-${mes}-${dia}`,
      fechaOrden: null,
      folio: null,
      proyecto: null,
      nombreRazonSocial: descripcion || null,
      cargoTotal: itemCargo ? aNumeroWeb(itemCargo.texto) : null,
      abonoTotal: itemAbono ? aNumeroWeb(itemAbono.texto) : null,
      saldo: aNumeroWeb(itemSaldo.texto),
      referenciaTipo: null as ReferenciaTipo | null,
      referenciaNumero: null,
      factura: null,
      comentarios: null,
      observacion: 'Extraído automáticamente de un PDF de BBVA (formato "Detalle de movimientos" de banca en línea)',
    });
  }

  // Autovalidación: el documento no declara totales de Cargos/Abonos como
  // MAESTRA PYME (ver comentario del encabezado), así que la confianza viene
  // de la cadena de saldos + "Saldo disponible" -- ver validarCadenaYSaldoDisponible.
  const errorCadena = validarCadenaYSaldoDisponible(movimientos, extraerSaldoDisponible(paginas), erroresPorFila);
  if (errorCadena) return { movimientos: [], erroresPorFila: [], errorDocumento: errorCadena };

  return { movimientos, erroresPorFila, errorDocumento: null };
}

/** Compartida entre los formatos de BBVA que traen los movimientos ya en
 * orden MÁS RECIENTE PRIMERO con su propio saldo real impreso por fila
 * ("Detalle de movimientos" web y el formato app/personal, ver comentario
 * del encabezado de cada uno) -- ambos se autovalidan igual:
 *
 * 1. FUERTE (bloquea todo el documento si falla): en orden cronológico,
 *    cada saldo debe cuadrar exactamente con el saldo anterior +/- el monto
 *    clasificado por columna. Si algo no cuadra, la clasificación de esa
 *    fila (o de alguna entre medio) es sospechosa y no se puede confiar en
 *    el lote completo.
 * 2. SUAVE (advertencia de fila 0, no bloquea): el primero de la lista
 *    (el más reciente) debería cuadrar con "Saldo disponible" que declara
 *    la página 1 -- pero "Saldo disponible" es el saldo DISPONIBLE del
 *    banco, no necesariamente el saldo CONTABLE del último movimiento --
 *    confirmado con un PDF real (Aceros, cuenta 5859, 31-ago-2026) donde el
 *    saldo disponible declarado ($23,845.14) coincidía con el PENÚLTIMO
 *    movimiento, no con el último (una nómina del mismo día, $14,775.00),
 *    aun cuando la cadena de saldos de TODO el documento (la validación
 *    fuerte de arriba) encadenaba perfecto sin un solo hueco -- o sea, la
 *    extracción era correcta y el desfase era del propio banco (probable
 *    retención/disponibilidad de nómina el mismo día), no un error de
 *    parseo. Bloquear el documento entero por esto habría descartado datos
 *    buenos; se avisa en su lugar para que alguien lo revise si quiere.
 *
 * Devuelve el mensaje de errorDocumento si la validación FUERTE falla, o
 * null si pasó (y ya empujó la advertencia SUAVE a erroresPorFila si aplica). */
function validarCadenaYSaldoDisponible(
  movimientos: FilaEstadoCuentaMapeada[],
  saldoDisponible: number | null,
  erroresPorFila: { fila: number; errores: string[] }[],
): string | null {
  const cronologico = [...movimientos].reverse();
  for (let i = 1; i < cronologico.length; i++) {
    const anterior = cronologico[i - 1];
    const actual = cronologico[i];
    const esperado = Math.round((anterior.saldo + (actual.abonoTotal ?? 0) - (actual.cargoTotal ?? 0)) * 100) / 100;
    if (Math.abs(esperado - actual.saldo) > 0.01) {
      return `El saldo del movimiento del ${actual.fechaPago} (${actual.saldo}) no cuadra con el saldo del movimiento anterior (${anterior.saldo}) +/- el monto clasificado -- no se insertó nada, revisa el archivo manualmente`;
    }
  }

  if (saldoDisponible != null && movimientos.length > 0 && Math.abs(movimientos[0].saldo - saldoDisponible) > 0.01) {
    erroresPorFila.unshift({
      fila: 0,
      errores: [
        `El PDF declara un Saldo disponible de ${saldoDisponible} pero el movimiento más reciente extraído tiene saldo ${movimientos[0].saldo} -- la cadena de saldos de todos los movimientos SÍ cuadra internamente, así que probablemente es una diferencia entre saldo disponible y saldo contable del banco (ej. retención de nómina del mismo día), no un error de extracción. Revisa que el saldo final coincida con el estado de cuenta real.`,
      ],
    });
  }

  return null;
}

// ── Tercer formato: "app/personal" ──────────────────────────────────────
// Confirmado contra un PDF real (Mario Contreras Farfán, cuenta terminación
// 2047, agosto 2026) -- un tercer layout de BBVA, distinto tanto de MAESTRA
// PYME como del "Detalle de movimientos" de banca en línea de arriba (por el
// encabezado "Saldo disponible" seguido de "Cuenta: · <dígitos>" en vez de
// "Número de cuenta:", probablemente el PDF que genera la app/versión
// personal de BBVA en vez del portal empresarial).
//
// Diferencias clave frente al formato "Detalle de movimientos" (web):
//   - Encabezado de columnas en MAYÚSCULAS y con ABONO antes que CARGO:
//     "FECHA DESCRIPCIÓN ABONO CARGO SALDO" (el otro es "Fecha Concepto /
//     Referencia Cargo Abono Saldo", Título y Cargo antes de Abono).
//   - Fecha CON año y mes en letras minúsculas: "31 ago 2026" (el otro es
//     "20-08", día-mes sin año).
//   - Cada monto no es un solo item de texto -- el PDF renderiza los
//     centavos en superíndice, así que pdf.js lo parte en 3 items
//     CONSECUTIVOS en el orden del stream: el signo ("$" o "-$"), la parte
//     entera con el punto ("59,448."), y los 2 dígitos de centavos ("28").
//     Confirmado con el PDF real que esos 3 items SIEMPRE aparecen
//     consecutivos en orden de lectura (izquierda a derecha), tanto para
//     cargos como para abonos -- por eso este parser reconstruye montos por
//     ADYACENCIA en el orden natural del stream en vez de por posición x1
//     (a diferencia de MAESTRA PYME): más simple y, para este layout
//     específico, más confiable, porque el signo (con o sin "-") ya dice
//     directamente si es cargo o abono, sin necesitar anclas de columna.
//   - Cada fila trae exactamente 2 montos reconstruidos: el del movimiento
//     (cargo o abono, según el signo) SIEMPRE antes que el del saldo en el
//     orden del stream -- confirmado con filas de cargo Y de abono reales.
//   - El año ya viene incluido en cada fecha -- no hace falta una extracción
//     de año aparte del resumen de la página 1 (a diferencia de los otros
//     dos formatos).

const RE_FECHA_APP = /^(\d{1,2}) ([A-Za-zÁÉÍÓÚñÑ]{3}) (\d{4})$/;
const RE_MONTO_SIGNO = /^-?\$$/;
const RE_MONTO_ENTERO = /^[\d,]+\.$/;
const RE_MONTO_CENTAVOS = /^\d{2}$/;

/** Igual idea que extraerAnclasColumnas/Web pero para este formato: busca
 * una fila con los 5 labels de encabezado juntos, en MAYÚSCULAS. No hace
 * falta devolver posiciones (x1) -- este formato no las necesita, ver
 * comentario de la sección. */
function esFormatoApp(paginas: ItemPdfPosicionado[][]): boolean {
  for (const itemsPagina of paginas) {
    const porFila = new Map<number, ItemPdfPosicionado[]>();
    for (const item of itemsPagina) {
      const clave = Math.round(item.y * 10) / 10;
      const lista = porFila.get(clave);
      if (lista) lista.push(item);
      else porFila.set(clave, [item]);
    }
    for (const itemsFila of porFila.values()) {
      const tiene = (texto: string) => itemsFila.some((i) => i.texto === texto);
      if (tiene("FECHA") && tiene("DESCRIPCIÓN") && tiene("ABONO") && tiene("CARGO") && tiene("SALDO")) return true;
    }
  }
  return false;
}

function extraerSaldoDisponibleApp(paginas: ItemPdfPosicionado[][]): number | null {
  const texto = paginas.map((p) => p.map((i) => i.texto).join(" ")).join(" ");
  const m = texto.match(/Saldo disponible[\s\S]{0,80}?\$\s*([\d,]+\.\d{2})/i);
  return m ? aNumero(m[1]) : null;
}

/** Reconstruye un monto a partir de 3 items consecutivos (signo + entero-con-
 * punto + centavos, ver comentario de la sección) empezando en `desde`.
 * Devuelve el monto (con signo) y el índice siguiente al último item
 * consumido, o null si en `desde` no arranca ese patrón. */
function leerMontoApp(items: ItemPdfPosicionado[], desde: number): { monto: number; siguiente: number } | null {
  const signo = items[desde];
  const entero = items[desde + 1];
  const centavos = items[desde + 2];
  if (!signo || !entero || !centavos) return null;
  if (!RE_MONTO_SIGNO.test(signo.texto) || !RE_MONTO_ENTERO.test(entero.texto) || !RE_MONTO_CENTAVOS.test(centavos.texto)) return null;
  const esNegativo = signo.texto === "-$";
  const valor = aNumero(entero.texto.slice(0, -1) + "." + centavos.texto);
  return { monto: esNegativo ? -valor : valor, siguiente: desde + 3 };
}

function parsearComoApp(paginas: ItemPdfPosicionado[][]): ResultadoParseoPdf {
  // El orden NATURAL del stream (sin reordenar por x0/y) es lo que preserva
  // la adyacencia signo+entero+centavos -- ver comentario de la sección.
  const items = paginas.flat();

  const indicesAncla: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (RE_FECHA_APP.test(items[i].texto)) indicesAncla.push(i);
  }
  if (indicesAncla.length === 0) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se encontró ningún movimiento (fecha 'DD mmm AAAA') en la tabla del PDF" };
  }

  const movimientos: FilaEstadoCuentaMapeada[] = [];

  for (let a = 0; a < indicesAncla.length; a++) {
    const inicio = indicesAncla[a];
    let fin = a + 1 < indicesAncla.length ? indicesAncla[a + 1] : items.length;
    // El último movimiento del documento arrastra el aviso legal de pie de
    // página -- se recorta ahí si aparece, mismo criterio que el formato web.
    for (let i = inicio; i < fin; i++) {
      if (items[i].texto.startsWith("En cumplimiento")) {
        fin = i;
        break;
      }
    }
    const bloque = items.slice(inicio, fin);

    const itemFecha = bloque[0];
    const m = itemFecha.texto.match(RE_FECHA_APP)!;
    const [, diaStr, mesAbrev, anioStr] = m;
    const mes = MESES[mesAbrev.toUpperCase()];
    if (!mes) {
      return { movimientos: [], erroresPorFila: [], errorDocumento: `Mes no reconocido: "${mesAbrev}" en el movimiento del ${itemFecha.texto}` };
    }

    // Reconstruye los montos por adyacencia en todo el bloque (ver
    // leerMontoApp) -- se esperan exactamente 2: primero el del movimiento
    // (cargo o abono, según el signo), luego el saldo, en ese orden.
    const montosEncontrados: number[] = [];
    for (let i = 0; i < bloque.length; i++) {
      const resultado = leerMontoApp(bloque, i);
      if (resultado) {
        montosEncontrados.push(resultado.monto);
        i = resultado.siguiente - 1; // el for ya suma 1
      }
    }
    if (montosEncontrados.length !== 2) {
      return {
        movimientos: [],
        erroresPorFila: [],
        errorDocumento: `Se esperaban 2 montos (movimiento y saldo) para el movimiento del ${itemFecha.texto} y se encontraron ${montosEncontrados.length} -- no se insertó nada, revisa el archivo manualmente`,
      };
    }
    const [montoMovimiento, saldo] = montosEncontrados;

    const descripcion = bloque
      .slice(1)
      .filter((it) => {
        if (it === itemFecha) return false;
        // Excluye los 6 items (2 montos x 3 piezas) ya consumidos arriba --
        // se identifican por el mismo patrón, no por índice, para no
        // depender de que leerMontoApp haya arrancado justo en esas
        // posiciones (más robusto si algún día un monto no reconstruye).
        return !RE_MONTO_SIGNO.test(it.texto) && !RE_MONTO_ENTERO.test(it.texto) && !RE_MONTO_CENTAVOS.test(it.texto);
      })
      .map((it) => it.texto)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    movimientos.push({
      fechaPago: `${anioStr}-${String(mes).padStart(2, "0")}-${diaStr.padStart(2, "0")}`,
      fechaOrden: null,
      folio: null,
      proyecto: null,
      nombreRazonSocial: descripcion || null,
      cargoTotal: montoMovimiento < 0 ? -montoMovimiento : null,
      abonoTotal: montoMovimiento < 0 ? null : montoMovimiento,
      saldo,
      referenciaTipo: null as ReferenciaTipo | null,
      referenciaNumero: null,
      factura: null,
      comentarios: null,
      observacion: 'Extraído automáticamente de un PDF de BBVA (formato app/personal)',
    });
  }

  const erroresPorFila: { fila: number; errores: string[] }[] = [];
  const errorCadena = validarCadenaYSaldoDisponible(movimientos, extraerSaldoDisponibleApp(paginas), erroresPorFila);
  if (errorCadena) return { movimientos: [], erroresPorFila: [], errorDocumento: errorCadena };

  return { movimientos, erroresPorFila, errorDocumento: null };
}
