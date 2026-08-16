// Mapea filas de un archivo de CFDI (Recibidos-{RFC}-{AAAAMM}.xls /
// Emitidos-{RFC}-{AAAAMM}.xls, sección 3 de SPEC.md) al modelo de public.cfdi.
//
// A diferencia del parser de estado de cuenta, aquí NO tuve un archivo real
// de referencia para confirmar encabezados exactos — el spec solo da el
// nombre de archivo y los campos conceptuales (Total, Folio). Los alias de
// abajo cubren las variantes más comunes de exportadores de CFDI en México
// (Folio Fiscal/UUID, RFC+Nombre Emisor/Receptor). Este mapeo debe
// verificarse contra un archivo real antes de producción.

import { normalizarTexto } from "../motor/normalizar.ts";

export interface FilaCfdiMapeada {
  folio: string;
  total: number;
  fecha: string | null; // ISO yyyy-mm-dd
  rfcContraparte: string | null;
  nombreContraparte: string | null;
}

export interface ResultadoMapeoCfdi {
  fila: number;
  registro: FilaCfdiMapeada | null;
  errores: string[];
}

export type CampoCfdi = "folio" | "total" | "fecha" | "rfcEmisor" | "nombreEmisor" | "rfcReceptor" | "nombreReceptor";

const ALIAS_ENCABEZADO_CFDI: Record<string, CampoCfdi> = {
  UUID: "folio",
  "FOLIO FISCAL": "folio",
  FOLIO: "folio",
  TOTAL: "total",
  "MONTO TOTAL": "total",
  FECHA: "fecha",
  "FECHA EMISION": "fecha",
  "FECHA DE EMISION": "fecha",
  "RFC EMISOR": "rfcEmisor",
  "NOMBRE EMISOR": "nombreEmisor",
  "RFC RECEPTOR": "rfcReceptor",
  "NOMBRE RECEPTOR": "nombreReceptor",
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

export function encabezadosFaltantesCfdi(indice: Map<CampoCfdi, string>): CampoCfdi[] {
  const requeridos: CampoCfdi[] = ["folio", "total"];
  return requeridos.filter((c) => !indice.has(c));
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
  const errores: string[] = [];
  const get = (campo: CampoCfdi): string => {
    const encabezadoReal = indice.get(campo);
    return encabezadoReal ? filaObj[encabezadoReal] ?? "" : "";
  };

  const folio = get("folio").trim();
  if (!folio) errores.push("Falta Folio/UUID");

  const total = aNumero(get("total"));
  if (total === null) errores.push(`Total inválido o vacío: "${get("total")}"`);

  const fecha = aFechaIso(get("fecha"));

  const rfcContraparte = tipo === "recibido" ? get("rfcEmisor").trim() || null : get("rfcReceptor").trim() || null;
  const nombreContraparte = tipo === "recibido" ? get("nombreEmisor").trim() || null : get("nombreReceptor").trim() || null;

  if (errores.length > 0) return { fila: numeroFila, registro: null, errores };

  return {
    fila: numeroFila,
    errores: [],
    registro: { folio, total: total!, fecha, rfcContraparte, nombreContraparte },
  };
}
