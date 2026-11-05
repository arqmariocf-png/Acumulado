-- De dónde sale cada cifra del avance financiero (5-nov-2026, Mario: "en el
-- avance financiero de obras generar hipervínculos en todos los gastos,
-- ventanas y menús para que podamos consultar de dónde viene esa información
-- para corroborar qué es correcto"). fn_avance_financiero_real() entrega lo
-- real por obra, mes y categoría ya sumado; esta función devuelve los
-- renglones que forman esa suma: cada OC/OS (repartida por categoría según sus
-- partidas, igual que allá), cada semana de mano de obra de la API y cada
-- compra del control de obra sin OC. Mismo alcance que fn_avance_financiero:
-- admin maestro, o dirección/empresa/admin en las empresas de su alcance.
-- Con p_proyecto null trae todas las obras del alcance; p_mes y p_categoria
-- acotan.

create or replace function public.fn_avance_financiero_detalle(p_proyecto uuid default null, p_mes date default null, p_categoria text default null)
returns table(
  origen text, proyecto_id uuid, obra text, empresa_id uuid, empresa_codigo text,
  mes date, categoria text,
  orden_compra_id uuid, folio text, tipo text, proveedor text, fecha date, fuente text, estatus text,
  control_id uuid, descripcion text, semana text,
  monto numeric, pagado numeric
)
language sql stable security definer set search_path = public as $$
  with obras as materialized (
    select p.id, p.nombre, p.empresa_id, e.codigo as empresa_codigo, public.normalizar_texto_sql(p.nombre) as clave, e.grupo_id
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
     where (p_proyecto is null or p.id = p_proyecto)
       and e.id = any (public.auth_empresas_organizacion())
       and (public.auth_admin_global()
            or (public.auth_rol()::text in ('direccion', 'empresa', 'admin') and e.id = any (public.auth_empresas_alcance())))
  ), oc as materialized (
    select ob.id as proyecto_id, ob.nombre as obra, ob.empresa_id, ob.empresa_codigo,
           o.id, o.id_orden, o.tipo, o.proveedor, o.fuente,
           coalesce(o.estatus_backoffice, case when o.rechazada_en is not null then 'Cancelada' when o.autorizada_en is not null then 'Autorizada' else 'Por autorizar' end) as estatus,
           coalesce(o.fecha_creacion, o.created_at::date) as fecha,
           date_trunc('month', coalesce(o.fecha_creacion, o.created_at::date))::date as mes
      from public.ordenes_compra o
      join obras ob on ob.clave = public.normalizar_texto_sql(o.proyecto) and ob.empresa_id = o.empresa_id
     where o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
       and coalesce(btrim(o.proyecto), '') <> ''
       and (p_mes is null or date_trunc('month', coalesce(o.fecha_creacion, o.created_at::date))::date = date_trunc('month', p_mes)::date)
  ), oc_unicas as materialized (
    -- Una OC puede empatar con dos obras del mismo nombre (una activa y una
    -- desactivada): el monto y el reparto se calculan una vez por OC.
    select distinct id, tipo from oc
  ), montos as materialized (
    select oc.id,
           coalesce(i.subtotal, v.total / 1.16, 0) as subtotal,
           case when coalesce(v.pagada_backoffice, false) or coalesce(v.saldo, v.total) <= 0.01 then 1::numeric
                else greatest(least((coalesce(v.total, 0) - coalesce(v.saldo, v.total, 0)) / nullif(v.total, 0), 1), 0) end as frac_pagada
      from oc_unicas oc
      join public.v_oc_pagos v on v.id = oc.id
      left join public.v_oc_importes i on i.orden_compra_id = oc.id
  ), lineas as (
    select oc.id, public.fn_categoria_partida_obra(public.normalizar_texto_sql(l.item), oc.tipo) as categoria,
           sum(abs(coalesce(l.cantidad, 0) * coalesce(l.costo, 0))) as peso
      from oc_unicas oc join public.ordenes_compra_lineas l on l.orden_compra_id = oc.id
     group by 1, 2
  ), reparto as (
    select oc.id,
           coalesce(li.categoria, case when oc.tipo = 'OS' then 'subcontratos' else 'materiales' end) as categoria,
           coalesce(li.peso / nullif(sum(li.peso) over (partition by oc.id), 0),
                    1::numeric / count(*) over (partition by oc.id)) as frac
      from oc_unicas oc left join lineas li on li.id = oc.id
  ), oc_detalle as (
    select 'oc'::text as origen, oc.proyecto_id, oc.obra, oc.empresa_id, oc.empresa_codigo, oc.mes, r.categoria,
           oc.id as orden_compra_id, oc.id_orden as folio, oc.tipo, oc.proveedor, oc.fecha, oc.fuente, oc.estatus,
           null::uuid as control_id, null::text as descripcion, null::text as semana,
           round(sum(m.subtotal * r.frac), 2) as monto, round(sum(m.subtotal * r.frac * m.frac_pagada), 2) as pagado
      from reparto r join oc on oc.id = r.id join montos m on m.id = r.id
     group by oc.proyecto_id, oc.obra, oc.empresa_id, oc.empresa_codigo, oc.mes, r.categoria, oc.id, oc.id_orden, oc.tipo, oc.proveedor, oc.fecha, oc.fuente, oc.estatus
  ), mo as (
    select 'mano_obra'::text as origen, ob.id as proyecto_id, ob.nombre as obra, ob.empresa_id, ob.empresa_codigo,
           date_trunc('month', coalesce((r.datos ->> 'Fecha_fin')::date, (r.datos ->> 'Fecha_inicio')::date))::date as mes,
           'mano_obra'::text as categoria,
           null::uuid, null::text, null::text, nullif(r.datos ->> 'Empresa', '') as proveedor,
           coalesce((r.datos ->> 'Fecha_fin')::date, (r.datos ->> 'Fecha_inicio')::date) as fecha,
           'api'::text as fuente, 'Pagada'::text as estatus,
           null::uuid as control_id, nullif(r.datos ->> 'Partida', '') as descripcion,
           concat_ws(' a ', r.datos ->> 'Fecha_inicio', r.datos ->> 'Fecha_fin') as semana,
           round(coalesce((r.datos ->> 'Monto')::numeric, 0), 2) as monto, round(coalesce((r.datos ->> 'Monto')::numeric, 0), 2) as pagado
      from public.nomina_externa_renglones r
      join public.nomina_externa_origenes o on o.origen = r.origen
      join obras ob on ob.clave = public.normalizar_texto_sql(r.datos ->> 'Proyecto') and ob.grupo_id = o.grupo_id
     where r.origen = 'mano_obra'
       and coalesce((r.datos ->> 'Fecha_fin')::date, (r.datos ->> 'Fecha_inicio')::date) is not null
  ), control as (
    select 'control'::text as origen, ob.id as proyecto_id, ob.nombre as obra, ob.empresa_id, ob.empresa_codigo,
           date_trunc('month', cc.fecha)::date as mes,
           coalesce(public.fn_categoria_partida_obra(public.normalizar_texto_sql(concat_ws(' ', cc.categoria, cc.descripcion)), 'OC'), 'materiales') as categoria,
           null::uuid, cc.folio, null::text, cc.proveedor, cc.fecha, 'control'::text, cc.estatus,
           pc.id as control_id, concat_ws(' · ', pc.especialidad, cc.descripcion) as descripcion, null::text,
           round(cc.importe, 2), case when cc.estatus = 'pagado' then round(cc.importe, 2) else 0 end
      from public.proyecto_control_compras cc
      join public.proyecto_controles pc on pc.id = cc.control_id
      join obras ob on ob.id = pc.proyecto_id
     where cc.orden_compra_id is null
  ), todo as (
    select * from oc_detalle
    union all select * from mo
    union all select * from control
  )
  select origen, proyecto_id, obra, empresa_id, empresa_codigo, mes, categoria,
         orden_compra_id, folio, tipo, proveedor, fecha, fuente, estatus, control_id, descripcion, semana,
         monto, coalesce(pagado, 0)
    from todo
   where (p_mes is null or mes = date_trunc('month', p_mes)::date)
     and (p_categoria is null or categoria = p_categoria)
   order by fecha desc, folio desc
$$;
revoke all on function public.fn_avance_financiero_detalle(uuid, date, text) from public;
grant execute on function public.fn_avance_financiero_detalle(uuid, date, text) to authenticated;
