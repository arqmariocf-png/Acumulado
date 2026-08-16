-- Helpers de RLS: leen el perfil del usuario autenticado una sola vez por
-- statement. SECURITY DEFINER + search_path fijo para evitar hijacking de
-- search_path. Van después de profiles porque dependen de esa tabla.
create or replace function public.auth_rol()
returns public.app_rol
language sql
security definer
stable
set search_path = public
as $$
  select rol from public.profiles where id = auth.uid()
$$;

create or replace function public.auth_empresa_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select empresa_id from public.profiles where id = auth.uid()
$$;

-- Un usuario "ve todas las empresas" si es corporativo/admin o si su empresa_id
-- es NULL explícitamente (dirección corporativa de solo lectura). El caso
-- 'pendiente' (empresa_id NULL por defecto) se excluye aparte en cada policy
-- de SELECT con `auth_rol() <> 'pendiente'`, para no darle acceso por accidente.
create or replace function public.auth_ve_todas_empresas()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_rol() in ('corporativo', 'admin') or public.auth_empresa_id() is null
$$;

create or replace function public.auth_puede_escribir()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_rol() in ('corporativo', 'empresa', 'admin')
$$;
