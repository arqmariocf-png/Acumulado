import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { MembreteEmpresa } from "../../lib/cotizacionPlanta";
import { armarProductos } from "../../lib/cotizador";
import type { ContraparteCatalogo, ItemCatalogo } from "../../lib/buscadorCaptura";

// Datos que comparten el cotizador y el CRM de ventas: membrete de la
// empresa que cotiza y su lista de productos (planta, catálogo y vendido)
// con clientes registrados.

export interface Cliente {
  id: string;
  empresa_id: string;
  razon_social: string;
  nombre_comercial: string | null;
  rfc: string | null;
  domicilio: string | null;
  codigo_postal: string | null;
}

export function useEmpresaCotizadora(empresaId: string) {
  return useQuery({
    queryKey: ["cotizador-empresa", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const [e, l] = await Promise.all([
        supabase.from("empresas").select("id, nombre, codigo, rfc, razon_social, domicilio_fiscal, telefono, correo, banco, cuenta_bancaria, clabe, sucursal_bancaria").eq("id", empresaId).maybeSingle(),
        supabase.from("empresas_perfil_legal").select("razon_social, rfc, domicilio_legal, telefono, correo").eq("empresa_id", empresaId).maybeSingle(),
      ]);
      if (e.error) throw e.error;
      const emp = e.data as Record<string, string | null>;
      const leg = (l.error ? {} : l.data ?? {}) as Record<string, string | null>;
      const membrete: MembreteEmpresa = {
        razon_social: emp.razon_social || leg.razon_social,
        domicilio_fiscal: emp.domicilio_fiscal || leg.domicilio_legal,
        telefono: emp.telefono || leg.telefono,
        correo: emp.correo || leg.correo,
        banco: emp.banco,
        cuenta_bancaria: emp.cuenta_bancaria,
        clabe: emp.clabe,
        sucursal_bancaria: emp.sucursal_bancaria,
      };
      return { nombre: emp.nombre ?? "", codigo: emp.codigo ?? "", rfc: emp.rfc || leg.rfc || null, membrete };
    },
  });
}

export function useCatalogoCotizador(empresaId: string) {
  return useQuery({
    queryKey: ["cotizador-productos", empresaId],
    enabled: !!empresaId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [planta, stock, prods, ventas, compras, clientes] = await Promise.all([
        supabase.from("productos_produccion").select("id, nombre, calibre, unidad_medida").eq("empresa_id", empresaId).eq("activo", true),
        supabase.from("v_stock_producto_terminado").select("producto_id, stock_actual, costo_promedio_ponderado, costo_peps").eq("empresa_id", empresaId),
        supabase.from("productos").select("nombre, unidad_medida, costo_referencia, precio_venta, iva_tasa").eq("empresa_id", empresaId).eq("activo", true),
        supabase.rpc("fn_ordenes_catalogo_captura", { p_venta: true, p_empresa: empresaId }),
        supabase.rpc("fn_ordenes_catalogo_captura", { p_venta: false, p_empresa: empresaId }),
        supabase.from("clientes").select("id, empresa_id, razon_social, nombre_comercial, rfc, domicilio, codigo_postal").eq("activo", true).order("razon_social"),
      ]);
      const costos = new Map(((stock.data ?? []) as { producto_id: string; stock_actual: number | null; costo_promedio_ponderado: number | null; costo_peps: number | null }[]).map((s) => [s.producto_id, s]));
      const v = (ventas.data ?? {}) as { contrapartes?: ContraparteCatalogo[]; items?: ItemCatalogo[] };
      const c = (compras.data ?? {}) as { items?: ItemCatalogo[] };
      const productos = armarProductos({
        planta: ((planta.data ?? []) as { id: string; nombre: string; calibre: string | null; unidad_medida: string | null }[]).map((p) => ({ ...p, costo: costos.get(p.id)?.costo_peps ?? costos.get(p.id)?.costo_promedio_ponderado ?? null, existencia: costos.get(p.id)?.stock_actual ?? null })),
        catalogo: (prods.data ?? []) as { nombre: string; unidad_medida: string | null; costo_referencia: number | null; precio_venta: number | null; iva_tasa: number | null }[],
        vendidos: (v.items ?? []).filter((i) => i.misma_empresa),
        compras: c.items ?? [],
      });
      return { productos, contrapartes: v.contrapartes ?? [], clientes: (clientes.data ?? []) as Cliente[] };
    },
  });
}
