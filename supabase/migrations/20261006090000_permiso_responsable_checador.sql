-- Responsable de checador (Mario, 5-oct-2026: "más que directivo, lo
-- manejaría en un rol únicamente de responsable de checador", para Valery
-- López, practicante de RH). Es un permiso por persona en permisos_modulo
-- ('checador'), como legal o comedor: quien lo tiene ve las entradas y
-- salidas de todo el personal de SU organización, sin abrir expedientes ni
-- el resto de RH. Se asigna en RH → Accesos ("Responsable de checador").
--
-- Ya aplicado en producción.

alter table public.permisos_modulo drop constraint if exists permisos_modulo_modulo_check;
alter table public.permisos_modulo add constraint permisos_modulo_modulo_check
  check (modulo in ('inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva', 'comedor', 'legal', 'checador'));

create or replace function public.auth_ve_checador_de(p_profile_id uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select p_profile_id = auth.uid()
    or public.auth_rol() in ('rh', 'admin', 'directivo')
    or exists (select 1 from public.personal pe where pe.profile_id = p_profile_id and pe.supervisor_profile_id = auth.uid())
    or (public.auth_bbva_mantenimiento() and exists (select 1 from public.personal pe where pe.profile_id = p_profile_id and pe.area = 'bbva_puebla'))
    or (exists (select 1 from public.permisos_modulo pm where pm.profile_id = auth.uid() and pm.modulo = 'checador')
        and exists (select 1 from public.profiles yo join public.profiles otro on otro.grupo_id = yo.grupo_id
                     where yo.id = auth.uid() and otro.id = p_profile_id))
$$;

-- Valery López: de directivo (puesto el 5-oct) a su rol administrativo con
-- el permiso de responsable de checador.
update public.profiles set rol = 'administrativo'
 where id = 'dc42b2fe-3841-4409-90c3-032a5add7cb3' and rol = 'directivo';
insert into public.permisos_modulo (profile_id, modulo)
select id, 'checador' from public.profiles where id = 'dc42b2fe-3841-4409-90c3-032a5add7cb3'
on conflict do nothing;
