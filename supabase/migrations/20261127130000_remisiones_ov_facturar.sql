-- Timbrar desde Remisiones por facturar (27-nov-2026, Laura: "terminar
-- módulo de facturación con API"). La bandeja de contabilidad ya marcaba la
-- remisión con un CFDI del SAT o un folio a mano; ahora, si la remisión trae
-- su OV, se timbra con factura.com desde ahí mismo (el mismo "Facturar" de la
-- OV) y la remisión queda facturada con ese CFDI. `fn_remisiones_facturacion`
-- no trae la OV (cambiar su tabla de salida obliga a recrearla), así que esta
-- función da la OV de cada remisión con la misma guarda y alcance.
-- Ya aplicado en producción (remisiones_ov_facturar).

create or replace function public.fn_remisiones_ov()
returns table (origen text, id uuid, orden_venta_id uuid, id_ov text)
language sql stable security definer set search_path = public as $$
  select x.origen, x.id, x.orden_venta_id, ov.id_ov
    from (
      select 'almacen'::text as origen, r.id, r.empresa_id, r.orden_venta_id from public.remisiones_salida r where r.orden_venta_id is not null
      union all
      select 'planta', r.id, r.empresa_id, r.orden_venta_id from public.remisiones_produccion r where r.orden_venta_id is not null and r.tipo = 'salida'
    ) x
    join public.ordenes_venta ov on ov.id = x.orden_venta_id
   where public.auth_factura_remisiones()
     and x.empresa_id = any (public.auth_empresas_alcance())
$$;

revoke all on function public.fn_remisiones_ov() from public, anon;
grant execute on function public.fn_remisiones_ov() to authenticated;
