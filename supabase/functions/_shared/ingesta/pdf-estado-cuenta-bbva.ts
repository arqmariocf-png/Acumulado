// Parsea el texto ya extraído (con unpdf, ver pdf-cargador.ts) de un estado
// de cuenta en PDF de BBVA al mismo modelo que usa estado-cuenta.ts para
// Excel/CSV, y que usa pdf-estado-cuenta.ts para BanBajío.
//
// Confirmado contra un archivo real (ESTADO_DE_CUENTA_AL_31_DE_JULIO1.pdf,
// cuenta BBVA 5859 de Aceros y Envasados de Puebla, julio 2026). El layout
// es MUY distinto al de BanBajío -- NO se puede reusar el mismo parser:
//
//   - Las filas vienen en orden DESCENDENTE por fecha (la más reciente
//     primero), no ascendente.
//   - Cada fila trae su propia fecha completa "DD-MM-AAAA" -- a diferencia
//     de BanBajío, no hace falta leer un encabezado de periodo aparte.
//   - No hay una columna "Cargo"/"Abono" separable de forma confiable por
//     posición de texto en la extracción -- se resuelve igual que en
//     BanBajío, con el delta de saldo contra la fila cronológicamente
//     anterior (aquí, la SIGUIENTE en el orden del archivo, por venir
//     descendente).
//   - La descripción de cada movimiento frecuentemente trae un desglose de
//     IVA embebido en el mismo texto (ej. "RFC:VPU860913EB0  IVA:827.59
//     6,000.00") -- el número junto a "IVA:" NO es el monto del movimiento,
//     es solo informativo, y hay que excluirlo explícitamente o se cuenta
//     como si fuera un tercer monto en la fila (confirmado contando los
//     montos reales del archivo real: 139 filas × 2 montos esperados = 278,
//     y el archivo trae exactamente 278 montos con importe real una vez
//     excluidos los 48 "IVA:X.XX").
//
// A diferencia de BanBajío, este documento (al menos el que se compartió)
// NO trae un total de movimientos ni un saldo final declarado en ningún
// lado para autovalidar la extracción completa -- por eso la fila
// cronológicamente más antigua del archivo (la última en el orden
// descendente) no se puede clasificar como cargo/abono (no hay una fila
// "anterior" contra la cual comparar el delta de saldo) y queda reportada
// como pendiente en vez de adivinada.

import type { ResultadoParseoPdf } from "./pdf-estado-cuenta.ts";
import type { FilaEstadoCuentaMapeada } from "./estado-cuenta.ts";
import type { ReferenciaTipo } from "../motor/types.ts";

const RE_FECHA = /(\d{2})-(\d{2})-(\d{4})/g;
const RE_IVA = /IVA:[0-9,]+\.[0-9]{2}/g;
const RE_MONTO = /-?[0-9][0-9,]*\.[0-9]{2}/g;

function aNumero(texto: string): number {
  return Number(texto.replace(/,/g, ""));
}

interface FilaCruda {
  idx: number;
  fechaIso: string;
  descripcion: string;
  monto: number | null;
  saldo: number | null;
}

export function parsearPdfEstadoCuentaBBVA(textoCompleto: string): ResultadoParseoPdf {
  const posiciones: { idx: number; fechaIso: string }[] = [];
  let m: RegExpExecArray | null;
  RE_FECHA.lastIndex = 0;
  while ((m = RE_FECHA.exec(textoCompleto))) {
    const [, dia, mes, anio] = m;
    posiciones.push({ idx: m.index, fechaIso: `${anio}-${mes}-${dia}` });
  }

  if (posiciones.length === 0) {
    return { movimientos: [], erroresPorFila: [], errorDocumento: "No se encontraron filas con fecha (DD-MM-AAAA) en el PDF" };
  }

  const filas: FilaCruda[] = [];
  const erroresPorFila: { fila: number; errores: string[] }[] = [];

  for (let i = 0; i < posiciones.length; i++) {
    const inicio = posiciones[i].idx + 10; // longitud de "DD-MM-AAAA"
    const fin = i + 1 < posiciones.length ? posiciones[i + 1].idx : textoCompleto.length;
    const chunkOriginal = textoCompleto.slice(inicio, fin);
    const chunkSinIva = chunkOriginal.replace(RE_IVA, "");
    const tokens = chunkSinIva.match(RE_MONTO) ?? [];

    if (tokens.length !== 2) {
      erroresPorFila.push({
        fila: i + 1,
        errores: [`Se esperaban 2 montos (movimiento y saldo) y se encontraron ${tokens.length} -- posible línea mal extraída: "${chunkOriginal.slice(0, 120).trim()}"`],
      });
      filas.push({ idx: i, fechaIso: posiciones[i].fechaIso, descripcion: chunkOriginal.replace(RE_MONTO, "").replace(/\s+/g, " ").trim(), monto: null, saldo: null });
      continue;
    }

    filas.push({
      idx: i,
      fechaIso: posiciones[i].fechaIso,
      descripcion: chunkSinIva.replace(RE_MONTO, "").replace(/\s+/g, " ").trim(),
      monto: aNumero(tokens[0]),
      saldo: aNumero(tokens[1]),
    });
  }

  const movimientos: FilaEstadoCuentaMapeada[] = [];

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    if (fila.monto === null || fila.saldo === null) continue; // ya reportada arriba

    const siguiente = filas[i + 1]; // el archivo viene descendente: la siguiente fila es cronológicamente anterior
    if (!siguiente || siguiente.saldo === null) {
      erroresPorFila.push({
        fila: i + 1,
        errores: ["No se puede determinar cargo/abono para esta fila -- es la transacción más antigua visible en el archivo y no hay una fila anterior contra la cual comparar el saldo"],
      });
      continue;
    }

    const delta = Math.round((fila.saldo - siguiente.saldo) * 100) / 100;
    const esAbono = Math.abs(delta - fila.monto) < 0.01;
    const esCargo = Math.abs(delta + fila.monto) < 0.01;

    if (!esAbono && !esCargo) {
      erroresPorFila.push({
        fila: i + 1,
        errores: [`El saldo (${fila.saldo}) no cuadra con el saldo de la fila anterior (${siguiente.saldo}) +/- el monto (${fila.monto}) -- posible línea mal extraída`],
      });
      continue;
    }

    movimientos.push({
      fechaPago: fila.fechaIso,
      fechaOrden: null,
      folio: null,
      proyecto: null,
      nombreRazonSocial: fila.descripcion || null,
      cargoTotal: esCargo ? fila.monto : null,
      abonoTotal: esAbono ? fila.monto : null,
      saldo: fila.saldo,
      referenciaTipo: null as ReferenciaTipo | null,
      referenciaNumero: null,
      factura: null,
      comentarios: null,
      observacion: "Extraído automáticamente de un PDF de BBVA",
    });
  }

  return { movimientos, erroresPorFila, errorDocumento: null };
}
