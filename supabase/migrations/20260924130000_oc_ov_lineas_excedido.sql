-- Avance por partida con excedente (Mario, 24-sep-2026): si llega menos, el
-- proveedor aún debe producto; si llega más, habrá un ajuste/reclamación
-- posterior. Las vistas distinguen 'excedido' de 'completo' y exponen la
-- diferencia (pedido - recibido; negativa = excedente). Ya aplicado en
-- producción.

create or replace view public.v_oc_lineas_avance with (security_invoker = true) as
select
  l.id as linea_id, l.orden_compra_id, l.numero, l.item, l.unidad, l.cantidad,
  round(l.costo, 4) as costo,
  coalesce(sum(mi.cantidad), 0) as recibido,
  greatest(coalesce(l.cantidad, 0) - coalesce(sum(mi.cantidad), 0), 0) as pendiente,
  case when coalesce(sum(mi.cantidad), 0) = 0 then 'sin_recibir'
       when l.cantidad is not null and coalesce(sum(mi.cantidad), 0) > l.cantidad then 'excedido'
       when l.cantidad is not null and coalesce(sum(mi.cantidad), 0) = l.cantidad then 'completo'
       else 'parcial' end as estado,
  max(mi.fecha) as fecha_ultima_recepcion,
  (array_agg(mi.producto_id order by mi.created_at desc) filter (where mi.producto_id is not null))[1] as producto_id,
  coalesce(l.cantidad, 0) - coalesce(sum(mi.cantidad), 0) as diferencia
from public.ordenes_compra_lineas l
left join public.movimientos_inventario mi on mi.linea_orden_compra_id = l.id
group by l.id;

create or replace view public.v_ov_lineas_avance with (security_invoker = true) as
select
  l.id as linea_id, l.orden_venta_id, l.numero, l.concepto, l.unidad, l.cantidad,
  round(l.precio_base, 4) as precio_base,
  coalesce(sum(mi.cantidad), 0) as embarcado,
  greatest(coalesce(l.cantidad, 0) - coalesce(sum(mi.cantidad), 0), 0) as pendiente,
  case when coalesce(sum(mi.cantidad), 0) = 0 then 'sin_embarcar'
       when l.cantidad is not null and coalesce(sum(mi.cantidad), 0) > l.cantidad then 'excedido'
       when l.cantidad is not null and coalesce(sum(mi.cantidad), 0) = l.cantidad then 'completo'
       else 'parcial' end as estado,
  max(mi.fecha) as fecha_ultimo_embarque,
  (array_agg(mi.producto_id order by mi.created_at desc) filter (where mi.producto_id is not null))[1] as producto_id,
  coalesce(l.cantidad, 0) - coalesce(sum(mi.cantidad), 0) as diferencia
from public.ordenes_venta_lineas l
left join public.movimientos_inventario mi on mi.linea_orden_venta_id = l.id
group by l.id;
