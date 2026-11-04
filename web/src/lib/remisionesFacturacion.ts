// Remisiones por facturar (4-nov-2026, Mario: "pásalas al proceso de
// facturación, para que ya solamente tengan que dar click las contadoras").
// Las remisiones de almacén (REM) y las de planta (antes RM) comparten desde
// hoy un folio por empresa, REM-<CODIGO>-000001, y las dos entran a la misma
// bandeja de contabilidad. Puro, sin DOM, con pruebas.

export type OrigenRemision = "almacen" | "planta";
export type FacturaEstado = "por_facturar" | "facturada" | "no_factura" | "no_aplica";

export interface RemisionFacturacion {
  origen: OrigenRemision;
  id: string;
  empresa_id: string;
  empresa_codigo: string;
  empresa_nombre: string;
  folio: string;
  fecha: string;
  cliente: string | null;
  cliente_rfc: string | null;
  proyecto: string | null;
  referencia: string | null;
  estatus: "emitida" | "entregada";
  entregada_en: string | null;
  lineas: number;
  importe: number | null;
  factura_estado: FacturaEstado;
  facturada_en: string | null;
  facturada_por_nombre: string | null;
  cfdi_id: string | null;
  cfdi_folio: string | null;
  cfdi_total: number | null;
  cfdi_fecha: string | null;
  factura_folio: string | null;
  factura_nota: string | null;
}

export interface CfdiEmitido {
  id: string;
  folio: string;
  total: number;
  contraparte: string | null;
  rfc: string | null;
  fecha: string;
  es_complemento_pago?: boolean | null;
  tipo_comprobante?: string | null;
}

/** Folio compartido por almacén y planta: REM-<CODIGO>-000012. */
export function folioRemision(codigoEmpresa: string, numero: number): string {
  return `REM-${codigoEmpresa.trim().toUpperCase()}-${String(Math.max(0, Math.trunc(numero))).padStart(6, "0")}`;
}

/** Ruta en la app de cada remisión según de dónde viene. */
export function rutaRemision(origen: OrigenRemision, id: string): string {
  return origen === "planta" ? `/produccion/remisiones/${id}` : `/inventario/remisiones/${id}`;
}

export const ETIQUETA_ESTADO: Record<FacturaEstado, string> = {
  por_facturar: "Por facturar",
  facturada: "Facturada",
  no_factura: "No lleva factura",
  no_aplica: "No aplica",
};

export const ETIQUETA_ORIGEN: Record<OrigenRemision, string> = { almacen: "Almacén", planta: "Planta" };

function sinAcentos(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Filtro de la bandeja: estado, empresa y texto (folio, cliente, referencia, proyecto). */
export function filtrarRemisiones(
  filas: RemisionFacturacion[],
  opciones: { estado?: FacturaEstado | "todas"; empresaId?: string | null; texto?: string },
): RemisionFacturacion[] {
  const q = sinAcentos((opciones.texto ?? "").trim());
  return filas.filter((r) => {
    if (opciones.estado && opciones.estado !== "todas" && r.factura_estado !== opciones.estado) return false;
    if (opciones.empresaId && r.empresa_id !== opciones.empresaId) return false;
    if (!q) return true;
    return [r.folio, r.cliente, r.referencia, r.proyecto, r.factura_folio, r.cfdi_folio, r.empresa_codigo].some((v) => v && sinAcentos(v).includes(q));
  });
}

export interface ResumenEmpresaFacturacion {
  empresa_id: string;
  empresa_codigo: string;
  empresa_nombre: string;
  por_facturar: number;
  entregadas_sin_factura: number;
  importe_por_facturar: number;
  facturadas: number;
}

/** Tarjetas por empresa: cuántas esperan factura, cuántas ya entregadas y el importe conocido. */
export function resumenPorEmpresa(filas: RemisionFacturacion[]): ResumenEmpresaFacturacion[] {
  const mapa = new Map<string, ResumenEmpresaFacturacion>();
  for (const r of filas) {
    let e = mapa.get(r.empresa_id);
    if (!e) {
      e = { empresa_id: r.empresa_id, empresa_codigo: r.empresa_codigo, empresa_nombre: r.empresa_nombre, por_facturar: 0, entregadas_sin_factura: 0, importe_por_facturar: 0, facturadas: 0 };
      mapa.set(r.empresa_id, e);
    }
    if (r.factura_estado === "por_facturar") {
      e.por_facturar++;
      if (r.estatus === "entregada") e.entregadas_sin_factura++;
      e.importe_por_facturar += Number(r.importe ?? 0);
    } else if (r.factura_estado === "facturada") {
      e.facturadas++;
    }
  }
  return [...mapa.values()].sort((a, b) => b.por_facturar - a.por_facturar || a.empresa_codigo.localeCompare(b.empresa_codigo));
}

/** CFDI emitidos que podrían ser la factura de una remisión: primero los del
 * mismo RFC o nombre del cliente, luego los del mismo importe (±$1), luego los
 * más cercanos a la fecha de la remisión. Fuera los complementos de pago y los
 * que no son ingreso. */
export function ordenarCfdiParaRemision(cfdis: CfdiEmitido[], remision: Pick<RemisionFacturacion, "cliente" | "cliente_rfc" | "importe" | "fecha">): CfdiEmitido[] {
  const nombre = sinAcentos(remision.cliente ?? "");
  const rfc = (remision.cliente_rfc ?? "").trim().toUpperCase();
  const importe = remision.importe != null ? Number(remision.importe) : null;
  const fechaRem = Date.parse(remision.fecha);
  const puntos = (c: CfdiEmitido): number => {
    let p = 0;
    if (rfc && (c.rfc ?? "").toUpperCase() === rfc) p += 100;
    else if (nombre && c.contraparte && (sinAcentos(c.contraparte).includes(nombre) || nombre.includes(sinAcentos(c.contraparte)))) p += 60;
    if (importe != null && importe > 0) {
      if (Math.abs(Number(c.total) - importe) <= 1) p += 50;
      else if (Math.abs(Number(c.total) - importe * 1.16) <= 1) p += 50;
    }
    return p;
  };
  return cfdis
    .filter((c) => !c.es_complemento_pago && (c.tipo_comprobante == null || c.tipo_comprobante === "I"))
    .map((c) => ({ c, p: puntos(c), d: Math.abs(Date.parse(c.fecha) - fechaRem) }))
    .sort((a, b) => b.p - a.p || a.d - b.d || b.c.fecha.localeCompare(a.c.fecha))
    .map((x) => x.c);
}

/** Texto corto de cómo quedó facturada. */
export function textoFactura(r: Pick<RemisionFacturacion, "factura_estado" | "factura_folio" | "factura_nota"> & Partial<Pick<RemisionFacturacion, "cfdi_folio" | "cfdi_total">>): string {
  if (r.factura_estado === "facturada") {
    const folio = r.factura_folio || r.cfdi_folio || "";
    const total = r.cfdi_total != null ? ` · $${Number(r.cfdi_total).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "";
    return `Facturada${folio ? ` · ${folio}` : ""}${total}`;
  }
  if (r.factura_estado === "no_factura") return `No lleva factura${r.factura_nota ? ` · ${r.factura_nota}` : ""}`;
  if (r.factura_estado === "no_aplica") return "No aplica";
  return "Por facturar";
}
