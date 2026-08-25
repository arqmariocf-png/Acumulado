// Mapea registros del catálogo de OC/OS y OV, ya sea desde la API del
// backoffice (JSON, campos dados textualmente en SPEC.md sección 3) o desde
// la carga manual de Excel de respaldo (mismos campos, como encabezados).

import { normalizarTexto, periodoDeFecha } from "../motor/normalizar.ts";

export interface OrdenCompraMapeada {
  idOrden: string;
  tipo: "OC" | "OS";
  proyecto: string | null;
  proveedor: string | null;
  total: number | null;
  fechaCreacion: string | null; // ISO
}

export interface OrdenVentaMapeada {
  idOv: string;
  proyecto: string | null;
  cliente: string | null;
  total: number | null;
  fechaOv: string | null; // ISO
}

function aFechaIso(valor: unknown): string | null {
  if (valor == null) return null;
  const t = String(valor).trim();
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

function aNumeroONull(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * SPEC.md sección 3 lista los campos de la API como `Id_Orden, Proyecto,
 * Empresa_solicitante, Proveedor, Total, Creado` pero NO especifica cómo
 * distingue la API entre OC (orden de compra) y OS (orden de servicio) —
 * puede venir en un campo no documentado (`Tipo`, `Tipo_Orden`, un prefijo en
 * Id_Orden, o endpoints separados). Mientras se confirma con el equipo del
 * backoffice, este mapeo acepta un campo opcional `Tipo`/`tipo` en el JSON y
 * cae a 'OC' por default — HAY QUE VALIDAR esto contra la API real antes de
 * confiar en la distinción OC/OS en producción.
 */
export function mapearOrdenCompraDesdeApi(json: Record<string, unknown>): OrdenCompraMapeada {
  const tipoRaw = String(json.Tipo ?? json.tipo ?? json.Tipo_Orden ?? "OC").toUpperCase();
  return {
    idOrden: String(json.Id_Orden ?? json.id_orden ?? "").trim(),
    tipo: tipoRaw === "OS" ? "OS" : "OC",
    proyecto: json.Proyecto ? String(json.Proyecto).trim() : null,
    proveedor: json.Proveedor ? String(json.Proveedor).trim() : null,
    total: aNumeroONull(json.Total ?? json.total),
    fechaCreacion: aFechaIso(json.Creado ?? json.creado),
  };
}

export function mapearOrdenVentaDesdeApi(json: Record<string, unknown>): OrdenVentaMapeada {
  return {
    idOv: String(json["Id OV"] ?? json.Folio_orden_venta ?? json.id_ov ?? "").trim(),
    proyecto: json.Proyecto ? String(json.Proyecto).trim() : null,
    cliente: json.Cliente ? String(json.Cliente).trim() : null,
    total: aNumeroONull(json.Total ?? json.total),
    fechaOv: aFechaIso(json.FechaOV ?? json.fechaOV ?? json.fecha_ov),
  };
}

// ── Carga manual de Excel (mismos campos, como encabezados de columna) ────

export function normalizarEncabezadoOcOv(h: string): string {
  return normalizarTexto(h).replace(/_/g, " ");
}

export function mapearFilaOrdenCompraExcel(filaObj: Record<string, string>): OrdenCompraMapeada | null {
  const get = (clave: string) => filaObj[normalizarTexto(clave)] ?? "";
  const idOrden = get("ID ORDEN").trim() || get("ID_ORDEN").trim();
  if (!idOrden) return null;
  const tipoTexto = get("TIPO").trim().toUpperCase();
  return {
    idOrden,
    tipo: tipoTexto === "OS" ? "OS" : "OC",
    proyecto: get("PROYECTO").trim() || null,
    proveedor: get("PROVEEDOR").trim() || null,
    total: aNumeroONull(get("TOTAL")),
    fechaCreacion: aFechaIso(get("CREADO")),
  };
}

export function mapearFilaOrdenVentaExcel(filaObj: Record<string, string>): OrdenVentaMapeada | null {
  const get = (clave: string) => filaObj[normalizarTexto(clave)] ?? "";
  const idOv = get("ID OV").trim() || get("FOLIO ORDEN VENTA").trim();
  if (!idOv) return null;
  return {
    idOv,
    proyecto: get("PROYECTO").trim() || null,
    cliente: get("CLIENTE").trim() || null,
    total: aNumeroONull(get("TOTAL")),
    fechaOv: aFechaIso(get("FECHAOV").trim() || get("FECHA OV")),
  };
}

export { periodoDeFecha };
