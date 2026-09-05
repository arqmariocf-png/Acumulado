#!/usr/bin/env bash
#
# Aplica todas las migraciones sobre una base limpia y corre las
# verificaciones SQL. Se apoya en bootstrap_local.sql para simular lo que
# Supabase da de fábrica (esquema auth, roles, auth.uid()).
#
#   supabase/tests/correr.sh
#
# Necesita un Postgres local al que las variables PG* estándar apunten
# (PGHOST/PGPORT/PGUSER/PGPASSWORD) y un usuario que pueda crear bases. Es
# lo que hay hasta que se pueda probar contra un proyecto Supabase real: no
# cubre Auth, Storage ni el runtime de edge functions -- sólo esquema,
# triggers, vistas y RLS, que es donde vive la lógica de Precios Unitarios.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRACIONES="$AQUI/../migrations"
DB="${PU_TEST_DB:-acumulado_pu_test}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

psql_db() { psql -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }

cp "$MIGRACIONES"/*.sql "$TMP/"

# `http` es una extensión de contrib que casi nunca está en un Postgres
# local. Cuando falta se comenta el `create extension` en la copia temporal
# (bootstrap_local.sql ya dejó funciones stub con la misma firma) -- las
# migraciones del repo no se tocan.
if ! psql -tAc "select 1 from pg_available_extensions where name = 'http'" | grep -q 1; then
  echo "aviso: la extensión 'http' no está disponible; se usa el stub de bootstrap_local.sql"
  sed -i.bak 's/^create extension if not exists http with schema extensions;/-- (omitido en pruebas locales: extensión http no disponible)/' \
    "$TMP"/*sync_catalogo_oc_ov.sql
  rm -f "$TMP"/*.bak
fi

dropdb --if-exists "$DB"
createdb "$DB"

psql_db -f "$AQUI/bootstrap_local.sql" > /dev/null

for f in "$TMP"/*.sql; do
  if ! psql_db -f "$f" > /dev/null; then
    echo "FALLÓ la migración $(basename "$f")" >&2
    exit 1
  fi
done
echo "ok: $(ls "$TMP"/*.sql | wc -l | tr -d ' ') migraciones aplicaron sobre una base limpia"

psql_db -f "$AQUI/pu_verificacion.sql"
