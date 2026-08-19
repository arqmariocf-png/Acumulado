// Mapea filas ya parseadas (de CSV o Excel, ambos convertidos previamente a
// array-de-objetos por encabezado) al modelo de public.movimientos.
//
// Los encabezados canónicos son los de SPEC.md sección 2, que además
// coinciden EXACTAMENTE con las hojas DB_Julio/DB_Agosto del Excel real de
// referencia (Acumulado_Bancos_2026.xlsx) — por eso este es el formato
// primario soportado: es literalmente el formato en el que tesorería ya
// trabaja hoy. Adaptadores para exportes crudos de banca en línea (columnas
// distintas por banco) se agregan después, cuando haya archivos de muestra
// reales de BBVA/Banorte/Santander/BanBajío para no adivinar el layout.

import { normalizarTexto } from "../motor/normalizar.ts";
import type { ReferenciaTipo } from "../motor/types.ts";

export interface FilaEstadoCuentaMapeada {
  fechaPago: string; // ISO yyyy-mm-dd
  fechaOrden: string | null;
  folio: string | null;
  proyecto: string | null;
  nombreRazonSocial: string | null;
  cargoTotal: number | null;
  abonoTotal: number | null;
  saldo: number;
  referenciaTipo: ReferenciaTipo | null;
  referenciaNumero: string | null;
  factura: string | null;
  comentarios: string | null;
  observacion: string | null;
}

export interface ResultadoMapeoFila {
  fila: number; // 1-indexed, relativo a los datos (sin contar encabezado)
  movimiento: FilaEstadoCuentaMapeada | null;
  errores: string[];
}

export interface ClaveMovimientoExistente {
  fechaPago: string;
  monto: number;
  referenciaNumero: string | null;
}

export interface ResultadoFiltrado {
  nuevos: FilaEstadoCuentaMapeada[];
  omitidosPorExistentes: number;
}

const TOLERANCIA_CENTAVOS = 0.01;

/** Evita duplicar movimientos cuando el mismo estado de cuenta se recarga
 * traslapado con uno ya cargado antes (ej. tesorería sube la actualización
 * del mes todos los días, y cada archivo nuevo repite los movimientos de
 * días anteriores) -- compara contra lo que ya existe en esa cuenta usando
 * la misma llave que ya usa el motor de conciliación para el flag
 * posible_duplicado (Fecha + Monto + Referencia, ver motor.ts fase 4.6),
 * pero aquí se usa para NO insertar la fila de nuevo, no solo para marcarla.
 * Es la misma tolerancia a falsos positivos que ya acepta esa fase del
 * motor (dos movimientos genuinamente distintos con exactamente la misma
 * fecha/monto/referencia son indistinguibles con los datos que trae un
 * estado de cuenta). */
export function filtrarMovimientosNuevos(filas: FilaEstadoCuentaMapeada[], existentes: ClaveMovimientoExistente[]): ResultadoFiltrado {
  const nuevos: FilaEstadoCuentaMapeada[] = [];
  let omitidosPorExistentes = 0;

  for (const fila of filas) {
    const monto = fila.cargoTotal ?? fila.abonoTotal;
    const yaExiste =
      monto != null &&
      existentes.some(
        (e) => e.fechaPago === fila.fechaPago && Math.abs(e.monto - monto) <= TOLERANCIA_CENTAVOS && e.referenciaNumero === fila.referenciaNumero,
      );
    if (yaExiste) {
      omitidosPorExistentes++;
    } else {
      nuevos.push(fila);
    }
  }

  return { nuevos, omitidosPorExistentes };
}

export type CampoCanonico =
  | "cuenta"
  | "folio"
  | "fechaPago"
  | "empresa"
  | "proyecto"
  | "nombreRazonSocial"
  | "cargoTotal"
  | "abonoTotal"
  | "saldo"
  | "referencia"
  | "fechaOrden"
  | "factura"
  | "comentarios"
  | "observacion";

// encabezado normalizado (mayúsculas, sin acentos ni puntuación) -> campo
// canónico. Varias filas pueden mapear al mismo campo (aliases).
const ALIAS_ENCABEZADO: Record<string, CampoCanonico> = {
  CUENTA: "cuenta",
  FOLIO: "folio",
  "FECHA DE PAGO": "fechaPago",
  EMPRESA: "empresa",
  PROYECTO: "proyecto",
  "NOMBRE O RAZON SOCIAL": "nombreRazonSocial",
  "CARGO TOTAL": "cargoTotal",
  "ABONO TOTAL": "abonoTotal",
  SALDO: "saldo",
  "OC / OS / OV / OF": "referencia",
  "OC OS OV OF": "referencia",
  "FECHA OC/OS/OV": "fechaOrden",
  "FECHA OC OS OV": "fechaOrden",
  FACTURA: "factura",
  COMENTARIOS: "comentarios",
  OBSERVACION: "observacion",
};

