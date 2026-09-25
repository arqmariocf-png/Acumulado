-- Almacén pidió ver las órdenes de la más reciente a la más vieja para
-- ocuparlas más fácil. Las vistas de avance no exponían la fecha de la
-- orden; se agrega AL FINAL (no se puede renombrar/reordenar columnas de
-- una vista con create or replace). Ya aplicado en producción.

create or replace view public.avance_recepcion_oc as
select oc.id as orden_compra_id,
       oc.id_orden,
       oc.tipo,
       oc.empresa_id,
       oc.proyecto,
       oc.proveedor,
       oc.total as total_oc,
       coalesce(sum(mi.cantidad * mi.costo_unitario), 0::numeric) as total_recibido,
       count(mi.id) as movimientos_vinculados,
       max(mi.fecha) as fecha_ultima_recepcion,
       case
         when oc.total is null then 'sin_total'
         when coalesce(sum(mi.cantidad * mi.costo_unitario), 0::numeric) = 0 then 'sin_recibir'
         when coalesce(sum(mi.cantidad * mi.costo_unitario), 0::numeric) >= (oc.total - 0.01) then 'completo'
         else 'parcial'
       end as estado_recepcion,
       oc.fecha_creacion as fecha
from public.ordenes_compra oc
left join public.movimientos_inventario mi on mi.orden_compra_id = oc.id
group by oc.id, oc.id_orden, oc.tipo, oc.empresa_id, oc.proyecto, oc.proveedor, oc.total, oc.fecha_creacion;

create or replace view public.avance_embarque_ov as
select ov.id as orden_venta_id,
       ov.id_ov,
       ov.empresa_id,
       ov.proyecto,
       ov.cliente,
       ov.total as total_ov,
       coalesce(sum(mi.cantidad * mi.costo_unitario), 0::numeric) as total_embarcado,
       count(mi.id) as movimientos_vinculados,
       max(mi.fecha) as fecha_ultimo_embarque,
       case
         when ov.total is null then 'sin_total'
         when coalesce(sum(mi.cantidad * mi.costo_unitario), 0::numeric) = 0 then 'sin_embarcar'
         when coalesce(sum(mi.cantidad * mi.costo_unitario), 0::numeric) >= (ov.total - 0.01) then 'completo'
         else 'parcial'
       end as estado_embarque,
       ov.fecha_ov as fecha
from public.ordenes_venta ov
left join public.movimientos_inventario mi on mi.orden_venta_id = ov.id
group by ov.id, ov.id_ov, ov.empresa_id, ov.proyecto, ov.cliente, ov.total, ov.fecha_ov;
