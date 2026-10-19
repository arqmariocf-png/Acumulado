-- Resumen físico-financiero con lo real del backoffice (19-oct-2026, Mario:
-- "sí, agrégalas [las OC] y también la parte del módulo de mano de obra, ya
-- que tienen presupuestos autorizados y montos ejercidos a la semana. Este
-- reporte también autorízalo a Laura como parte de finanzas").
--
--   * fn_obra_gasto_backoffice(proyecto|null): por obra, las OC/OS cuyo
--     proyecto se llama igual (normalizar_texto_sql; sin canceladas ni
--     rechazadas; pagado = pagada en el backoffice o sin saldo) y la mano de
--     obra pagada de la API api_MO_period_aut (nomina_externa_renglones
--     'mano_obra') por semana y por partida. Interna (revocada).
--   * fn_obra_gasto(proyecto): lo mismo para la pestaña de la obra; solo a
--     quien ve el resumen (admin, corporativo, dirección, empresa) y ve la obra.
--   * fn_resumen_obras_director(): ahora trae oc_total, oc_pagado, mo_total y
--     `materiales` = compras capturadas en el control de obra SIN OC ligada
--     (para no contar dos veces). La ve el admin maestro y también dirección
--     (Laura) en las empresas de su alcance.
-- El presupuesto sigue saliendo de los controles de obra: la API de mano de
-- obra solo trae lo pagado por semana (los presupuestos autorizados de mano
-- de obra no tienen endpoint: api_MO_aut, _cat, _presupuesto… dan 404).
-- Ya aplicado en producción (resumen_obra_oc_mano_obra).

create or replace function public.fn_obra_gasto_backoffice(p_proyecto uuid default null)
returns table (proyecto_id uuid, oc_num integer, oc_total numeric, oc_pagado numeric,
               mo_total numeric, mo_semanas jsonb, mo_partidas jsonb)
language sql stable security definer set search_path = public as $$
  -- "materialized": cada parte se calcula una vez (unir la vista de pagos
  -- directo con ordenes_compra la reevaluaba y tardaba ~5 s).
  with obras as materialized (
    select p.id, public.normalizar_texto_sql(p.nombre) as clave, e.grupo_id
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
     where p_proyecto is null or p.id = p_proyecto
  ), pagos as materialized (
    select v.id, v.total, (coalesce(v.pagada_backoffice, false) or coalesce(v.saldo, v.total) <= 0.01) as pagada
      from public.v_oc_pagos v
  ), oc as materialized (
    select o.id, public.normalizar_texto_sql(o.proyecto) as clave, e.grupo_id
      from public.ordenes_compra o
      join public.empresas e on e.id = o.empresa_id
     where o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
       and coalesce(btrim(o.proyecto), '') <> ''
  ), oc_obra as (
    select ob.id as proyecto_id, count(*)::int as n, sum(pg.total) as total, sum(pg.total) filter (where pg.pagada) as pagado
      from obras ob join oc on oc.clave = ob.clave and oc.grupo_id = ob.grupo_id
      join pagos pg on pg.id = oc.id
     group by ob.id
  ), mo as materialized (
    select public.normalizar_texto_sql(r.datos ->> 'Proyecto') as clave, o.grupo_id,
           coalesce(nullif(r.datos ->> 'Year', '')::int, extract(year from (r.datos ->> 'Fecha_fin')::date)::int) as anio,
           (r.datos ->> 'Num_sem')::int as semana,
           (r.datos ->> 'Fecha_inicio')::date as inicio, (r.datos ->> 'Fecha_fin')::date as fin,
           coalesce(nullif(btrim(r.datos ->> 'Partida'), ''), 'Sin partida') as partida,
           coalesce((r.datos ->> 'Monto')::numeric, 0) as monto
      from public.nomina_externa_renglones r
      join public.nomina_externa_origenes o on o.origen = r.origen
     where r.origen = 'mano_obra'
  ), mo_obra as (
    select ob.id as proyecto_id, mo.anio, mo.semana, min(mo.inicio) as inicio, max(mo.fin) as fin, mo.partida, sum(mo.monto) as monto
      from obras ob join mo on mo.clave = ob.clave and mo.grupo_id = ob.grupo_id
     group by ob.id, mo.anio, mo.semana, mo.partida
  ), mo_sem as (
    select proyecto_id, sum(monto) as total,
           jsonb_agg(jsonb_build_object('anio', anio, 'semana', semana, 'inicio', inicio, 'fin', fin, 'monto', monto) order by anio desc, semana desc) as semanas
      from (select proyecto_id, anio, semana, min(inicio) as inicio, max(fin) as fin, sum(monto) as monto from mo_obra group by 1, 2, 3) s
     group by proyecto_id
  ), mo_par as (
    select proyecto_id, jsonb_agg(jsonb_build_object('partida', partida, 'monto', monto) order by monto desc) as partidas
      from (select proyecto_id, partida, sum(monto) as monto from mo_obra group by 1, 2) s
     group by proyecto_id
  )
  select ob.id, coalesce(oc_obra.n, 0), coalesce(oc_obra.total, 0), coalesce(oc_obra.pagado, 0),
         coalesce(ms.total, 0), coalesce(ms.semanas, '[]'::jsonb), coalesce(mp.partidas, '[]'::jsonb)
    from obras ob
    left join oc_obra on oc_obra.proyecto_id = ob.id
    left join mo_sem ms on ms.proyecto_id = ob.id
    left join mo_par mp on mp.proyecto_id = ob.id
   where oc_obra.proyecto_id is not null or ms.proyecto_id is not null
$$;
revoke execute on function public.fn_obra_gasto_backoffice(uuid) from public, anon, authenticated;

create or replace function public.fn_obra_gasto(p_proyecto uuid)
returns table (proyecto_id uuid, oc_num integer, oc_total numeric, oc_pagado numeric,
               mo_total numeric, mo_semanas jsonb, mo_partidas jsonb)
language sql stable security definer set search_path = public as $$
  select g.* from public.fn_obra_gasto_backoffice(p_proyecto) g
   where public.auth_rol()::text in ('admin', 'corporativo', 'direccion', 'empresa')
     and public.auth_ve_proyecto(p_proyecto)
$$;
revoke execute on function public.fn_obra_gasto(uuid) from public, anon;
grant execute on function public.fn_obra_gasto(uuid) to authenticated;

drop function if exists public.fn_resumen_obras_director();
create function public.fn_resumen_obras_director()
returns table (
  proyecto_id uuid, nombre text, empresa_codigo text, responsable text,
  presupuesto numeric, materiales numeric, materiales_pagados numeric, nomina numeric,
  tarjetas integer, hechas integer, requisiciones jsonb, pu jsonb,
  oc_num integer, oc_total numeric, oc_pagado numeric, mo_total numeric)
language sql stable security definer set search_path = public as $$
  with ultima as (
    select distinct on (c.tablero_id) c.tablero_id, c.id as columna_id
    from public.tablero_columnas c
    order by c.tablero_id, c.orden desc
  ), tareas as (
    select tb.proyecto_id,
           count(t.id)::int as total,
           count(t.id) filter (where t.columna_id = u.columna_id)::int as hechas
    from public.tableros tb
    join public.tarjetas t on t.tablero_id = tb.id and not t.archivada
    left join ultima u on u.tablero_id = tb.id
    where not tb.archivado and tb.proyecto_id is not null
    group by tb.proyecto_id
  ), controles as (
    select pc.proyecto_id, sum(pc.presupuesto) as presupuesto
    from public.proyecto_controles pc group by pc.proyecto_id
  ), compras as (
    -- Solo lo capturado sin OC ligada: las OC ya cuentan en oc_total.
    select pc.proyecto_id, sum(cc.importe) as materiales,
           sum(cc.importe) filter (where cc.estatus = 'pagado') as pagados
    from public.proyecto_control_compras cc join public.proyecto_controles pc on pc.id = cc.control_id
    where cc.orden_compra_id is null
    group by pc.proyecto_id
  ), nomina as (
    select pc.proyecto_id, sum(n.sueldo) as nomina
    from public.proyecto_control_nomina n join public.proyecto_controles pc on pc.id = n.control_id
    group by pc.proyecto_id
  ), avance as (
    select b.requisicion_id, round(avg(b.avance_pct), 1) as avance_pct
    from public.fn_requisicion_linea_entrega_base() b group by b.requisicion_id
  ), reqs as (
    select r.proyecto_id,
           jsonb_agg(jsonb_build_object('etapa', r.etapa, 'estado', r.estado, 'avance_pct', a.avance_pct)) as lista
    from public.requisiciones r left join avance a on a.requisicion_id = r.id
    group by r.proyecto_id
  ), pus as (
    select pa.proyecto_id,
           jsonb_agg(jsonb_build_object('estado', pa.estado, 'cliente_autorizado_en', pa.cliente_autorizado_en)) as lista
    from public.pu_analisis pa where pa.proyecto_id is not null
    group by pa.proyecto_id
  ), gasto as materialized (
    select * from public.fn_obra_gasto_backoffice(null)
  )
  select p.id, p.nombre, e.codigo, (select pr.nombre from public.profiles pr where pr.id = p.responsable_id),
         coalesce(c.presupuesto, 0), coalesce(cm.materiales, 0), coalesce(cm.pagados, 0), coalesce(n.nomina, 0),
         coalesce(t.total, 0), coalesce(t.hechas, 0), coalesce(r.lista, '[]'::jsonb), coalesce(u.lista, '[]'::jsonb),
         coalesce(g.oc_num, 0), coalesce(g.oc_total, 0), coalesce(g.oc_pagado, 0), coalesce(g.mo_total, 0)
  from public.proyectos p
  join public.empresas e on e.id = p.empresa_id
  left join tareas t on t.proyecto_id = p.id
  left join controles c on c.proyecto_id = p.id
  left join compras cm on cm.proyecto_id = p.id
  left join nomina n on n.proyecto_id = p.id
  left join reqs r on r.proyecto_id = p.id
  left join pus u on u.proyecto_id = p.id
  left join gasto g on g.proyecto_id = p.id
  where p.activo
    and e.id = any (public.auth_empresas_organizacion())
    and (public.auth_admin_global()
         or (public.auth_rol()::text = 'direccion' and e.id = any (public.auth_empresas_alcance())))
    and (c.presupuesto is not null or t.total is not null or r.lista is not null or u.lista is not null or g.proyecto_id is not null)
  order by p.nombre
$$;
revoke all on function public.fn_resumen_obras_director() from public, anon;
grant execute on function public.fn_resumen_obras_director() to authenticated;
