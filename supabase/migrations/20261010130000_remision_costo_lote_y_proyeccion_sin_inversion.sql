-- Mario, 10-oct-2026: "en la remisión de salida maneja un costo irreal;
-- configúralo con el lote uno, ya tenemos un costeo real para tener un margen
-- correcto del primer lote. El costo de Carbarín es inversión, sepáralo de la
-- ecuación, y mantenimientos no hemos tenido en los meses pasados: puedes no
-- contemplarlos en el plan anual".
--
-- 1) La capa PEPS de producto terminado que viene de un lote vale lo que
--    cuesta el lote HOY (v_costeo_orden_produccion), no lo que valía cuando
--    se registró la entrada: un lote reabierto o con nómina nueva ya no deja
--    costos viejos. La RM-000001 tenía $1,263.16 congelado; el lote 001 cuesta
--    $1,611.49.
-- 2) El costo de cada partida de remisión de salida se calcula por PEPS
--    contra esas capas (v_peps_remisiones_lineas) y el margen lo usa; el costo
--    congelado queda solo de respaldo.
-- 3) Dirección (Laura) ve el margen: fn_lotes_mano_obra_nomina le abre la
--    nómina del lote (si no, su costo salía sin mano de obra).
-- 4) Proyección anual: ordenes_compra.es_inversion (OC 41094, Lázaro
--    Carbarín, $60,000) va aparte y no entra a indirectos; tampoco las
--    partidas de mantenimiento.
--
-- Ya aplicado en producción.

create or replace function public.fn_lotes_mano_obra_nomina()
returns table (orden_produccion_id uuid, empleado text, puesto text, dias numeric, costo numeric, estimado boolean, personal_id uuid)
language sql stable security definer set search_path = public as $$
  select b.orden_produccion_id, b.empleado, b.puesto, b.dias, b.costo, b.estimado,
         (select pe.id from public.personal pe where pe.backoffice_empleado = b.empleado limit 1)
    from public.fn_lotes_mano_obra_nomina_base() b
    join public.ordenes_produccion o on o.id = b.orden_produccion_id
   where auth.uid() is null
      or (public.auth_rol_definer() = any (array['produccion'::app_rol, 'admin'::app_rol, 'corporativo'::app_rol, 'direccion'::app_rol])
          and o.empresa_id = any (public.auth_empresas_alcance()));
$$;

create or replace view public.v_peps_capas_producto_terminado with (security_invoker = true) as
with e as (
  select m.id, m.producto_id, m.fecha, m.created_at, m.cantidad,
         coalesce(case when c.estado in ('en_proceso', 'terminada') and c.costo_unitario > 0 then c.costo_unitario end, m.costo_unitario)::numeric(14,4) as costo_unitario,
         sum(m.cantidad) over (partition by m.producto_id order by m.fecha, m.created_at, m.id) as hasta
    from public.movimientos_producto_terminado m
    left join public.v_costeo_orden_produccion c on c.orden_produccion_id = m.orden_produccion_id
   where m.tipo = 'entrada' and m.cantidad > 0
),
s as (
  select producto_id, sum(cantidad) as salidas
    from public.movimientos_producto_terminado where tipo = 'salida' group by producto_id
)
select e.id as movimiento_id, e.producto_id, e.fecha, e.created_at, e.cantidad, e.costo_unitario,
       e.hasta - e.cantidad as desde, e.hasta,
       greatest(0, least(e.cantidad, e.hasta - coalesce(s.salidas, 0))) as restante
  from e left join s using (producto_id);

