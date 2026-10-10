import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { abrirParaImprimir } from "../../lib/imprimir";
import { htmlTicket, type MetodoPago } from "../../lib/puntoVenta";

export interface ProductoVenta {
  id: string;
  nombre: string;
  sku: string | null;
  codigo_barras: string | null;
  unidad_medida: string | null;
  precio_venta: number | null;
  iva_tasa: number;
  existencia: number;
}

export interface Turno {
  id: string;
  empresa_id: string;
  abierto_por: string;
  abierto_por_nombre: string | null;
  abierto_en: string;
  fondo_inicial: number;
  cerrado_en: string | null;
  efectivo_contado: number | null;
  ventas: number;
  canceladas: number;
  efectivo: number;
  tarjeta: number;
  transferencia: number;
  credito: number;
  abonos: number;
  ingresos: number;
  retiros: number;
  efectivo_esperado: number;
  diferencia: number | null;
  notas: string | null;
}

export interface VentaPv {
  id: string;
  empresa_id: string;
  folio: string;
  fecha: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  vendedor_nombre: string | null;
  estado: "pagada" | "credito" | "cancelada";
  entrega: "pendiente" | "parcial" | "entregada";
  requiere_factura: boolean;
  factura_folio: string | null;
  cancelacion_motivo: string | null;
  total: number;
  subtotal: number;
  iva: number;
  utilidad: number;
  pagado: number;
  a_credito: number;
  efectivo: number;
  tarjeta: number;
  transferencia: number;
  cambio: number;
  por_entregar: number;
  partidas: number;
  empresa_codigo: string;
  empresa_nombre: string;
}

export interface LineaVenta {
  id: string;
  descripcion: string;
  sku: string | null;
  unidad: string | null;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  entregado: number;
}

export const dinero = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });

export const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
export const botonPrimario = "rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50";
export const botonSecundario = "rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50";

export function useProductosVenta(empresaId: string) {
  return useQuery({
    queryKey: ["pv-productos", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const [prod, ex] = await Promise.all([
        supabase.from("productos").select("id, nombre, sku, codigo_barras, unidad_medida, precio_venta, iva_tasa").eq("empresa_id", empresaId).eq("activo", true).order("nombre"),
        supabase.from("existencias").select("producto_id, existencia").eq("empresa_id", empresaId),
      ]);
      if (prod.error) throw prod.error;
      if (ex.error) throw ex.error;
      const stock = new Map<string, number>();
      for (const e of ex.data ?? []) stock.set(e.producto_id as string, (stock.get(e.producto_id as string) ?? 0) + Number(e.existencia));
      return (prod.data ?? []).map((p) => ({ ...p, iva_tasa: Number(p.iva_tasa ?? 0.16), existencia: stock.get(p.id as string) ?? 0 })) as ProductoVenta[];
    },
  });
}

export function useTurnoAbierto(empresaId: string, usuarioId: string | undefined) {
  return useQuery({
    queryKey: ["pv-turno", empresaId, usuarioId],
    enabled: !!empresaId && !!usuarioId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_pv_turnos")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("abierto_por", usuarioId!)
        .is("cerrado_en", null)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Turno | null;
    },
  });
}

export function useClientesEmpresa(empresaId: string) {
  return useQuery({
    queryKey: ["pv-clientes", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("clientes").select("id, razon_social, rfc").eq("empresa_id", empresaId).eq("activo", true).order("razon_social");
      if (error) throw error;
      return (data ?? []) as { id: string; razon_social: string; rfc: string | null }[];
    },
  });
}

/** Arma e imprime el ticket de una venta (la ventana se abre durante el clic). */
export async function imprimirTicket(ventaId: string, ventana?: Window | null) {
  const [v, l, p] = await Promise.all([
    supabase.from("v_pv_ventas").select("*").eq("id", ventaId).single(),
    supabase.from("pv_venta_lineas").select("descripcion, cantidad, unidad, precio_unitario, descuento_pct").eq("venta_id", ventaId).order("orden"),
    supabase.from("pv_pagos").select("metodo, monto, recibido, referencia").eq("venta_id", ventaId).order("created_at"),
  ]);
  if (v.error) throw v.error;
  if (l.error) throw l.error;
  if (p.error) throw p.error;
  const venta = v.data as VentaPv & { requiere_factura: boolean };
  const { data: emp } = await supabase.from("empresas").select("razon_social, nombre, rfc").eq("id", venta.empresa_id).maybeSingle();
  const html = htmlTicket({
    empresa: (emp?.razon_social as string) || (emp?.nombre as string) || venta.empresa_nombre,
    rfc: (emp?.rfc as string | null) ?? null,
    folio: venta.folio,
    fecha: fechaHora(venta.fecha),
    vendedor: venta.vendedor_nombre,
    cliente: venta.cliente_nombre,
    lineas: (l.data ?? []).map((x) => ({ descripcion: x.descripcion as string, cantidad: Number(x.cantidad), unidad: x.unidad as string | null, precio: Number(x.precio_unitario), descuentoPct: Number(x.descuento_pct) })),
    pagos: (p.data ?? []).map((x) => ({ metodo: x.metodo as MetodoPago, monto: Number(x.metodo === "efectivo" && x.recibido != null ? x.recibido : x.monto), referencia: x.referencia as string | null })),
    cambio: Number(venta.cambio),
    requiereFactura: venta.requiere_factura,
    cancelada: venta.estado === "cancelada",
  });
  abrirParaImprimir(html, ventana);
}
