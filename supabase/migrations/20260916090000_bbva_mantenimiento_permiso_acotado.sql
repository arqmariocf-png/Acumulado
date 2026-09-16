-- Permiso acotado para gente que solo debe entrar al panel de Mantenimiento
-- BBVA (subir el maestro, ver el avance) sin heredar el resto de accesos que
-- trae 'corporativo'/'admin' (Saldos, todas las empresas del grupo). Pensado
-- para gente del lado del cliente/programa (ej. Christian Bonifacio) o de
-- contabilidad (ej. Belén) que no debe ver el resto de la operación.
alter table public.profiles add column bbva_mantenimiento boolean not null default false;

create or replace function public.auth_bbva_mantenimiento()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.bbva_mantenimiento from public.profiles p where p.id = auth.uid()), false)
$$;

drop policy bbva_mantenimiento_select on public.bbva_mantenimiento_snapshots;
create policy bbva_mantenimiento_select on public.bbva_mantenimiento_snapshots
  for select to authenticated
  using (auth_rol() in ('corporativo', 'direccion', 'admin') or auth_bbva_mantenimiento());

drop policy bbva_mantenimiento_insert on public.bbva_mantenimiento_snapshots;
create policy bbva_mantenimiento_insert on public.bbva_mantenimiento_snapshots
  for insert to authenticated
  with check (auth_rol() in ('corporativo', 'admin') or auth_bbva_mantenimiento());
