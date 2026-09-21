-- 21-sep-2026:
-- 1. Corrección: nombre_comparable llamaba unaccent sin esquema y las
--    funciones definer fijan search_path = public, donde no está la
--    extensión (vive en "extensions"): fn_equilibrio_bbva_* fallaban.
-- 2. Checador con pausa para comida: comida_inicio / comida_fin. Solo la
--    entrada y la salida piden foto; la comida pide ubicación.
-- 3. El encargado del área (permiso bbva_mantenimiento) ve las marcas de
--    su equipo (personal.area = bbva_puebla), sin poder asignar a nadie:
--    el área la marca RH.
create or replace function public.nombre_comparable(p text)
returns text language sql stable as $$
  select regexp_replace(lower(extensions.unaccent(regexp_replace(coalesce(p, ''), '_[A-Za-z]+$', ''))), '\s+', ' ', 'g')
$$;

alter table public.checador_registros drop constraint checador_registros_tipo_check;
alter table public.checador_registros
  add constraint checador_registros_tipo_check check (tipo in ('entrada', 'salida', 'comida_inicio', 'comida_fin'));

-- Equipo del encargado: personas del área con cuenta ligada.
create or replace function public.auth_ve_checador_de(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_profile_id = auth.uid()
    or public.auth_rol() in ('rh', 'admin')
    or (public.auth_bbva_mantenimiento() and exists (select 1 from public.personal pe where pe.profile_id = p_profile_id and pe.area = 'bbva_puebla'))
$$;

drop policy checador_registros_select on public.checador_registros;
create policy checador_registros_select on public.checador_registros
  for select
  using (public.auth_ve_checador_de(profile_id));

create or replace view public.v_checador_marcas with (security_invoker = false) as
select r.id, r.profile_id, coalesce(pe.nombre, p.nombre) as nombre, r.tipo, r.created_at, r.lat, r.lng, r.precision_m,
  r.foto_path is not null as tiene_foto, r.dispositivo
from public.checador_registros r
join public.profiles p on p.id = r.profile_id
left join public.personal pe on pe.profile_id = r.profile_id
where public.auth_ve_checador_de(r.profile_id);
