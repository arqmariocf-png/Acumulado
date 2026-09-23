-- 21-sep-2026: los folios de cuadrilla los ASIGNAN Christian y Luis
-- (permiso bbva_mantenimiento) a los supervisores; el supervisor solo mueve
-- el estatus de los suyos. Antes el supervisor capturaba sus propios folios.
alter table public.bbva_folios_cuadrilla
  add column asignado_por uuid references public.profiles (id),
  add column asignado_en timestamptz not null default now();

drop policy bbva_folios_cuadrilla_insert on public.bbva_folios_cuadrilla;
drop policy bbva_folios_cuadrilla_update on public.bbva_folios_cuadrilla;
drop policy bbva_folios_cuadrilla_delete on public.bbva_folios_cuadrilla;

create policy bbva_folios_cuadrilla_insert on public.bbva_folios_cuadrilla
  for insert
  with check (public.auth_bbva_mantenimiento() or public.auth_rol() in ('admin', 'corporativo'));

create policy bbva_folios_cuadrilla_update on public.bbva_folios_cuadrilla
  for update
  using (
    (public.auth_rol() = 'supervisor_bbva' and supervisor_id = auth.uid())
    or public.auth_bbva_mantenimiento() or public.auth_rol() in ('admin', 'corporativo')
  )
  with check (
    (public.auth_rol() = 'supervisor_bbva' and supervisor_id = auth.uid())
    or public.auth_bbva_mantenimiento() or public.auth_rol() in ('admin', 'corporativo')
  );

create policy bbva_folios_cuadrilla_delete on public.bbva_folios_cuadrilla
  for delete
  using (public.auth_bbva_mantenimiento() or public.auth_rol() in ('admin', 'corporativo'));

-- El supervisor solo puede tocar estatus y nota: folio, sucursal,
-- descripción y asignación se quedan como los dejó quien asignó.
create or replace function public.bbva_folios_cuadrilla_solo_estatus()
returns trigger language plpgsql as $$
begin
  if public.auth_rol() = 'supervisor_bbva' then
    if new.folio is distinct from old.folio or new.sucursal is distinct from old.sucursal
       or new.descripcion is distinct from old.descripcion or new.supervisor_id is distinct from old.supervisor_id then
      raise exception 'El supervisor solo puede cambiar el estatus del folio; la asignación la hace mantenimiento BBVA.';
    end if;
  end if;
  return new;
end $$;

create trigger bbva_folios_cuadrilla_solo_estatus
  before update on public.bbva_folios_cuadrilla
  for each row execute function public.bbva_folios_cuadrilla_solo_estatus();

-- Lista de supervisores de cuadrilla para el selector de asignación y para
-- mostrar nombres (profiles solo deja leer el propio renglón).
create view public.v_supervisores_bbva with (security_invoker = false) as
select id, nombre
from public.profiles
where rol = 'supervisor_bbva' and activo
  and (public.auth_rol() in ('supervisor_bbva', 'corporativo', 'direccion', 'admin') or public.auth_bbva_mantenimiento());

grant select on public.v_supervisores_bbva to authenticated;
