// Mapea filas de un archivo de CFDI (Recibidos-{RFC}-{AAAAMM}.xls /
// Emitidos-{RFC}-{AAAAMM}.xls, sección 3 de SPEC.md) al modelo de public.cfdi.
//
// Encabezados confirmados contra un archivo real (export de Compac,
// RecibidosAEL131023CS1202607.xls, agosto 2026). El archivo trae DOS hojas
// con estructura distinta:
//
//   Sheet1        -> CFDI normales (ingreso/egreso/nómina). El monto real
//                    está en la columna "Total".
//   RecibosDePago -> Complementos de pago (REP). Su propia columna "Total"/
//                    "Monto total" normalmente es 0 -- el monto real que hay
//                    que conciliar contra el banco está en "ImpPagado"
//                    (confirmado con el usuario: un complemento de pago no
//                    tiene total propio, lo que cuenta es lo efectivamente
//                    pagado). Se unifican ambas hojas con un solo mapeo:
//                    total = ImpPagado si existe la columna, si no, Total.
//
// El identificador único real es el UUID (folio fiscal) -- SIEMPRE presente
// en un CFDI válido. El "Folio" de negocio (consecutivo interno del emisor)
// con frecuencia viene vacío porque el emisor simplemente no lo asigna
// (confirmado con el usuario) -- por eso ya NO se usa como requerido ni
// como identificador, solo el UUID.
//
// El archivo real también trae filas de relleno (todas las celdas de texto
// vacías, pero con 0.0 en las numéricas) al final de la hoja de recibos de
// pago -- se descartan en silencio por falta de UUID, no se reportan como
// error de fila.
//
// Confirmado también contra un archivo real de EMITIDOS (export de Compac,
// AEL131023CS1EMITIDAS202607185642.xlsx, agosto 2026), con TRES hojas:
//
//   General    -> CFDI normales, mismas columnas que Sheet1 del archivo de
//                 recibidos (RFC/Nombre Emisor y Receptor, Total, UUID).
//   Cancelados -> CFDI con Estatus = Cancelado. Un CFDI cancelado no
//                 representa una obligación de pago real -- se excluyen
//                 siempre del catálogo que usa el motor de conciliación
//                 (confirmado con el usuario), sin importar el nombre de la
//                 hoja: el criterio real es la columna "Estatus".
//   Pago20     -> Complementos de pago del lado emitidos (equivalente a
//                 RecibosDePago, pero con nombres de columna DISTINTOS: el
//                 monto real está en "Imp Pagado DR", no "ImpPagado", y su
//                 columna de total propio se llama "Monto Total", no
//                 "Total" -- ninguno de los dos hacía match con los alias
//                 anteriores, por eso toda la hoja se reportaba como
//                 "faltan columnas: total" en vez de procesarse.

import { normalizarTexto } from "../motor/normalizar.ts";

export interface FilaCfdiMapeada {
  folio: string; // UUID (folio fiscal)
  total: number;
  fecha: string | null; // ISO yyyy-mm-dd
  rfcContraparte: string | null;
  nombreContraparte: string | null;
}

export interface ResultadoMapeoCfdi {
  fila: number;
  registro: FilaCfdiMapeada | null;
  errores: string[];
  /** true si la fila se descartó en silencio por no tener UUID (fila de
   * relleno del Excel) o por ser un CFDI cancelado -- en ninguno de los dos
   * casos hay un dato inválido que reportar como error. */
  omitida?: boolean;
}

export type CampoCfdi =
  | "uuid"
  | "total"
  | "impPagado"
  | "fecha"
  | "fechaPago"
  | "rfcEmisor"
  | "nombreEmisor"
  | "rfcReceptor"
  | "nombreReceptor"
  | "estatus";

const ALIAS_ENCABEZADO_CFDI: Record<string, CampoCfdi> = {
  UUID: "uuid",
  "FOLIO FISCAL": "uuid",
  TOTAL: "total",
  IMPPAGADO: "impPagado",
  "MONTO TOTAL": "total", // hoja Pago20 (complementos de pago, lado emitidos)
  "IMP PAGADO DR": "impPagado", // hoja Pago20
  FECHA: "fecha",
  "FECHA EMISION": "fecha",
  "FECHA DE EMISION": "fecha",
  FECHAPAGO: "fechaPago",
  "FECHA DE PAGO": "fechaPago",
  "RFC EMISOR": "rfcEmisor",
  "NOMBRE EMISOR": "nombreEmisor",
  "RFC RECEPTOR": "rfcReceptor",
  "NOMBRE RECEPTOR": "nombreReceptor",
  ESTATUS: "estatus",
};

export function normalizarEncabezadoCfdi(h: string): string {
  return normalizarTexto(h);
}

