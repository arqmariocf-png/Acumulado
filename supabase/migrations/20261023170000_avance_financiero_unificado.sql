-- Un solo avance financiero (23-oct-2026, Mario: "el avance financiero en el
-- área de finanzas y en operaciones no cuadra y debería ser el mismo").
-- Finanzas › Avance financiero de obras y Operación › Resumen físico-financiero
-- (de cada obra y de todas) sacaban lo real de dos cálculos distintos: uno con
-- OC a subtotal sin IVA por mes y categoría (fn_avance_financiero_base) y otro
-- con el TOTAL con IVA de la OC y pagado todo o nada (fn_obra_gasto_backoffice);
-- además el resumen sumaba las compras del control de obra sin OC y Finanzas no,
-- y el presupuesto salía de tablas distintas (obra_presupuesto por categoría vs
-- proyecto_controles).
--
-- Ahora: `fn_avance_financiero_real()` es LA fuente de lo real por obra, mes,
-- categoría y origen ('oc' a subtotal sin IVA con pagado en proporción,
-- 'mano_obra' de la API del backoffice, 'control' = compras del control de obra
-- sin OC ligada); `fn_avance_financiero_base()` la agrupa (misma firma) y
-- `fn_obra_gasto_backoffice()` toma de ahí oc_total / oc_pagado / mo_total. El
-- presupuesto en las dos pantallas = el capturado por categoría
-- (obra_presupuesto) y, si no hay, el de los controles de obra.
--
-- Ya aplicado en producción (avance_financiero_unificado).

create or replace function public.fn_avance_financiero_real()
returns table (proyecto_id uuid, mes date, categoria text, origen text, monto_real numeric, pagado numeric)
language sql stable security definer set search_path = public as $$
  with obras as materialized (
    select p.id, public.normalizar_texto_sql(p.nombre) as clave, e.grupo_id
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
  ), oc as materialized (
    select ob.id as proyecto_id, o.id, o.tipo,
           date_trunc('month', coalesce(o.fecha_creacion, o.created_at::date))::date as mes
      from public.ordenes_compra o
      join public.empresas e on e.id = o.empresa_id
      join obras ob on ob.clave = public.normalizar_texto_sql(o.proyecto) and ob.grupo_id = e.grupo_id
     where o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
       and coalesce(btrim(o.proyecto), '') <> ''
  ), montos as materialized (
    select oc.id,
           coalesce(i.subtotal, v.total / 1.16, 0) as subtotal,
           case when coalesce(v.pagada_backoffice, false) or coalesce(v.saldo, v.total) <= 0.01 then 1::numeric
                else greatest(least((coalesce(v.total, 0) - coalesce(v.saldo, v.total, 0)) / nullif(v.total, 0), 1), 0) end as frac_pagada
      from oc
      join public.v_oc_pagos v on v.id = oc.id
      left join public.v_oc_importes i on i.orden_compra_id = oc.id
  ), lineas as (
    select oc.id, public.fn_categoria_partida_obra(public.normalizar_texto_sql(l.item), oc.tipo) as categoria,
           sum(abs(coalesce(l.cantidad, 0) * coalesce(l.costo, 0))) as peso
      from oc join public.ordenes_compra_lineas l on l.orden_compra_id = oc.id
     group by 1, 2
  ), reparto as (
    select oc.proyecto_id, oc.mes, oc.id,
           coalesce(li.categoria, case when oc.tipo = 'OS' then 'subcontratos' else 'materiales' end) as categoria,
           coalesce(li.peso / nullif(sum(li.peso) over (partition by oc.id), 0),
                    1::numeric / count(*) over (partition by oc.id)) as frac
      from oc left join lineas li on li.id = oc.id
  ), oc_real as (
    select r.proyecto_id, r.mes, r.categoria, sum(m.subtotal * r.frac) as monto_real, sum(m.subtotal * r.frac * m.frac_pagada) as pagado
      from reparto r join montos m on m.id = r.id
     group by 1, 2, 3
  ), mo as (
    select ob.id as proyecto_id,
           date_trunc('month', coalesce((r.datos ->> 'Fecha_fin')::date, (r.datos ->> 'Fecha_inicio')::date))::date as mes,
           sum(coalesce((r.datos ->> 'Monto')::numeric, 0)) as monto
      from public.nomina_externa_renglones r
      join public.nomina_externa_origenes o on o.origen = r.origen
      join obras ob on ob.clave = public.normalizar_texto_sql(r.datos ->> 'Proyecto') and ob.grupo_id = o.grupo_id
     where r.origen = 'mano_obra'
     group by 1, 2
  ), control as (
    -- Compras capturadas en el control de obra sin OC ligada (las ligadas ya van en la OC).
    select pc.proyecto_id, date_trunc('month', cc.fecha)::date as mes,
           coalesce(public.fn_categoria_partida_obra(public.normalizar_texto_sql(concat_ws(' ', cc.categoria, cc.descripcion)), 'OC'), 'materiales') as categoria,
           sum(cc.importe) as monto, sum(cc.importe) filter (where cc.estatus = 'pagado') as pagado
      from public.proyecto_control_compras cc
      join public.proyecto_controles pc on pc.id = cc.control_id
     where cc.orden_compra_id is null
     group by 1, 2, 3
  )
  select proyecto_id, mes, categoria, 'oc', round(monto_real, 2), round(pagado, 2) from oc_real
  union all
  select proyecto_id, mes, 'mano_obra', 'mano_obra', round(monto, 2), round(monto, 2) from mo where mes is not null
  union all
  select proyecto_id, mes, categoria, 'control', round(monto, 2), round(coalesce(pagado, 0), 2) from control
$$;
revoke all on function public.fn_avance_financiero_real() from public, anon, authenticated;

create or replace function public.fn_avance_financiero_base()
returns table (proyecto_id uuid, mes date, categoria text, monto_real numeric, pagado numeric)
language sql stable security definer set search_path = public as $$
  select r.proyecto_id, r.mes, r.categoria, sum(r.monto_real), sum(r.pagado)
    from public.fn_avance_financiero_real() r
   group by 1, 2, 3
$$;
revoke all on function public.fn_avance_financiero_base() from public, anon, authenticated;

-- El gasto de la obra para el resumen físico-financiero sale del mismo cálculo.
create or replace function public.fn_obra_gasto_backoffice(p_proyecto uuid default null)
returns table (proyecto_id uuid, oc_num integer, oc_total numeric, oc_pagado numeric,
               mo_total numeric, mo_semanas jsonb, mo_partidas jsonb)
language sql stable security definer set search_path = public as $$
  with obras as materialized (
    select p.id, public.normalizar_texto_sql(p.nombre) as clave, e.grupo_id
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
     where p_proyecto is null or p.id = p_proyecto
  ), real as materialized (
    select r.* from public.fn_avance_financiero_real() r
     where r.proyecto_id in (select id from obras)
  ), oc as materialized (
    -- La clave se calcula una vez por OC (normalizar por fila dentro del join tardaba 12 s).
    select o.id, public.normalizar_texto_sql(o.proyecto) as clave, e.grupo_id
      from public.ordenes_compra o
      join public.empresas e on e.id = o.empresa_id
     where o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
       and coalesce(btrim(o.proyecto), '') <> ''
  ), oc_num as (
    select ob.id as proyecto_id, count(*)::int as n
      from obras ob join oc on oc.clave = ob.clave and oc.grupo_id = ob.grupo_id
     group by ob.id
  ), oc_obra as (
    select r.proyecto_id, sum(r.monto_real) as total, sum(r.pagado) as pagado
      from real r where r.origen = 'oc' group by r.proyecto_id
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
  select ob.id, coalesce(n.n, 0), coalesce(oc_obra.total, 0), coalesce(oc_obra.pagado, 0),
         coalesce(ms.total, 0), coalesce(ms.semanas, '[]'::jsonb), coalesce(mp.partidas, '[]'::jsonb)
    from obras ob
    left join oc_num n on n.proyecto_id = ob.id
    left join oc_obra on oc_obra.proyecto_id = ob.id
    left join mo_sem ms on ms.proyecto_id = ob.id
    left join mo_par mp on mp.proyecto_id = ob.id
   where oc_obra.proyecto_id is not null or ms.proyecto_id is not null
$$;
revoke execute on function public.fn_obra_gasto_backoffice(uuid) from public, anon, authenticated;

-- Presupuesto del resumen de todas las obras: el capturado por categoría y, si no, el de los controles.
create or replace function public.fn_resumen_obras_director()
returns table (proyecto_id uuid, nombre text, empresa_codigo text, responsable text, presupuesto numeric, materiales numeric, materiales_pagados numeric,
               nomina numeric, tarjetas integer, hechas integer, requisiciones jsonb, pu jsonb, oc_num integer, oc_total numeric, oc_pagado numeric, mo_total numeric)
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
  ), presup as (
    select op.proyecto_id, sum(op.monto) as presupuesto
    from public.obra_presupuesto op group by op.proyecto_id
  ), compras as (
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
  ), gasto as (
    select * from public.fn_obra_gasto_backoffice(null)
  )
  select p.id, p.nombre, e.codigo, (select pr.nombre from public.profiles pr where pr.id = p.responsable_id),
         coalesce(nullif(pp.presupuesto, 0), c.presupuesto, 0), coalesce(cm.materiales, 0), coalesce(cm.pagados, 0), coalesce(n.nomina, 0),
         coalesce(t.total, 0), coalesce(t.hechas, 0), coalesce(r.lista, '[]'::jsonb), coalesce(u.lista, '[]'::jsonb),
         coalesce(g.oc_num, 0), coalesce(g.oc_total, 0), coalesce(g.oc_pagado, 0), coalesce(g.mo_total, 0)
  from public.proyectos p
  join public.empresas e on e.id = p.empresa_id
  left join tareas t on t.proyecto_id = p.id
  left join controles c on c.proyecto_id = p.id
  left join presup pp on pp.proyecto_id = p.id
  left join compras cm on cm.proyecto_id = p.id
  left join nomina n on n.proyecto_id = p.id
  left join reqs r on r.proyecto_id = p.id
  left join pus u on u.proyecto_id = p.id
  left join gasto g on g.proyecto_id = p.id
  where p.activo
    and e.id = any (public.auth_empresas_organizacion())
    and (public.auth_admin_global()
         or (public.auth_rol()::text in ('direccion', 'empresa') and e.id = any (public.auth_empresas_alcance())))
    and (c.presupuesto is not null or pp.presupuesto is not null or t.total is not null or r.lista is not null or u.lista is not null or g.proyecto_id is not null)
  order by p.nombre
$$;

-- Finanzas: cada obra trae también el presupuesto de sus controles de obra
-- (se usa cuando no hay presupuesto capturado por categoría).
create or replace function public.fn_avance_financiero()
returns jsonb
language sql stable security definer set search_path = public as $$
  with alcance as materialized (
    select p.id, p.nombre, p.empresa_id, e.codigo as empresa_codigo, e.nombre as empresa_nombre
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
     where p.activo
       and e.id = any (public.auth_empresas_organizacion())
       and (public.auth_admin_global()
            or (public.auth_rol()::text in ('direccion', 'empresa', 'admin') and e.id = any (public.auth_empresas_alcance())))
  ), ultima as (
    select distinct on (c.tablero_id) c.tablero_id, c.id as columna_id
      from public.tablero_columnas c order by c.tablero_id, c.orden desc
  ), tareas as (
    select tb.proyecto_id, count(t.id)::int as total, count(t.id) filter (where t.columna_id = u.columna_id)::int as hechas
      from public.tableros tb
      join public.tarjetas t on t.tablero_id = tb.id and not t.archivada and t.eliminada_en is null
      left join ultima u on u.tablero_id = tb.id
     where not tb.archivado and tb.proyecto_id in (select id from alcance)
     group by tb.proyecto_id
  ), controles as (
    select pc.proyecto_id, sum(pc.presupuesto) as presupuesto
      from public.proyecto_controles pc where pc.proyecto_id in (select id from alcance) group by pc.proyecto_id
  ), reales as materialized (
    select b.* from public.fn_avance_financiero_base() b where b.proyecto_id in (select id from alcance)
  )
  select jsonb_build_object(
    'obras', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'nombre', a.nombre, 'empresa_id', a.empresa_id, 'empresa_codigo', a.empresa_codigo,
        'empresa_nombre', a.empresa_nombre, 'tareas', coalesce(t.total, 0), 'hechas', coalesce(t.hechas, 0),
        'presupuesto_control', coalesce(c.presupuesto, 0)) order by a.nombre)
      from alcance a left join tareas t on t.proyecto_id = a.id left join controles c on c.proyecto_id = a.id), '[]'::jsonb),
    'real', coalesce((select jsonb_agg(jsonb_build_object(
        'proyecto_id', r.proyecto_id, 'mes', to_char(r.mes, 'YYYY-MM'), 'categoria', r.categoria, 'real', r.monto_real, 'pagado', r.pagado))
      from reales r), '[]'::jsonb))
$$;
revoke all on function public.fn_avance_financiero() from public, anon;
grant execute on function public.fn_avance_financiero() to authenticated;
