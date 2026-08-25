-- Las 8 entidades del grupo. Catálogo fijo pero editable por admin (no hardcodeado en código).
create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  codigo text not null unique,
  rfc text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.empresas is 'Las 8 entidades de Grupo Loma. codigo es el identificador corto usado para casar la columna "Empresa" de las cargas.';

-- Extiende auth.users con rol y empresa asignada. Es la ÚNICA fuente de verdad
-- para permisos: el admin edita esta tabla desde el panel, nunca se hardcodea
-- un usuario o rol en código de aplicación.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  rol public.app_rol not null,
  empresa_id uuid references public.empresas (id),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'empresa_id NULL + rol en (corporativo, admin) = acceso a las 8 empresas. rol=empresa SIEMPRE requiere empresa_id.';

-- Un usuario de tesorería por empresa siempre debe tener una empresa asignada;
-- corporativo/admin pueden o no tenerla (NULL = todas). direccion puede ser
-- corporativa (NULL) o de una sola empresa.
alter table public.profiles
  add constraint profiles_empresa_rol_check
  check (rol <> 'empresa' or empresa_id is not null);

create index profiles_empresa_id_idx on public.profiles (empresa_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Crea automáticamente un profile en estado 'pendiente' (sin acceso a ningún dato)
-- cuando se registra un usuario en auth.users. El admin debe asignarle rol y
-- empresa desde el panel antes de que pueda ver nada.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nombre, rol)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'nombre', new.email), 'pendiente');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
