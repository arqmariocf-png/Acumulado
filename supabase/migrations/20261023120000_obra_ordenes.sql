-- Cada gasto de la obra con su liga (23-oct-2026, Mario: "en proyecto y
-- resumen físico-financiero genera los hipervínculos para poder ver cada
-- gráfica y cada gasto que incluye"). fn_obra_gasto solo daba totales; esta
-- lista cada OC/OS de la obra (mismo cruce por nombre y organización que
-- fn_obra_gasto_backoffice) con pagado, saldo y estatus, para que la pestaña
-- de la obra las muestre una por una con liga a la orden.
--
-- Ya aplicado en producción (obra_ordenes).

create or replace function public.fn_obra_ordenes(p_proyecto uuid)
returns table (
  id uuid, id_orden text, tipo text, empresa_codigo text, proveedor text, fecha_creacion date,
  total numeric, pagado numeric, saldo numeric, pagada boolean, estatus text, fuente text
)
language sql stable security definer set search_path = public as $$
  with obra as (
    select public.normalizar_texto_sql(p.nombre) as clave, e.grupo_id
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
     where p.id = p_proyecto
       and public.auth_rol()::text in ('admin', 'corporativo', 'direccion', 'empresa')
       and public.auth_ve_proyecto(p_proyecto)
  )
  select o.id, o.id_orden, o.tipo, e.codigo, o.proveedor, o.fecha_creacion,
         v.total, coalesce(v.pagado, 0), coalesce(v.saldo, v.total),
         (coalesce(v.pagada_backoffice, false) or coalesce(v.saldo, v.total) <= 0.01),
         coalesce(o.estatus_backoffice, case when o.autorizada_en is not null then 'Autorizada' else 'Por autorizar' end),
         o.fuente
    from obra
    join public.ordenes_compra o on public.normalizar_texto_sql(o.proyecto) = obra.clave
    join public.empresas e on e.id = o.empresa_id and e.grupo_id = obra.grupo_id
    join public.v_oc_pagos v on v.id = o.id
   where o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
   order by o.fecha_creacion desc, o.id_orden desc
$$;
revoke all on function public.fn_obra_ordenes(uuid) from public, anon;
grant execute on function public.fn_obra_ordenes(uuid) to authenticated;
