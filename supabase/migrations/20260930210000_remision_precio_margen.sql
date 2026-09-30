-- Margen cerrado de Clavicón (Mario, 30-sep-2026): "considerar el precio de
-- venta para ya tener un margen cerrado". Cada partida de la remisión de
-- salida guarda su precio de venta (sin IVA) y el costo unitario del producto
-- terminado al emitirla (costo promedio ponderado real, de los lotes). El
-- margen se CALCULA en v_margen_remisiones_produccion.
--
-- Ya aplicado en producción.

alter table public.remisiones_produccion_lineas
  add column if not exists precio_unitario numeric(14,4) check (precio_unitario is null or precio_unitario >= 0),
  add column if not exists costo_unitario numeric(14,4) check (costo_unitario is null or costo_unitario >= 0);

-- Costo congelado al emitir: el promedio ponderado del producto en ese momento.
create or replace function public.remisiones_produccion_lineas_costo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.producto_id is not null and new.costo_unitario is null then
    select s.costo_promedio_ponderado into new.costo_unitario
      from public.v_stock_producto_terminado s where s.producto_id = new.producto_id;
  end if;
  return new;
end;
$$;
drop trigger if exists remisiones_produccion_lineas_costo on public.remisiones_produccion_lineas;
create trigger remisiones_produccion_lineas_costo before insert on public.remisiones_produccion_lineas
  for each row execute function public.remisiones_produccion_lineas_costo();

-- Las salidas ya emitidas toman el costo promedio actual.
update public.remisiones_produccion_lineas l
   set costo_unitario = s.costo_promedio_ponderado
  from public.v_stock_producto_terminado s
 where l.producto_id = s.producto_id and l.costo_unitario is null;

create or replace view public.v_margen_remisiones_produccion with (security_invoker = true) as
select r.id as remision_id, r.empresa_id, r.folio, r.fecha, r.contraparte, r.estatus, r.condicion_pago, r.dias_credito,
       count(l.id) as partidas,
       count(l.id) filter (where l.precio_unitario is null) as sin_precio,
       round(sum(l.cantidad * coalesce(l.precio_unitario, 0)), 2) as venta,
       round(sum(l.cantidad * coalesce(l.costo_unitario, 0)), 2) as costo,
       round(sum(l.cantidad * (coalesce(l.precio_unitario, 0) - coalesce(l.costo_unitario, 0))) filter (where l.precio_unitario is not null), 2) as margen
from public.remisiones_produccion r
join public.remisiones_produccion_lineas l on l.remision_id = r.id
where r.tipo = 'salida'
group by r.id;
grant select on public.v_margen_remisiones_produccion to authenticated;

-- Finanzas (admin, corporativo, dirección) captura el precio después de emitir.
drop policy if exists remisiones_produccion_lineas_precio on public.remisiones_produccion_lineas;
create policy remisiones_produccion_lineas_precio on public.remisiones_produccion_lineas for update to authenticated
  using ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol, 'direccion'::app_rol])
         and exists (select 1 from public.remisiones_produccion r where r.id = remisiones_produccion_lineas.remision_id and r.empresa_id = any ((select public.auth_empresas_alcance())::uuid[])))
  with check ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol, 'direccion'::app_rol]));

-- Fuera de admin, finanzas solo toca el precio de venta de la partida.
create or replace function public.remisiones_produccion_lineas_solo_precio()
returns trigger language plpgsql set search_path = public as $$
begin
  if (select public.auth_rol_definer()) <> 'admin'
     and (new.remision_id, new.descripcion, new.cantidad, new.unidad, new.producto_id, new.materia_prima_id, new.costo_unitario)
         is distinct from (old.remision_id, old.descripcion, old.cantidad, old.unidad, old.producto_id, old.materia_prima_id, old.costo_unitario) then
    raise exception 'Solo se puede capturar el precio de venta de la partida.';
  end if;
  return new;
end;
$$;
drop trigger if exists remisiones_produccion_lineas_solo_precio on public.remisiones_produccion_lineas;
create trigger remisiones_produccion_lineas_solo_precio before update on public.remisiones_produccion_lineas
  for each row execute function public.remisiones_produccion_lineas_solo_precio();
