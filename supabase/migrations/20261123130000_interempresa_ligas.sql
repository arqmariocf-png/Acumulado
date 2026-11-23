-- 23-nov-2026, Mario: "de las órdenes de venta y órdenes de compra, necesito
-- que se agregue una columna en donde se registre en qué OC u OV quedó
-- registrado, para no duplicar". Una sola función devuelve, para cada orden de
-- la organización, sus ligas inter empresa en los dos sentidos:
--   relacion 'genera' = lo que se creó A PARTIR de esta orden
--     (OC/OS origen → OV inter empresa y OC/OS de la compradora; OV → OC/OS).
--   relacion 'origen' = de qué orden nació esta.
-- Canceladas y rechazadas no cuentan como "genera" (se puede volver a generar).
-- Ya aplicada en producción como `interempresa_ligas`.
create or replace function public.fn_interempresa_ligas()
returns table(orden_id uuid, es_venta boolean, relacion text, liga_id uuid, liga_tipo text, liga_folio text, liga_empresa_id uuid)
language sql stable security definer set search_path = public as $$
  with alc as (select public.auth_empresas_organizacion() as e)
  -- OC/OS origen → OV inter empresa generada
  select ov.interempresa_origen_id, false, 'genera', ov.id, 'OV'::text, ov.id_ov, ov.empresa_id
    from public.ordenes_venta ov, alc
   where ov.interempresa_origen_id is not null and ov.cancelada_en is null and ov.empresa_id = any (alc.e)
  union all
  -- OC/OS origen → OC/OS generada para la empresa compradora
  select oc.interempresa_origen_id, false, 'genera', oc.id, oc.tipo, oc.id_orden, oc.empresa_id
    from public.ordenes_compra oc, alc
   where oc.interempresa_origen_id is not null and oc.rechazada_en is null
     and coalesce(oc.estatus_backoffice, '') not ilike 'cancel%' and oc.empresa_id = any (alc.e)
  union all
  -- OV → OC/OS generada desde la OV
  select oc.interempresa_ov_id, true, 'genera', oc.id, oc.tipo, oc.id_orden, oc.empresa_id
    from public.ordenes_compra oc, alc
   where oc.interempresa_ov_id is not null and oc.rechazada_en is null
     and coalesce(oc.estatus_backoffice, '') not ilike 'cancel%' and oc.empresa_id = any (alc.e)
  union all
  -- OV inter empresa ← la OC/OS de origen
  select ov.id, true, 'origen', o.id, o.tipo, o.id_orden, o.empresa_id
    from public.ordenes_venta ov join public.ordenes_compra o on o.id = ov.interempresa_origen_id, alc
   where ov.empresa_id = any (alc.e)
  union all
  -- OC/OS de la compradora ← la OC/OS de origen
  select oc.id, false, 'origen', o.id, o.tipo, o.id_orden, o.empresa_id
    from public.ordenes_compra oc join public.ordenes_compra o on o.id = oc.interempresa_origen_id, alc
   where oc.empresa_id = any (alc.e)
  union all
  -- OC/OS generada desde una OV ← esa OV
  select oc.id, false, 'origen', ov.id, 'OV'::text, ov.id_ov, ov.empresa_id
    from public.ordenes_compra oc join public.ordenes_venta ov on ov.id = oc.interempresa_ov_id, alc
   where oc.empresa_id = any (alc.e);
$$;
revoke all on function public.fn_interempresa_ligas() from public;
grant execute on function public.fn_interempresa_ligas() to authenticated, service_role;
