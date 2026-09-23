-- Producción (pedido de Mario, 23-sep-2026):
-- 1. Tiempo planeado de entrega (días hábiles, lunes a sábado) por lote y
--    fecha estimada de embarque calculada.
-- 2. Solo admin edita los datos de un lote ya creado; la planta solo lo
--    cierra (cantidad producida, merma, estado, fecha fin).
-- 3. Mano de obra con personal de RH: costo por hora = sueldo semanal ÷
--    horas de su perfil de jornada; horas por día del perfil. Vista
--    definer para que la planta vea solo lo necesario del personal.
-- Ya aplicada en producción.
alter table public.ordenes_produccion
  add column dias_planeados numeric(6, 2) check (dias_planeados is null or dias_planeados > 0),
  add column fecha_estimada_embarque date;

create or replace function public.fn_fecha_embarque(p_inicio date, p_dias numeric)
returns date language plpgsql immutable as $$
declare
  v_fecha date := p_inicio;
  v_restantes numeric := coalesce(p_dias, 0);
begin
  if p_inicio is null or p_dias is null then return null; end if;
  while v_restantes > 0 loop
    v_fecha := v_fecha + 1;
    if extract(isodow from v_fecha) <> 7 then
      v_restantes := v_restantes - 1;
    end if;
  end loop;
  return v_fecha;
end;
$$;

create or replace function public.ordenes_produccion_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.fecha_estimada_embarque := public.fn_fecha_embarque(new.fecha_inicio, new.dias_planeados);
  if tg_op = 'UPDATE' and public.auth_rol() <> 'admin' then
    if new.folio is distinct from old.folio
      or new.producto_id is distinct from old.producto_id
      or new.fecha_inicio is distinct from old.fecha_inicio
      or new.cantidad_planeada is distinct from old.cantidad_planeada
      or new.proyecto_id is distinct from old.proyecto_id
      or new.dias_planeados is distinct from old.dias_planeados
      or new.notas is distinct from old.notas then
      raise exception 'Solo el administrador puede editar los datos de un lote; la planta solo cierra el lote.';
    end if;
  end if;
  return new;
end;
$$;
create trigger ordenes_produccion_before_write
  before insert or update on public.ordenes_produccion
  for each row execute function public.ordenes_produccion_before_write();

create or replace view public.v_personal_produccion with (security_invoker = false) as
select pe.id, pe.nombre, pe.puesto, pe.area,
  c.sueldo_semanal,
  coalesce(pj.horas_semana, 48) as horas_semana,
  coalesce(pj.dias_semana, 6) as dias_semana,
  round(coalesce(pj.horas_semana, 48) / coalesce(pj.dias_semana, 6), 2) as horas_dia,
  case when c.sueldo_semanal is null then null else round(c.sueldo_semanal / coalesce(pj.horas_semana, 48), 2) end as costo_hora
from public.personal pe
left join lateral (
  select c.sueldo_semanal from public.contrataciones c
  where c.personal_id = pe.id and c.fecha_inicio <= current_date and c.fecha_fin >= current_date
  order by c.fecha_inicio desc limit 1
) c on true
left join public.perfiles_jornada pj on pj.id = coalesce(pe.perfil_jornada_id, (select id from public.perfiles_jornada where es_base))
where pe.activo
  and public.auth_rol() in ('produccion', 'admin', 'corporativo', 'rh');
grant select on public.v_personal_produccion to authenticated;
