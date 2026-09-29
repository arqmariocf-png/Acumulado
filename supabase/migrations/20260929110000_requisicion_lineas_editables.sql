-- Editar renglones de una requisición (Mario, 29-sep-2026: "que puedan
-- editar para no hacer tantos folios por errores sencillos"). Las policies
-- ya dejan a quien la pidió (o admin/corporativo) escribir sus renglones
-- mientras esté 'enviada'. Esta guarda evita tocar lo que almacén ya
-- resolvió: no se borra un renglón con compra/entrega, ni se baja la
-- cantidad por debajo de lo ya resuelto, ni se cambia la unidad.
-- Ya aplicado en producción.

create or replace function public.requisicion_lineas_guarda_resueltas()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_resuelto numeric;
begin
  select coalesce((select sum(cantidad) from public.necesidades_compra where requisicion_linea_id = old.id and estado <> 'cancelada'), 0)
       + coalesce((select sum(cantidad) from public.necesidades_entrega where requisicion_linea_id = old.id and estado <> 'cancelada'), 0)
    into v_resuelto;
  if v_resuelto <= 0 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Este renglón ya tiene compra o entrega registrada; no se puede quitar';
  end if;
  if new.cantidad_solicitada < v_resuelto then
    raise exception 'Ya hay % % resueltos de este renglón; la cantidad no puede ser menor', v_resuelto, old.unidad_medida;
  end if;
  if new.unidad_medida is distinct from old.unidad_medida or new.concepto_id is distinct from old.concepto_id then
    raise exception 'Este renglón ya tiene compra o entrega registrada; solo se puede subir la cantidad';
  end if;
  return new;
end;
$$;

drop trigger if exists requisicion_lineas_guarda_resueltas on public.requisicion_lineas;
create trigger requisicion_lineas_guarda_resueltas
  before update or delete on public.requisicion_lineas
  for each row execute function public.requisicion_lineas_guarda_resueltas();

-- Cancelar la requisición completa: la policy de update tenía el mismo
-- WITH CHECK que el USING (estado = 'enviada'), así que el renglón nuevo con
-- 'cancelada' se rechazaba. Quien la pidió puede pasarla a cancelada.
drop policy if exists requisiciones_update on public.requisiciones;
create policy requisiciones_update on public.requisiciones for update
  using (
    (select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol])
    or (solicitado_por = (select auth.uid()) and estado = 'enviada')
  )
  with check (
    (select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol])
    or (solicitado_por = (select auth.uid()) and estado in ('enviada', 'cancelada'))
  );
