-- Acceso al sistema para el personal contratado (Mario, 24-sep-2026):
-- 1. RH crea la cuenta desde Contrataciones cuando el expediente tiene INE,
--    CURP y comprobante de domicilio (edge function admin-crear-usuario, que
--    genera el correo, liga personal.profile_id y manda el link al celular).
-- 2. Rol base 'operativo' = solo checador. Módulos adicionales uno por uno en
--    permisos_modulo (los asigna RH / Fernando). Misma mecánica para
--    'administrativo', 'supervisor' y 'directivo'.
-- 3. 'supervisor' ve las marcas del checador de su gente
--    (personal.supervisor_profile_id); 'directivo' ve las de todos.

alter table public.personal add column if not exists supervisor_profile_id uuid references public.profiles(id) on delete set null;

create table public.permisos_modulo (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  modulo text not null check (modulo in ('inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva')),
  otorgado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (profile_id, modulo)
);
alter table public.permisos_modulo enable row level security;

create or replace function public.auth_rol_basico()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_rol() in ('operativo', 'administrativo', 'supervisor', 'directivo')
$$;

create or replace function public.auth_tiene_modulo(p_modulo text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.permisos_modulo pm where pm.profile_id = auth.uid() and pm.modulo = p_modulo)
$$;

-- Un perfil "administrable por RH": pendiente o de la familia básica y
-- ligado a una persona de RH. Nunca admin/corporativo/etc.
create or replace function public.rh_administra_perfil(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    join public.personal pe on pe.profile_id = p.id
    where p.id = p_profile_id
      and p.rol in ('pendiente', 'operativo', 'administrativo', 'supervisor', 'directivo')
  )
$$;

create policy permisos_modulo_select on public.permisos_modulo
  for select to authenticated using (profile_id = auth.uid() or public.auth_rol() in ('rh', 'admin'));
create policy permisos_modulo_write on public.permisos_modulo
  for all to authenticated
  using (public.auth_rol() = 'admin' or (public.auth_rol() = 'rh' and public.rh_administra_perfil(profile_id)))
  with check (public.auth_rol() = 'admin' or (public.auth_rol() = 'rh' and public.rh_administra_perfil(profile_id)));

-- RH asigna el rol dentro de la familia básica (nunca escala a admin ni a
-- roles financieros): la política de profiles solo deja escribir a admin.
create or replace function public.rh_asignar_rol_basico(p_profile_id uuid, p_rol public.app_rol)
returns void language plpgsql security definer set search_path = public as $$
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
  update public.profiles set rol = p_rol where id = p_profile_id;
end;
$$;
revoke all on function public.rh_asignar_rol_basico(uuid, public.app_rol) from public, anon;
grant execute on function public.rh_asignar_rol_basico(uuid, public.app_rol) to authenticated;

-- Checador: supervisor ve a su gente; directivo ve a todos (solo lectura).
create or replace function public.auth_ve_checador_de(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_profile_id = auth.uid()
    or public.auth_rol() in ('rh', 'admin', 'directivo')
    or (public.auth_rol() = 'supervisor' and exists (select 1 from public.personal pe where pe.profile_id = p_profile_id and pe.supervisor_profile_id = auth.uid()))
    or (public.auth_bbva_mantenimiento() and exists (select 1 from public.personal pe where pe.profile_id = p_profile_id and pe.area = 'bbva_puebla'))
$$;

-- Los módulos asignados dan el mismo permiso que el rol nativo del módulo.
create or replace function public.auth_puede_escribir_inventario()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_puede_escribir() or public.auth_rol() in ('almacen', 'direccion') or public.auth_tiene_modulo('inventario')
$$;

create or replace function public.auth_ve_planta(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_rol() in ('admin', 'corporativo')
    or ((public.auth_rol() = 'produccion' or public.auth_tiene_modulo('produccion')) and (public.auth_empresa_id() is null or public.auth_empresa_id() = p_empresa_id))
$$;

create or replace function public.auth_opera_planta(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_rol() = 'admin'
    or ((public.auth_rol() = 'produccion' or public.auth_tiene_modulo('produccion')) and (public.auth_empresa_id() is null or public.auth_empresa_id() = p_empresa_id))
$$;

create or replace function public.auth_puede_escribir_pu()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_rol() in ('corporativo', 'empresa', 'admin', 'direccion') or public.auth_tiene_modulo('precios')
$$;

create or replace function public.auth_participa_pu(p_empresa_id uuid, p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    (
      (public.auth_rol() = any (array['admin', 'corporativo', 'direccion', 'empresa', 'almacen']::app_rol[]) or public.auth_tiene_modulo('precios'))
      and (public.auth_ve_todas_empresas() or p_empresa_id = public.auth_empresa_id())
    )
    or public.auth_es_supervisor_pu(p_proyecto_id)
$$;

-- Vista para la pestaña "Accesos" de RH: persona, cuenta, rol, módulos y supervisor.
create or replace view public.v_personal_accesos with (security_invoker = true) as
select pe.id as personal_id, pe.nombre, pe.puesto, pe.area, pe.telefono, pe.correo, pe.activo,
  pe.profile_id, p.rol, pe.supervisor_profile_id,
  sup.nombre as supervisor_nombre,
  coalesce((select array_agg(pm.modulo order by pm.modulo) from public.permisos_modulo pm where pm.profile_id = pe.profile_id), '{}'::text[]) as modulos,
  (select count(*) from public.tipos_documento_personal td
     where td.activo and td.nombre in ('INE (copia del original, no fotos)', 'CURP', 'Comprobante de domicilio')
       and exists (select 1 from public.documentos_personal dp where dp.personal_id = pe.id and dp.tipo_documento_id = td.id and (dp.fecha_vigencia is null or dp.fecha_vigencia >= current_date))) as docs_indispensables,
  (select c.empresa_id from public.contrataciones c where c.personal_id = pe.id order by c.fecha_inicio desc limit 1) as empresa_contratacion_id
from public.personal pe
-- v_directorio (y no profiles): RH solo puede leer su propio perfil, pero el
-- directorio expone nombre/rol de cualquier cuenta con acceso.
left join public.v_directorio p on p.id = pe.profile_id
left join public.v_directorio sup on sup.id = pe.supervisor_profile_id;
grant select on public.v_personal_accesos to authenticated;
