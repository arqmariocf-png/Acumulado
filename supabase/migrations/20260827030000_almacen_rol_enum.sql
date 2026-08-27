-- Nuevo rol para el área de almacén (captura de entradas/salidas de
-- inventario en las 8 empresas). Va en su propia migración porque Postgres
-- no permite usar un valor de enum recién agregado (ALTER TYPE ... ADD
-- VALUE) dentro de la misma transacción en la que se agregó -- mismo
-- motivo que 'rh' en 20260821090001_rh_rol_enum.sql.
alter type public.app_rol add value 'almacen';