export function construirIndiceCamposCfdi(encabezadosNormalizados: string[]): Map<CampoCfdi, string> {
  const indice = new Map<CampoCfdi, string>();
  for (const encabezado of encabezadosNormalizados) {
    const campo = ALIAS_ENCABEZADO_CFDI[encabezado];
    if (campo && !indice.has(campo)) indice.set(campo, encabezado);
  }
  return indice;
}

/** Solo el UUID es estrictamente necesario para poder ingerir la hoja -- el
 * monto se resuelve entre Total/ImpPagado, y basta con que al menos una de
 * las dos columnas exista en la hoja (se valida por fila, no aquí). */
export function encabezadosFaltantesCfdi(indice: Map<CampoCfdi, string>): CampoCfdi[] {
  const faltantes: CampoCfdi[] = [];
  if (!indice.has("uuid")) faltantes.push("uuid");
  if (!indice.has("total") && !indice.has("impPagado")) faltantes.push("total");
  return faltantes;
}

function aNumero(texto: string): number | null {
  const limpio = texto.replace(/[^0-9.\-]/g, "");
  if (limpio === "" || limpio === "-") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

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
    return `${anio}-${mStr.padStart(2, "0")}-${dStr.padStart(2, "0")}`;
  }
  return null;
}

export interface FilaCfdiParaInsertar {
  tipo: string;
  rfc: string;
  folio: string;
  periodo: string;
}

/** Postgres rechaza un upsert cuyo batch trae 2+ filas con la misma llave de
 * conflicto: "ON CONFLICT DO UPDATE command cannot affect row a second
 * time" -- visto en producción con un archivo real de emitidos (177 CFDI,
 * varias hojas). Se deduplica por (tipo, rfc, folio, periodo), la misma
 * llave de la unique de la tabla, quedándose con la última ocurrencia --
 * así una fila repetida entre hojas no tumba el upsert completo. */
export function deduplicarFilasCfdi<T extends FilaCfdiParaInsertar>(filas: T[]): T[] {
  const porClave = new Map<string, T>();
  for (const fila of filas) {
    porClave.set(`${fila.tipo}|${fila.rfc}|${fila.folio}|${fila.periodo}`, fila);
  }
  return [...porClave.values()];
}

/**
 * @param tipo 'recibido' -> la contraparte es el Emisor (compramos de él);
 *             'emitido' -> la contraparte es el Receptor (le vendimos a él).
 */
export function mapearFilaCfdi(
  filaObj: Record<string, string>,
  indice: Map<CampoCfdi, string>,
  tipo: "recibido" | "emitido",
  numeroFila: number,
): ResultadoMapeoCfdi {
  const get = (campo: CampoCfdi): string => {
    const encabezadoReal = indice.get(campo);
    return encabezadoReal ? filaObj[encabezadoReal] ?? "" : "";
  };

  const uuid = get("uuid").trim();
  if (!uuid) {
    // Fila de relleno del Excel (sin UUID no hay CFDI real que registrar),
    // no un error del archivo -- se omite en silencio.
    return { fila: numeroFila, registro: null, errores: [], omitida: true };
  }

  // Un CFDI cancelado no representa una obligación de pago real -- se
  // excluye siempre del catálogo que usa el motor de conciliación
  // (confirmado con el usuario), sin importar el nombre de la hoja de
  // origen ("Cancelados" en el archivo real de EMITIDOS): el criterio es la
  // columna "Estatus" de la propia fila.
  if (normalizarTexto(get("estatus")) === "CANCELADO") {
    return { fila: numeroFila, registro: null, errores: [], omitida: true };
  }

  const errores: string[] = [];

  // ImpPagado manda cuando existe (hoja de complementos de pago): el "Total"
  // propio de un REP normalmente es 0 y no es el monto a conciliar.
  const impPagado = aNumero(get("impPagado"));
  const totalColumna = aNumero(get("total"));
  const total = impPagado ?? totalColumna;
  if (total === null) {
    errores.push(`Total/ImpPagado inválido o vacío: "${get("total") || get("impPagado")}"`);
  }

  const fecha = aFechaIso(get("fechaPago")) ?? aFechaIso(get("fecha"));

  const rfcContraparte = tipo === "recibido" ? get("rfcEmisor").trim() || null : get("rfcReceptor").trim() || null;
  const nombreContraparte = tipo === "recibido" ? get("nombreEmisor").trim() || null : get("nombreReceptor").trim() || null;

  if (errores.length > 0) return { fila: numeroFila, registro: null, errores };

  return {
    fila: numeroFila,
    errores: [],
    registro: { folio: uuid, total: total!, fecha, rfcContraparte, nombreContraparte },
  };
}
