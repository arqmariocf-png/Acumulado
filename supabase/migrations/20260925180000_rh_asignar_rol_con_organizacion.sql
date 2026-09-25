-- 25-sep-2026: Fernando (RH) no podía asignarle rol a Jonathan. La rama de
-- ARSSA agregó en producción el check profiles_grupo_rol_check (un rol
-- distinto de 'pendiente' exige grupo_id), y las cuentas creadas desde RH
-- nacían sin organización. rh_asignar_rol_basico ahora completa la
-- organización y la empresa a partir de la contratación vigente (o la
-- organización maestra) antes de poner el rol. Ya aplicado en producción.

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
  if public.auth_rol() not in ('rh', 'admin') then
    raise exception 'Solo RH o un administrador pueden asignar este rol';
  end if;
  if p_rol not in ('operativo', 'administrativo', 'supervisor', 'directivo') then
    raise exception 'Rol no permitido por esta vía: %', p_rol;
  end if;
  if not public.rh_administra_perfil(p_profile_id) then
    raise exception 'Ese perfil no es de personal contratado o ya tiene un rol que solo cambia un administrador';
  end if;

  -- Empresa de la contratación más reciente del expediente ligado a la cuenta.
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

-- Cuentas de personal contratado que quedaron sin organización.
update public.profiles p
   set grupo_id = coalesce(
         (select e.grupo_id
            from public.personal pe
            join public.contrataciones c on c.personal_id = pe.id
            join public.empresas e on e.id = c.empresa_id
           where pe.profile_id = p.id
           order by c.fecha_inicio desc
           limit 1),
         (select g.id from public.grupos g where g.es_maestro limit 1))
 where p.grupo_id is null
   and exists (select 1 from public.personal pe where pe.profile_id = p.id);
