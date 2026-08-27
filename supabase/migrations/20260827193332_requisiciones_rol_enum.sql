-- Nuevo rol para el módulo de Requisiciones: el responsable de un proyecto
-- (residente de obra, típicamente) sube requisiciones solo para SUS
-- proyectos asignados -- nunca ve movimientos bancarios, CFDI, ni el
-- catálogo completo de OC/OV de la empresa. Va en su propia migración por
-- la misma razón que 'rh' (20260821090001_rh_rol_enum.sql): Postgres no
-- permite usar un valor de enum recién agregado en la misma transacción en
-- la que se agregó.
alter type public.app_rol add value 'responsable';
