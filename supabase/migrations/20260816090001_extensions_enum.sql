-- Extensiones base
create extension if not exists "pgcrypto";

-- Roles de aplicación reconocidos. Fijos a nivel de esquema (el spec pide que la
-- ASIGNACIÓN usuario->rol sea configurable por admin vía datos, no que el conjunto
-- de roles sea dinámico) — ver profiles.rol más abajo. 'pendiente' es el default
-- de un usuario recién registrado: sin acceso hasta que el admin le asigne rol real.
create type public.app_rol as enum ('pendiente', 'corporativo', 'empresa', 'direccion', 'admin');

-- Deriva el periodo AAAAMM de una fecha. Se usa en columnas generadas
-- (STORED), que en Postgres exigen una función IMMUTABLE — to_char() no
-- califica porque depende del locale, por eso se arma a mano con extract().
create or replace function public.periodo_aaaamm(fecha date)
returns text
language sql
immutable
as $$
  select lpad(extract(year from fecha)::int::text, 4, '0')
      || lpad(extract(month from fecha)::int::text, 2, '0')
$$;
