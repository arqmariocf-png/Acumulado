-- Repara el historial: v_directorio se usa en 20260924160000_accesos_personal_modulos
-- pero ninguna migración la creaba -- existía solo en el proyecto de Supabase.
-- Leída de pg_get_viewdef del proyecto zdqahpzijkkcnfehbggs; en producción es
-- un no-op.
create or replace view public.v_directorio with (security_invoker = true) as
select id, nombre, rol, activo
from public.profiles p
where (select public.auth_rol()) is not null
  and (select public.auth_rol()) <> 'pendiente'::public.app_rol;
