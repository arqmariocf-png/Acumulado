-- Renglones de texto libre en requerimientos (Mario, 28-sep-2026): Ergodinova
-- (y casi todas las empresas) no tienen catálogo de productos, así que exigir
-- concepto_id dejaba a Jonathan sin poder pedir nada. Ahora un renglón lleva
-- producto del catálogo O descripción libre; compras lo resuelve igual por
-- requisicion_linea_id. Ya aplicado en producción.
alter table public.requisicion_lineas alter column concepto_id drop not null;
alter table public.requisicion_lineas add column if not exists descripcion text;
alter table public.requisicion_lineas drop constraint if exists requisicion_lineas_concepto_o_descripcion;
alter table public.requisicion_lineas add constraint requisicion_lineas_concepto_o_descripcion
  check (concepto_id is not null or nullif(trim(coalesce(descripcion, '')), '') is not null);

create or replace view public.avance_resolucion_linea as
select rl.id as requisicion_linea_id,
       rl.requisicion_id,
       rl.concepto_id,
       rl.cantidad_solicitada,
       rl.unidad_medida,
       coalesce(sum(nc.cantidad) filter (where nc.estado <> 'cancelada'), 0::numeric) as cantidad_a_compra,
       coalesce(sum(ne.cantidad) filter (where ne.estado <> 'cancelada'), 0::numeric) as cantidad_a_entrega,
       rl.cantidad_solicitada
         - coalesce(sum(nc.cantidad) filter (where nc.estado <> 'cancelada'), 0::numeric)
         - coalesce(sum(ne.cantidad) filter (where ne.estado <> 'cancelada'), 0::numeric) as cantidad_sin_resolver,
       rl.descripcion
from public.requisicion_lineas rl
left join public.necesidades_compra nc on nc.requisicion_linea_id = rl.id
left join public.necesidades_entrega ne on ne.requisicion_linea_id = rl.id
group by rl.id, rl.requisicion_id, rl.concepto_id, rl.cantidad_solicitada, rl.unidad_medida, rl.descripcion;

-- El trigger que valida que el producto sea de la empresa solo aplica cuando
-- hay producto; un renglón de texto libre pasa directo.
create or replace function public.validar_empresa_requisicion_linea()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.concepto_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.requisiciones r
    join public.productos p on p.id = new.concepto_id
    where r.id = new.requisicion_id
      and p.empresa_id = r.empresa_id
  ) then
    raise exception 'El concepto no pertenece a la empresa de la requisición';
  end if;
  return new;
end;
$$;
