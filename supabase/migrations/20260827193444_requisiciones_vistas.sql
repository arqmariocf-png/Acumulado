-- security_invoker = true: sin esto la vista corre con los permisos de su
-- dueño y evade el RLS de requisicion_lineas/necesidades_*.
create view public.avance_resolucion_linea with (security_invoker = true) as
select
  rl.id as requisicion_linea_id,
  rl.requisicion_id,
  rl.concepto_id,
  rl.cantidad_solicitada,
  rl.unidad_medida,
  coalesce(sum(nc.cantidad) filter (where nc.estado <> 'cancelada'), 0) as cantidad_a_compra,
  coalesce(sum(ne.cantidad) filter (where ne.estado <> 'cancelada'), 0) as cantidad_a_entrega,
  rl.cantidad_solicitada
    - coalesce(sum(nc.cantidad) filter (where nc.estado <> 'cancelada'), 0)
    - coalesce(sum(ne.cantidad) filter (where ne.estado <> 'cancelada'), 0) as cantidad_sin_resolver
from public.requisicion_lineas rl
left join public.necesidades_compra nc on nc.requisicion_linea_id = rl.id
left join public.necesidades_entrega ne on ne.requisicion_linea_id = rl.id
group by rl.id, rl.requisicion_id, rl.concepto_id, rl.cantidad_solicitada, rl.unidad_medida;
