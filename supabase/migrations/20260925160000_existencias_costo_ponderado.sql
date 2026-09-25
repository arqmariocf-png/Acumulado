-- Existencias con cantidad, precio unitario ponderado y valor (Mario,
-- 25-sep-2026: "en existencias agregar cantidad, p.u. y sacar un precio
-- ponderado de producto"). El costo ponderado sale de las ENTRADAS con costo
-- (suma de cantidad × costo / suma de cantidad) por producto y almacén; si
-- no hay entradas con costo se usa el costo de referencia del producto.
-- Columnas nuevas AL FINAL de la vista. Ya aplicado en producción.

create or replace view public.existencias with (security_invoker = true) as
select
  p.id as producto_id,
  p.empresa_id,
  p.sku,
  p.nombre as producto_nombre,
  p.unidad_medida,
  a.id as almacen_id,
  a.nombre as almacen_nombre,
  coalesce(sum(mi.cantidad) filter (where mi.tipo = 'entrada'), 0)
    - coalesce(sum(mi.cantidad) filter (where mi.tipo = 'salida'), 0) as existencia,
  p.costo_referencia,
  case
    when coalesce(sum(mi.cantidad) filter (where mi.tipo = 'entrada' and mi.costo_unitario is not null), 0) > 0
    then round(
      sum(mi.cantidad * mi.costo_unitario) filter (where mi.tipo = 'entrada' and mi.costo_unitario is not null)
      / sum(mi.cantidad) filter (where mi.tipo = 'entrada' and mi.costo_unitario is not null), 4)
    else null
  end as costo_promedio,
  round(
    (coalesce(sum(mi.cantidad) filter (where mi.tipo = 'entrada'), 0) - coalesce(sum(mi.cantidad) filter (where mi.tipo = 'salida'), 0))
    * coalesce(
        case
          when coalesce(sum(mi.cantidad) filter (where mi.tipo = 'entrada' and mi.costo_unitario is not null), 0) > 0
          then sum(mi.cantidad * mi.costo_unitario) filter (where mi.tipo = 'entrada' and mi.costo_unitario is not null)
               / sum(mi.cantidad) filter (where mi.tipo = 'entrada' and mi.costo_unitario is not null)
          else null
        end,
        p.costo_referencia, 0), 2) as valor
from public.productos p
join public.almacenes a on a.empresa_id = p.empresa_id
left join public.movimientos_inventario mi on mi.producto_id = p.id and mi.almacen_id = a.id
group by p.id, p.empresa_id, p.sku, p.nombre, p.unidad_medida, p.costo_referencia, a.id, a.nombre;
