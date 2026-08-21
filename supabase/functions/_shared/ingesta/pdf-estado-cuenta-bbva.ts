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
 * fixture de datos reales sin tener que re-parsear el PDF en cada test. */
export function parsearPaginasBBVA(paginas: ItemPdfPosicionado[][]): ResultadoParseoPdf {
  if (paginas.length === 0 || paginas.every((p) => p.length === 0)) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "El PDF no tiene contenido de texto extraíble" };
  }

  const anio = extraerAnio(paginas[0] ?? []);
  if (!anio) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se pudo determinar el año del periodo en el PDF" };
  }

  const anclas = extraerAnclasColumnas(paginas);
  if (!anclas) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se pudo ubicar el encabezado de columnas (CARGOS/ABONOS/OPERACIÓN/LIQUIDACIÓN) en el PDF" };
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
