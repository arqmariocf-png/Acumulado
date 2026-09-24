-- Roles de personal contratado (Mario, 24-sep-2026): 'operativo' solo entra
-- al checador (y a los módulos que RH le asigne uno por uno);
-- 'administrativo', 'supervisor' y 'directivo' son la segunda familia de
-- roles, también con acceso por módulo asignado. Los valores del enum van
-- en su propia migración: Postgres no permite usarlos en la misma
-- transacción en que se crean. Ya aplicado en producción.
alter type public.app_rol add value if not exists 'operativo';
alter type public.app_rol add value if not exists 'administrativo';
alter type public.app_rol add value if not exists 'supervisor';
alter type public.app_rol add value if not exists 'directivo';
