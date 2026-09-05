-- Lo mínimo que Supabase provee de fábrica y que las migraciones dan por
-- hecho, para poder aplicarlas contra un Postgres pelón y verificar el
-- esquema sin levantar un proyecto real.
--
-- NO es parte del esquema de la app: nada de esto se despliega. Sólo existe
-- para que `correr.sh` pueda probar migraciones, triggers y RLS localmente.

create extension if not exists "pgcrypto";

do $$ begin create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin;
exception when duplicate_object then null; end $$;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- En Supabase, auth.uid() sale del JWT. Aquí sale de una variable de sesión,
-- así que una prueba puede "entrar" como cualquier usuario con
--   set local role authenticated;
--   set local request.jwt.claim.sub = '<uuid>';
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function auth.role() returns text
language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

-- Grants que Supabase da de fábrica. Sin ellos, auth.uid() truena dentro de
-- un trigger que corre como `authenticated`.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- La extensión `http` (que usa sincronizar_catalogo_oc_ov para llamar al
-- backoffice desde la base) casi nunca está instalada en un Postgres local.
-- Se simula lo justo para que esa migración compile; correr.sh se encarga de
-- que el `create extension` no truene. La función que la usa nunca se
-- ejecuta en estas pruebas.
create schema if not exists extensions;
create or replace function extensions.http_set_curlopt(text, text) returns boolean
language sql as $$ select true $$;
do $$ begin
  create type extensions.http_response as (status integer, content text);
exception when duplicate_object then null; end $$;
create or replace function extensions.http_get(text) returns extensions.http_response
language sql as $$ select (599, '[]')::extensions.http_response $$;
