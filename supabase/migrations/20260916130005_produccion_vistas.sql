-- Vistas de reporting del módulo de Producción y Costeo.
--
-- IMPORTANTE: todas llevan `security_invoker = true`, mismo criterio que
-- 20260816090012_vistas_reportes.sql -- sin esa opción la vista correría
-- con los permisos del dueño de las tablas y evadiría RLS.

-- Stock actual de materia prima + costo promedio ponderado de compra
-- (weighted average de las entradas), calculado del historial de
-- movimientos -- nunca un contador aparte.
create view public.v_stock_materia_prima with (security_invoker = true) as
select
  mp.id as materia_prima_id,
  mp.nombre,
  mp.unidad_medida,
  coalesce(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0)
    - coalesce(sum(m.cantidad) filter (where m.tipo = 'salida'), 0) as stock_actual,
  round(
    coalesce(sum(m.cantidad * m.costo_unitario) filter (where m.tipo = 'entrada'), 0)
    / nullif(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0),
    4
  ) as costo_promedio_ponderado
from public.materias_primas mp
left join public.movimientos_materia_prima m on m.materia_prima_id = mp.id
group by mp.id, mp.nombre, mp.unidad_medida;

-- Stock actual de producto terminado + costo promedio ponderado de
-- producción (weighted average de las entradas, que ya vienen valuadas al
-- costo real de cada lote -- ver v_costeo_orden_produccion).
create view public.v_stock_producto_terminado with (security_invoker = true) as
select
  p.id as producto_id,
  p.nombre,
  p.tipo,
  p.calibre,
  p.unidad_medida,
  coalesce(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0)
    - coalesce(sum(m.cantidad) filter (where m.tipo = 'salida'), 0) as stock_actual,
  round(
    coalesce(sum(m.cantidad * m.costo_unitario) filter (where m.tipo = 'entrada'), 0)
    / nullif(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0),
    4
  ) as costo_promedio_ponderado
from public.productos_produccion p
left join public.movimientos_producto_terminado m on m.producto_id = p.id
group by p.id, p.nombre, p.tipo, p.calibre, p.unidad_medida;

-- Costo real por lote: materia prima consumida (movimientos_materia_prima
-- ligados a la orden) + mano de obra + indirectos. Es la vista que
-- alimenta la pantalla de "Órdenes de producción" en vivo mientras se
-- captura el lote.
create view public.v_costeo_orden_produccion with (security_invoker = true) as
with mp as (
  select orden_produccion_id, sum(cantidad * costo_unitario) as costo_materia_prima
  from public.movimientos_materia_prima
  where tipo = 'salida' and orden_produccion_id is not null
  group by orden_produccion_id
),
mo as (
  select orden_produccion_id, sum(costo_total) as costo_mano_obra
  from public.mano_de_obra_produccion
  group by orden_produccion_id
),
ci as (
  select orden_produccion_id, sum(monto) as costo_indirectos
  from public.costos_indirectos_produccion
  group by orden_produccion_id
)
select
  o.id as orden_produccion_id,
  o.folio,
  o.producto_id,
  o.estado,
  o.fecha_inicio,
  o.fecha_fin,
  o.cantidad_planeada,
  o.cantidad_producida,
  o.cantidad_merma,
  coalesce(mp.costo_materia_prima, 0) as costo_materia_prima,
  coalesce(mo.costo_mano_obra, 0) as costo_mano_obra,
  coalesce(ci.costo_indirectos, 0) as costo_indirectos,
  coalesce(mp.costo_materia_prima, 0) + coalesce(mo.costo_mano_obra, 0) + coalesce(ci.costo_indirectos, 0) as costo_total,
  round(
    (coalesce(mp.costo_materia_prima, 0) + coalesce(mo.costo_mano_obra, 0) + coalesce(ci.costo_indirectos, 0))
    / nullif(o.cantidad_producida, 0),
    4
  ) as costo_unitario
from public.ordenes_produccion o
left join mp on mp.orden_produccion_id = o.id
left join mo on mo.orden_produccion_id = o.id
left join ci on ci.orden_produccion_id = o.id;

-- Costo estándar del lote según receta vigente (cantidad_planeada × receta)
-- -- para comparar contra el costo real de v_costeo_orden_produccion y ver
-- desviaciones de merma/consumo. Usa costo_promedio_ponderado de cada
-- materia prima como proxy del costo esperado (no hay "costo estándar"
-- guardado aparte, ver criterio de v_stock_materia_prima).
create view public.v_costeo_estandar_orden_produccion with (security_invoker = true) as
select
  o.id as orden_produccion_id,
  sum(ri.cantidad_por_unidad * o.cantidad_planeada * coalesce(vs.costo_promedio_ponderado, 0)) as costo_materia_prima_estandar
from public.ordenes_produccion o
join public.receta_items ri on ri.producto_id = o.producto_id
left join public.v_stock_materia_prima vs on vs.materia_prima_id = ri.materia_prima_id
group by o.id;

-- Costo de producción por mes/producto (solo lotes terminados) -- es la
-- vista que se expone en el Dashboard de Acumulado junto a los KPIs
-- financieros existentes ("costos de producción → reportes financieros").
create view public.v_costeo_mensual_clavicon with (security_invoker = true) as
select
  p.id as producto_id,
  p.nombre as producto_nombre,
  p.tipo as producto_tipo,
  extract(year from coalesce(o.fecha_fin, o.fecha_inicio))::int as anio,
  extract(month from coalesce(o.fecha_fin, o.fecha_inicio))::int as mes,
  count(*) as lotes,
  sum(o.cantidad_producida) as cantidad_producida,
  sum(c.costo_total) as costo_total,
  round(sum(c.costo_total) / nullif(sum(o.cantidad_producida), 0), 4) as costo_unitario_promedio
from public.ordenes_produccion o
join public.productos_produccion p on p.id = o.producto_id
join public.v_costeo_orden_produccion c on c.orden_produccion_id = o.id
where o.estado = 'terminada'
group by p.id, p.nombre, p.tipo, extract(year from coalesce(o.fecha_fin, o.fecha_inicio)), extract(month from coalesce(o.fecha_fin, o.fecha_inicio));
