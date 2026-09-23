#!/usr/bin/env bash
# Levanta un Postgres local, aplica TODAS las migraciones en orden y corre las
# pruebas SQL de supabase/tests/. Es la única forma de validar RLS sin tocar el
# proyecto Supabase real -- y RLS es donde vive casi toda la lógica de
# seguridad de este proyecto (organizaciones, módulos y suscripción).
#
#   ./scripts/validar-sql.sh
#
# Requiere postgresql (initdb/pg_ctl/psql). No usa Docker a propósito: en los
# entornos donde se desarrolla esto no siempre hay demonio de Docker.
#
# Lo que monta es un shim MÍNIMO de Supabase (esquema auth con users y uid(),
# esquema storage, y los roles anon/authenticated/service_role), que es todo
# lo que las migraciones tocan fuera de `public`. No sustituye a correr los
# advisors contra el proyecto real después de desplegar.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRABAJO="${TMPDIR:-/tmp}/acumulado-validar-sql"
PUERTO="${PGPORT_VALIDACION:-5433}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$BIN" ] && PATH="$BIN:$PATH"

command -v initdb >/dev/null || { echo "No se encontró initdb. Instala PostgreSQL."; exit 1; }

# Postgres no corre como root; si el script se invoca como root se delega en el
# usuario postgres del sistema.
CORRER=""
if [ "$(id -u)" -eq 0 ]; then
  id postgres >/dev/null 2>&1 || { echo "Corriendo como root y no existe el usuario postgres."; exit 1; }
  CORRER="su postgres -c"
fi

# `su` no hereda el PATH de root, y los binarios de Postgres no suelen estar
# en el PATH del usuario postgres: por eso se pasa explícito en cada comando.
ejecutar() {
  if [ -n "$CORRER" ]; then
    $CORRER "export PATH='$PATH'; $1"
  else
    bash -c "$1"
  fi
}

limpiar() {
  ejecutar "pg_ctl -D '$TRABAJO/data' stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$TRABAJO"
}
trap limpiar EXIT

rm -rf "$TRABAJO"; mkdir -p "$TRABAJO"
cp -r "$RAIZ/supabase/migrations" "$TRABAJO/migrations"
cp "$RAIZ"/supabase/tests/*.sql "$TRABAJO/"
[ -n "$CORRER" ] && chown -R postgres:postgres "$TRABAJO"

ejecutar "initdb -U postgres -A trust -D '$TRABAJO/data'" >/dev/null 2>&1
ejecutar "pg_ctl -D '$TRABAJO/data' -o \"-k $TRABAJO -p $PUERTO -c listen_addresses=''\" -l '$TRABAJO/pg.log' start" >/dev/null 2>&1
sleep 2

PSQL="psql -h $TRABAJO -p $PUERTO -U postgres -v ON_ERROR_STOP=1 -q"

cat > "$TRABAJO/shim.sql" <<'SQL'
-- Los roles son del CLUSTER, no de la base: al crear la segunda base de
-- pruebas ya existen. Por eso el alta es condicional.
do $$
declare rol text;
begin
  foreach rol in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = rol) then
      execute format('create role %I nologin', rol);
    end if;
  end loop;
end
$$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
SQL
[ -n "$CORRER" ] && chown postgres:postgres "$TRABAJO/shim.sql"

fallos=0
for prueba in "$TRABAJO"/*.sql; do
  [ "$(basename "$prueba")" = "shim.sql" ] && continue

  # Base limpia por prueba: cada archivo de supabase/tests/ siembra sus propios
  # usuarios y datos, y dos pruebas en la misma base se pisarían.
  ejecutar "$PSQL -d postgres -c 'drop database if exists acumulado_validacion'" >/dev/null 2>&1 || true
  ejecutar "$PSQL -d postgres -c 'create database acumulado_validacion'" >/dev/null
  ejecutar "$PSQL -d acumulado_validacion -f '$TRABAJO/shim.sql'" >/dev/null 2>&1

  for migracion in $(ls "$TRABAJO"/migrations/*.sql | sort); do
    if ! ejecutar "$PSQL -d acumulado_validacion -f '$migracion'" >/dev/null 2>"$TRABAJO/err.log"; then
      echo "✗ falló la migración $(basename "$migracion")"
      tail -5 "$TRABAJO/err.log"
      exit 1
    fi
  done

  salida="$TRABAJO/$(basename "$prueba" .sql).out"
  if ejecutar "psql -h $TRABAJO -p $PUERTO -U postgres -d acumulado_validacion -v ON_ERROR_STOP=1 -f '$prueba'" > "$salida" 2>&1; then
    echo "✓ $(basename "$prueba")"
    grep -E "^(NOTICE|psql.*NOTICE)" "$salida" | sed 's/.*NOTICE: */  /' || true
  else
    echo "✗ $(basename "$prueba")"
    grep -E "ERROR|FALLA" "$salida" | head -5
    fallos=$((fallos + 1))
  fi
done

if [ "$fallos" -gt 0 ]; then
  echo "$fallos prueba(s) SQL fallaron"
  exit 1
fi
echo "Migraciones aplicadas y pruebas SQL en verde."