const CAMPOS_REQUERIDOS: CampoCanonico[] = ["cuenta", "fechaPago", "saldo"];

export function normalizarEncabezadoEstadoCuenta(h: string): string {
  return normalizarTexto(h);
}

/** Construye, a partir de la fila de encabezado real de un archivo (ya
 * normalizada), el mapa campo canónico -> encabezado real presente en ese
 * archivo. Se calcula UNA vez por archivo, no por fila, y es lo que evita
 * el bug de "adivinar" el primer alias de una lista estática sin mirar qué
 * encabezado trae realmente el archivo. */
export function construirIndiceCampos(encabezadosNormalizados: string[]): Map<CampoCanonico, string> {
  const indice = new Map<CampoCanonico, string>();
  for (const encabezado of encabezadosNormalizados) {
    const campo = ALIAS_ENCABEZADO[encabezado];
    if (campo && !indice.has(campo)) {
      indice.set(campo, encabezado);
    }
  }
  return indice;
}

export function encabezadosFaltantes(indice: Map<CampoCanonico, string>): CampoCanonico[] {
  return CAMPOS_REQUERIDOS.filter((c) => !indice.has(c));
}

function aNumero(texto: string): number | null {
  const limpio = texto.replace(/[^0-9.\-]/g, "");
  if (limpio === "" || limpio === "-") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Acepta "7/1/26", "07/01/2026" y "2026-07-01"; devuelve ISO yyyy-mm-dd. */
function aFechaIso(texto: string): string | null {
  const t = texto.trim();
  if (t === "") return null;

  const isoMatch = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const mdyMatch = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    const [, mStr, dStr, yStr] = mdyMatch;
    let anio = Number(yStr);
    if (anio < 100) anio += 2000;
    const mes = mStr.padStart(2, "0");
    const dia = dStr.padStart(2, "0");
    return `${anio}-${mes}-${dia}`;
  }
  return null;
}

/** Separa "OC 39466" / "OS 12345" / "OV 14628" en tipo + número. */
function parsearReferencia(texto: string): { tipo: ReferenciaTipo | null; numero: string | null } {
  const t = texto.trim();
  if (t === "") return { tipo: null, numero: null };
  const m = t.match(/^(OC|OS|OV|OF)\s*(.+)$/i);
  if (!m) return { tipo: null, numero: t }; // referencia libre sin prefijo reconocido
  return { tipo: m[1].toUpperCase() as ReferenciaTipo, numero: m[2].trim() };
}

export function mapearFilaEstadoCuenta(
  filaObj: Record<string, string>,
  indice: Map<CampoCanonico, string>,
  numeroFila: number,
): ResultadoMapeoFila {
  const errores: string[] = [];

  const get = (campo: CampoCanonico): string => {
    const encabezadoReal = indice.get(campo);
    if (!encabezadoReal) return "";
    return filaObj[encabezadoReal] ?? "";
  };

  const fechaPagoTexto = get("fechaPago");
  const fechaPago = aFechaIso(fechaPagoTexto);
  if (!fechaPago) errores.push(`Fecha de Pago inválida o vacía: "${fechaPagoTexto}"`);

  const saldoTexto = get("saldo");
  const saldo = aNumero(saldoTexto);
  if (saldo === null) errores.push(`Saldo inválido o vacío: "${saldoTexto}"`);

  const cargoTexto = get("cargoTotal");
  const abonoTexto = get("abonoTotal");
  const cargoTotal = cargoTexto.trim() === "" ? null : aNumero(cargoTexto);
  const abonoTotal = abonoTexto.trim() === "" ? null : aNumero(abonoTexto);

  // Regla crítica de captura (SPEC.md sección 2): exactamente uno de los dos.
  if (cargoTotal === null && abonoTotal === null) {
    errores.push("La fila no trae Cargo Total ni Abono Total (debe traer exactamente uno)");
  } else if (cargoTotal !== null && abonoTotal !== null) {
    errores.push("La fila trae Cargo Total y Abono Total a la vez (deben ser mutuamente excluyentes)");
  }

  const { tipo: referenciaTipo, numero: referenciaNumero } = parsearReferencia(get("referencia"));
  const fechaOrdenTexto = get("fechaOrden");
  const fechaOrden = fechaOrdenTexto.trim() === "" ? null : aFechaIso(fechaOrdenTexto);

  if (errores.length > 0) {
    return { fila: numeroFila, movimiento: null, errores };
  }

  return {
    fila: numeroFila,
    errores: [],
    movimiento: {
      fechaPago: fechaPago!,
      fechaOrden,
      folio: get("folio").trim() || null,
      proyecto: get("proyecto").trim() || null,
      nombreRazonSocial: get("nombreRazonSocial").trim() || null,
      cargoTotal,
      abonoTotal,
      saldo: saldo!,
      referenciaTipo,
      referenciaNumero,
      factura: get("factura").trim() || null,
      comentarios: get("comentarios").trim() || null,
      observacion: get("observacion").trim() || null,
    },
  };
}