create or replace view public.v_peps_remisiones_lineas with (security_invoker = true) as
with l as (
  select l.id, l.producto_id, l.cantidad, l.costo_unitario,
         sum(l.cantidad) over (partition by l.producto_id order by r.fecha, r.created_at, l.id) as hasta
    from public.remisiones_produccion_lineas l
    join public.remisiones_produccion r on r.id = l.remision_id
   where r.tipo = 'salida' and l.producto_id is not null and l.cantidad > 0
),
u as (
  select distinct on (producto_id) producto_id, costo_unitario
    from public.v_peps_capas_producto_terminado
   order by producto_id, fecha desc, created_at desc
),
x as (
  select l.id, l.producto_id, l.cantidad, l.costo_unitario as costo_congelado,
         coalesce(sum(greatest(0, least(l.hasta, c.hasta) - greatest(l.hasta - l.cantidad, c.desde)) * c.costo_unitario), 0) as costo_capas,
         coalesce(sum(greatest(0, least(l.hasta, c.hasta) - greatest(l.hasta - l.cantidad, c.desde))), 0) as cubierto
    from l
    left join public.v_peps_capas_producto_terminado c
      on c.producto_id = l.producto_id and c.desde < l.hasta and c.hasta > l.hasta - l.cantidad
   group by l.id, l.producto_id, l.cantidad, l.costo_unitario
)
select x.id as linea_id, x.producto_id,
       round((x.costo_capas + (x.cantidad - x.cubierto) * coalesce(u.costo_unitario, x.costo_congelado, 0)) / x.cantidad, 4) as costo_peps
  from x left join u using (producto_id);

create or replace view public.v_margen_remisiones_produccion with (security_invoker = true) as
select r.id as remision_id, r.empresa_id, r.folio, r.fecha, r.contraparte, r.estatus, r.condicion_pago, r.dias_credito,
       count(l.id) as partidas,
       count(l.id) filter (where l.precio_unitario is null) as sin_precio,
       round(sum(l.cantidad * coalesce(l.precio_unitario, 0)), 2) as venta,
       round(sum(l.cantidad * coalesce(p.costo_peps, l.costo_unitario, 0)), 2) as costo,
       round(sum(l.cantidad * (coalesce(l.precio_unitario, 0) - coalesce(p.costo_peps, l.costo_unitario, 0))) filter (where l.precio_unitario is not null), 2) as margen
  from public.remisiones_produccion r
  join public.remisiones_produccion_lineas l on l.remision_id = r.id
  left join public.v_peps_remisiones_lineas p on p.linea_id = l.id
 where r.tipo = 'salida'
 group by r.id;

-- Inversiones fuera del gasto de operación.
alter table public.ordenes_compra add column if not exists es_inversion boolean not null default false;
update public.ordenes_compra set es_inversion = true
 where id_orden = '41094' and empresa_id = (select id from public.empresas where codigo = 'MCC');

