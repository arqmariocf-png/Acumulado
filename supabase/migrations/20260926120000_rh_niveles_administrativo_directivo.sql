-- 26-sep-2026 (Mario): dos niveles dentro de RH.
--   RH directivo (Eréndira, Fernando): todo RH, crea accesos y asigna roles.
--   RH administrativo (Raúl): flujo operativo (contratos, expedientes,
--   personal, asignaciones, checador, actividades); sin Accesos al sistema
--   ni Vacantes y rotación.
-- Se guarda en profiles.rh_nivel (solo aplica al rol rh; null = directivo).
-- La pestaña "Nómina y asistencia" se retira de RH. Ya aplicado en producción.

alter table public.profiles add column if not exists rh_nivel text
  check (rh_nivel in ('administrativo', 'directivo'));
comment on column public.profiles.rh_nivel is 'Solo para rol rh: directivo (todo RH, asigna accesos y roles) o administrativo (flujo operativo: contratos, expedientes, personal, checador, actividades). Null = directivo.';

update public.profiles set rh_nivel = 'directivo' where rol = 'rh' and (nombre ilike 'Eréndira%' or nombre ilike 'Erendira%' or nombre ilike 'Fernando Gómez%' or nombre ilike 'Fernando Gomez%');
update public.profiles set rh_nivel = 'administrativo' where rol = 'rh' and rh_nivel is null;

create or replace function public.auth_rh_directivo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid()
      and (pr.rol = 'admin' or (pr.rol = 'rh' and coalesce(pr.rh_nivel, 'directivo') = 'directivo'))
  )
$$;
revoke all on function public.auth_rh_directivo() from public, anon;
grant execute on function public.auth_rh_directivo() to authenticated;

-- rh_asignar_rol_basico: ahora exige RH directivo (o admin).
create or replace function public.rh_asignar_rol_basico(p_profile_id uuid, p_rol app_rol)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_grupo uuid;
begin
  if not public.auth_rh_directivo() then
    raise exception 'Solo RH directivo o un administrador pueden asignar este rol';
  end if;
  if p_rol not in ('operativo', 'administrativo', 'supervisor', 'directivo') then
    raise exception 'Rol no permitido por esta vía: %', p_rol;
  end if;
  if not public.rh_administra_perfil(p_profile_id) then
    raise exception 'Ese perfil no es de personal contratado o ya tiene un rol que solo cambia un administrador';
  end if;

  select c.empresa_id into v_empresa
  from public.personal pe
  join public.contrataciones c on c.personal_id = pe.id
  where pe.profile_id = p_profile_id
  order by c.fecha_inicio desc
  limit 1;

  select coalesce(
           (select e.grupo_id from public.empresas e where e.id = v_empresa),
           (select g.id from public.grupos g where g.es_maestro limit 1)
         )
    into v_grupo;

  update public.profiles
     set rol = p_rol,
         empresa_id = coalesce(empresa_id, v_empresa),
         grupo_id = coalesce(grupo_id, v_grupo)
   where id = p_profile_id;
end;
$$;
