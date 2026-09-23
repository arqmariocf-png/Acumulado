-- Vistas de inventario. Todas con security_invoker = true por la misma
-- razón que 20260816090012_vistas_reportes.sql: sin esa opción una vista
-- corre con los permisos de su dueño y evade RLS.

-- Existencia actual = todas las entradas menos todas las salidas del
-- historial (nunca un contador aparte, ver comentario en la migración de
-- esquema). Es un producto por almacén de su misma empresa -- hoy da una
-- sola fila por producto porque solo hay un almacén por empresa.
create view public.existencias with (security_invoker = true) as
select
  p.id as producto_id,
  p.empresa_id,
  p.sku,
  p.nombre as producto_nombre,
  p.unidad_medida,
  a.id as almacen_id,
  a.nombre as almacen_nombre,
  coalesce(sum(mi.cantidad) filter (where mi.tipo = 'entrada'), 0)
    - coalesce(sum(mi.cantidad) filter (where mi.tipo = 'salida'), 0) as existencia
from public.productos p
join public.almacenes a on a.empresa_id = p.empresa_id
left join public.movimientos_inventario mi on mi.producto_id = p.id and mi.almacen_id = a.id
group by p.id, p.empresa_id, p.sku, p.nombre, p.unidad_medida, a.id, a.nombre;

-- Match entradas de almacén <-> catálogo de OC/OS: cuánto se ha recibido
-- físicamente (suma de cantidad × costo_unitario de los movimientos de
-- entrada vinculados) contra el total en dinero de la orden. Es a nivel de
-- orden completa, no por línea de producto -- ver comentario en la
-- migración de esquema sobre por qué (el catálogo de OC hoy no trae detalle
-- de línea).
create view public.avance_recepcion_oc with (security_invoker = true) as
select
  oc.id as orden_compra_id,
  oc.id_orden,
  oc.tipo,
  oc.empresa_id,
  oc.proyecto,
  oc.proveedor,
  oc.total as total_oc,
  coalesce(sum(mi.cantidad * mi.costo_unitario), 0) as total_recibido,
  count(mi.id) as movimientos_vinculados,
  max(mi.fecha) as fecha_ultima_recepcion,
  case
    when oc.total is null then 'sin_total'
    when coalesce(sum(mi.cantidad * mi.costo_unitario), 0) = 0 then 'sin_recibir'
    when coalesce(sum(mi.cantidad * mi.costo_unitario), 0) >= oc.total - 0.01 then 'completo'
    else 'parcial'
  end as estado_recepcion
from public.ordenes_compra oc
left join public.movimientos_inventario mi on mi.orden_compra_id = oc.id
group by oc.id, oc.id_orden, oc.tipo, oc.empresa_id, oc.proyecto, oc.proveedor, oc.total;

-- Simétrico para salidas de almacén <-> catálogo de OV.
create view public.avance_embarque_ov with (security_invoker = true) as
select
  ov.id as orden_venta_id,
  ov.id_ov,
  ov.empresa_id,
  ov.proyecto,
  ov.cliente,
  ov.total as total_ov,
  coalesce(sum(mi.cantidad * mi.costo_unitario), 0) as total_embarcado,
  count(mi.id) as movimientos_vinculados,
  max(mi.fecha) as fecha_ultimo_embarque,
  case
    when ov.total is null then 'sin_total'
    when coalesce(sum(mi.cantidad * mi.costo_unitario), 0) = 0 then 'sin_embarcar'
    when coalesce(sum(mi.cantidad * mi.costo_unitario), 0) >= ov.total - 0.01 then 'completo'
    else 'parcial'
  end as estado_embarque
from public.ordenes_venta ov
left join public.movimientos_inventario mi on mi.orden_venta_id = ov.id
group by ov.id, ov.id_ov, ov.empresa_id, ov.proyecto, ov.cliente, ov.total;
