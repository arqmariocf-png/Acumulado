-- Repara el historial de migraciones: `auth_puede_escribir_pu()` se usa en
-- 20260909130000_proyectos_planos_cotizacion_avance.sql (y en las policies de
-- Precios Unitarios) pero NINGUNA migración la creaba -- existía solo en el
-- proyecto de Supabase, creada a mano. Consecuencia: el repositorio no podía
-- reconstruir la base desde cero, que es justo lo que uno necesita el día que
-- algo se pierde o cuando se quiere probar RLS sin tocar producción.
--
-- El cuerpo es el que está vivo hoy en el proyecto zdqahpzijkkcnfehbggs, leído
-- de pg_get_functiondef -- no una reconstrucción a ojo. Va fechada un segundo
-- antes de quien la usa para que el orden de aplicación tenga sentido; en el
-- proyecto real es un no-op (create or replace con el mismo cuerpo).
--
-- Diferencia con auth_puede_escribir(): esta incluye 'direccion'. Precios
-- Unitarios sí deja capturar a dirección; el resto del sistema no.
create or replace function public.auth_puede_escribir_pu()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_rol() in ('corporativo', 'empresa', 'admin', 'direccion')
$$;
