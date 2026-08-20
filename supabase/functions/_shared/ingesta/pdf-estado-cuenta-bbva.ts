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
// dígitos tenga el número, a diferencia de x0). Confirmado contra el PDF
// real con dos extractores de texto independientes (unpdf/pdf.js y
// PyMuPDF): las 4 columnas de montos caen en clusters de x1 nítidos y sin
// traslape (Cargos ≈407.9, Abonos ≈468.9, Saldo Operación ≈534.1, Saldo
// Liquidación ≈602.2 puntos), así que NO hace falta inferir cargo/abono por
// delta de saldo (a diferencia de BanBajío y del formato BBVA anterior) --
// el documento ya lo dice directamente por columna, lo cual es más
// confiable que adivinar por delta.
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

const RE_FECHA_CORTA = /^(\d{1,2})\/([A-ZÑ]{3})$/;
const RE_MONTO = /^-?[\d,]+\.\d{2}$/;
const RE_CODIGO_AL_INICIO = /^[A-Z]\d{2}\s+/;

// Posiciones (x1, borde derecho) de cada columna de montos, confirmadas
// contra el PDF real -- ver comentario del encabezado. Tolerancia de ±1.5pt
// por redondeo de fuente.
const X1_CARGO = 407.9;
const X1_ABONO = 468.9;
const TOLERANCIA_X = 1.5;

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

  const movimientos: FilaEstadoCuentaMapeada[] = [];
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

    for (const [, itemsFila] of filasOrdenadas) {
      const itemFecha = itemsFila.find((i) => i.x0 < 15 && RE_FECHA_CORTA.test(i.texto));
      if (!itemFecha) continue; // no es una fila de movimiento (encabezado, metadata, etc.)
      filaNum++;

      const m = itemFecha.texto.match(RE_FECHA_CORTA)!;
      const mes = MESES[m[2]];
      if (!mes) {
        erroresPorFila.push({ fila: filaNum, errores: [`Mes no reconocido: "${itemFecha.texto}"`] });
        continue;
      }

      const itemDescripcion = itemsFila.find((i) => Math.abs(i.x0 - 85.7) < 2);
      const itemCargo = itemsFila.find((i) => RE_MONTO.test(i.texto) && Math.abs(i.x1 - X1_CARGO) < TOLERANCIA_X);
      const itemAbono = itemsFila.find((i) => RE_MONTO.test(i.texto) && Math.abs(i.x1 - X1_ABONO) < TOLERANCIA_X);

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

      const descripcion = (itemDescripcion?.texto ?? "").replace(RE_CODIGO_AL_INICIO, "").trim();

      movimientos.push({
        fechaPago: `${anio}-${String(mes).padStart(2, "0")}-${m[1].padStart(2, "0")}`,
        fechaOrden: null,
        folio: null,
        proyecto: null,
        nombreRazonSocial: descripcion || null,
        cargoTotal: itemCargo ? aNumero(itemCargo.texto) : null,
        abonoTotal: itemAbono ? aNumero(itemAbono.texto) : null,
        saldo: null,
        referenciaTipo: null as ReferenciaTipo | null,
        referenciaNumero: null,
        factura: null,
        comentarios: null,
        observacion: 'Extraído automáticamente de un PDF de BBVA (formato "MAESTRA PYME BBVA")',
      });
    }
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
