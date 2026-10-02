-- Equipo de BBVA (Fernando, 2-oct-2026: "el equipo de BBVA ya tiene
-- precargados roles y no puedo asignar a Christian como supervisor y su gente
-- como operadores"). Christian es 'responsable' con bbva_mantenimiento y su
-- gente tiene roles de BBVA (supervisor_bbva para las cuadrillas de folios,
-- operativo): esos roles mueven el módulo de BBVA y no se tocan.
--
-- Lo que hacía falta es que el JEFE se asigne sin importar el rol: quien
-- está puesto como supervisor de una persona (personal.supervisor_profile_id,
-- columna "Supervisor" en RH → Accesos) ve su checador, tenga el rol que
-- tenga. Antes solo contaba si su rol era exactamente 'supervisor'.
--
-- Ya aplicado en producción.

create or replace function public.auth_ve_checador_de(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_profile_id = auth.uid()
    or public.auth_rol() in ('rh', 'admin', 'directivo')
    or exists (select 1 from public.personal pe where pe.profile_id = p_profile_id and pe.supervisor_profile_id = auth.uid())
    or (public.auth_bbva_mantenimiento() and exists (select 1 from public.personal pe where pe.profile_id = p_profile_id and pe.area = 'bbva_puebla'))
$$;
