// Mapea registros del catálogo de OC/OS y OV, ya sea desde la API del
// backoffice o desde la carga manual de Excel de respaldo.
//
// Campos de la API CONFIRMADOS contra la respuesta real (2026-08-25, ver
// migración sync_catalogo_oc_ov.sql para el flujo automático que usa estos
// mismos nombres directo en SQL):
//   - api_ocs_aut  -> { ordersProject: [{ Id_Orden, Tipo_orden ("Compra" o
//     "Servicio" -- así se distingue OC de OS, no hay un campo "OC"/"OS"
//     literal), Proyecto, Empresa_solicitante, Proveedor, TOTAL (todo
//     mayúsculas), Creado, ... }] } -- una fila por orden, no por línea.
//   - api_ov_aut -> { ordenVentaDashModel: [{ Id_cotizacion,
//     Folio_orden_venta, Project, empresa, Cliente_nombre, Cliente_apellido,
//     OV_Subtotal, FechaOV, ... }] } -- una fila por orden de venta.
// Las variantes "_det_aut" devuelven el mismo catálogo pero por LÍNEA/ítem
// (Item, Cantidad, Costo por renglón) -- no sirven para este mapeo de
// cabecera, que es todo lo que el modelo de datos de la app guarda hoy.
import { normalizarTexto, periodoDeFecha } from "../motor/normalizar.ts";

export interface OrdenCompraMapeada {
  idOrden: string;
  tipo: "OC" | "OS";
  proyecto: string | null;
  proveedor: string | null;
  total: number | null;
  fechaCreacion: string | null; // ISO
  /** Nombre de la empresa tal como lo manda la API (Empresa_solicitante) --
   * solo viene poblado desde mapearOrdenCompraDesdeApi; la carga manual de
   * Excel ya sabe la empresa por el formulario donde se sube el archivo. */
  empresaNombre: string | null;
}

export interface OrdenVentaMapeada {
  idOv: string;
  proyecto: string | null;
  cliente: string | null;
  total: number | null;
  fechaOv: string | null; // ISO
  /** Nombre de la empresa tal como lo manda la API (campo "empresa") --
   * mismo criterio que empresaNombre en OrdenCompraMapeada. */
  empresaNombre: string | null;
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

/** Tipo_orden trae literalmente "Compra" o "Servicio" -- confirmado contra
 * la API real, no un valor "OC"/"OS" directo. Se mantienen los alias
 * (Tipo/tipo/Tipo_Orden con "OC"/"OS") por si algún registro viejo o la
 * carga manual los trae en ese formato. */
export function mapearOrdenCompraDesdeApi(json: Record<string, unknown>): OrdenCompraMapeada {
  const tipoRaw = String(json.Tipo_orden ?? json.Tipo ?? json.tipo ?? json.Tipo_Orden ?? "").trim().toUpperCase();
  return {
    idOrden: String(json.Id_Orden ?? json.id_orden ?? "").trim(),
    tipo: tipoRaw === "OS" || tipoRaw === "SERVICIO" ? "OS" : "OC",
    proyecto: json.Proyecto ? String(json.Proyecto).trim() : null,
    proveedor: json.Proveedor ? String(json.Proveedor).trim() : null,
    total: aNumeroONull(json.TOTAL ?? json.Total ?? json.total),
    fechaCreacion: aFechaIso(json.Creado ?? json.creado),
    empresaNombre: json.Empresa_solicitante ? String(json.Empresa_solicitante).trim() : null,
  };
}

export function mapearOrdenVentaDesdeApi(json: Record<string, unknown>): OrdenVentaMapeada {
  const nombre = json.Cliente_nombre ? String(json.Cliente_nombre).trim() : "";
  const apellido = json.Cliente_apellido ? String(json.Cliente_apellido).trim() : "";
  const cliente = [nombre, apellido].filter(Boolean).join(" ") || (json.Cliente ? String(json.Cliente).trim() : "") || null;
  return {
    idOv: String(json.Folio_orden_venta ?? json["Id OV"] ?? json.Id_cotizacion ?? json.id_ov ?? "").trim(),
    proyecto: json.Project ? String(json.Project).trim() : json.Proyecto ? String(json.Proyecto).trim() : null,
    cliente,
    total: aNumeroONull(json.OV_Subtotal ?? json.Total ?? json.total),
    fechaOv: aFechaIso(json.FechaOV ?? json.fechaOV ?? json.fecha_ov),
    empresaNombre: json.empresa ? String(json.empresa).trim() : null,
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
    empresaNombre: null,
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
    empresaNombre: null,
  };
}

export { periodoDeFecha };