-- Proyección anual sin inversiones ni mantenimientos; las inversiones se
-- devuelven aparte.
create or replace function public.fn_proyeccion_planta_datos(p_empresa uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with permitido as (select (select public.auth_admin_global_definer()) as ok),
  emp as (select id, nombre, public.normalizar_texto_sql(nombre) as k from public.empresas where id = p_empresa),
  nom as (
    select r.datos ->> 'empleado' as empleado, r.datos ->> 'puesto' as puesto,
           (r.datos ->> 'fecha_inicio')::date as ini, (r.datos ->> 'pago')::numeric as pago
      from public.nomina_externa_renglones r, emp
     where r.origen = 'nomina_semanal' and public.normalizar_texto_sql(r.datos ->> 'empresa') = emp.k
  ),
  ultima as (select max(ini) as ini from nom),
  personas as (
    select n.empleado, max(n.puesto) as puesto, sum(n.pago) as pago_semanal,
           (select pe.fecha_ingreso from public.personal pe where pe.backoffice_empleado = n.empleado limit 1) as ingreso
      from nom n, ultima u where n.ini = u.ini group by n.empleado
  ),
  lotes as (
    select o.folio, o.estado, o.fecha_inicio, o.fecha_fin, o.dias_planeados,
           coalesce(nullif(o.cantidad_producida, 0), o.cantidad_planeada) as cantidad, p.nombre as producto, o.producto_id
      from public.ordenes_produccion o join public.productos_produccion p on p.id = o.producto_id
     where o.empresa_id = p_empresa and o.estado <> 'cancelada'
  ),
  -- Producto principal: el del lote más reciente.
  prod as (select producto_id from lotes order by fecha_inicio desc limit 1),
  receta as (
    select coalesce(sum(ri.cantidad_por_unidad * coalesce(s.costo_peps, u.costo_unitario, s.costo_promedio_ponderado, 0)), 0) as mp_pieza,
           jsonb_agg(jsonb_build_object('materia', mp.nombre, 'por_pieza', ri.cantidad_por_unidad,
                     'costo', coalesce(s.costo_peps, u.costo_unitario, s.costo_promedio_ponderado))) as detalle
      from prod join public.receta_items ri on ri.producto_id = prod.producto_id
      join public.materias_primas mp on mp.id = ri.materia_prima_id
      left join public.v_stock_materia_prima s on s.materia_prima_id = ri.materia_prima_id
      left join lateral (
        select m.costo_unitario from public.movimientos_materia_prima m
         where m.materia_prima_id = ri.materia_prima_id and m.tipo = 'entrada'
         order by m.fecha desc, m.created_at desc limit 1
      ) u on true
  ),
  venta as (
    select round(sum(l.cantidad * l.precio_unitario) / nullif(sum(l.cantidad), 0), 4) as precio, sum(l.cantidad) as vendido
      from public.remisiones_produccion r join public.remisiones_produccion_lineas l on l.remision_id = r.id
     where r.empresa_id = p_empresa and r.tipo = 'salida' and l.precio_unitario is not null
  ),
  -- Gastos de la planta (OC sin IVA de su proyecto corporativo), sin la
  -- materia prima de la receta ni impuestos (ISR).
  gastos as (
    select date_trunc('month', oc.fecha_creacion)::date as mes, round(sum(coalesce(i.subtotal, oc.total / 1.16)), 2) as monto
      from public.ordenes_compra oc
      left join public.v_oc_importes i on i.orden_compra_id = oc.id
     where oc.empresa_id = p_empresa and oc.proyecto ilike 'Corporativo%'
       and coalesce(oc.estatus_backoffice, '') <> 'Cancelada' and oc.rechazada_en is null
       and not oc.es_inversion
       and oc.fecha_creacion >= (date_trunc('month', current_date) - interval '6 months')::date
       and not exists (
         select 1 from public.ordenes_compra_lineas l
          where l.orden_compra_id = oc.id
            and (l.item ilike 'ISR%' or l.item ilike '%MANTENIMIENTO%' or exists (
                  select 1 from public.receta_items ri join public.materias_primas mp on mp.id = ri.materia_prima_id
                   where ri.producto_id = (select producto_id from prod)
                     and public.normalizar_texto_sql(l.item) like '%' || split_part(public.normalizar_texto_sql(mp.nombre), ' ', 1) || '%'))
       )
     group by 1
  ),
  inversiones as (
    select oc.id_orden, oc.fecha_creacion, oc.proveedor, round(coalesce(i.subtotal, oc.total / 1.16), 2) as monto
      from public.ordenes_compra oc
      left join public.v_oc_importes i on i.orden_compra_id = oc.id
     where oc.empresa_id = p_empresa and oc.es_inversion and oc.rechazada_en is null
  )
  select case when (select ok from permitido) then jsonb_build_object(
    'empresa', (select nombre from emp),
    'personas', coalesce((select jsonb_agg(jsonb_build_object('nombre', regexp_replace(empleado, '_[A-Za-z]+$', ''), 'puesto', puesto, 'pago_semanal', pago_semanal, 'ingreso', ingreso) order by empleado) from personas), '[]'::jsonb),
    'lotes', coalesce((select jsonb_agg(jsonb_build_object('folio', folio, 'estado', estado, 'inicio', fecha_inicio, 'fin', fecha_fin, 'dias', dias_planeados, 'cantidad', cantidad, 'producto', producto) order by fecha_inicio) from lotes), '[]'::jsonb),
    'mp_pieza', (select round(mp_pieza, 4) from receta),
    'receta', (select detalle from receta),
    'precio_venta', (select precio from venta),
    'vendido', (select vendido from venta),
    'inversiones', coalesce((select jsonb_agg(jsonb_build_object('folio', id_orden, 'fecha', fecha_creacion, 'proveedor', proveedor, 'monto', monto) order by fecha_creacion) from inversiones), '[]'::jsonb),
    'gastos_mes', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'monto', monto) order by mes) from gastos), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.fn_proyeccion_planta_datos(uuid) from public, anon;
grant execute on function public.fn_proyeccion_planta_datos(uuid) to authenticated;
