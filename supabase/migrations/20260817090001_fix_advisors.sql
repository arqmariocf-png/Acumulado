-- Correcciones a partir de los advisors de seguridad de Supabase, corridos
-- después del primer despliegue real contra el proyecto zdqahpzijkkcnfehbggs.
--
-- (rls_auto_enable() también aparece en el advisor pero es infraestructura
-- propia de Supabase -- un event trigger que fuerza RLS en tablas nuevas de
-- public -- no se toca aquí.)

-- ── 1) function_search_path_mutable ─────────────────────────────────────
-- Estas tres funciones no fijaban search_path explícitamente (a diferencia
-- de los helpers de RLS en 20260816090003, que sí lo tenían desde el
-- inicio). No son SECURITY DEFINER, pero fijar el search_path sigue siendo
-- buena práctica: evita que una función de trigger resuelva un objeto
-- inesperado si algún día el search_path de la sesión cambia.
alter function public.periodo_aaaamm(date) set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.check_movimientos_version() set search_path = public;

-- ── 2) *_security_definer_function_executable ───────────────────────────
-- Supabase expone automáticamente TODA función del esquema public vía
-- PostgREST (POST /rest/v1/rpc/<nombre>), con EXECUTE otorgado a
-- anon/authenticated por default de Postgres. El advisor marca 6 funciones;
-- se tratan distinto según si algo depende de que authenticated pueda
-- invocarlas:
--
-- handle_new_user() y audit_movimientos() SOLO se invocan como funciones de
-- trigger (on_auth_user_created, movimientos_audit). Postgres dispara
-- triggers sin pasar por el chequeo de privilegio EXECUTE de quien originó
-- la sentencia -- revocar el EXECUTE directo es seguro y no afecta que
-- sigan disparándose como triggers.
--
-- OJO: el EXECUTE por default de una función nueva se otorga a PUBLIC (el
-- pseudo-rol del que anon/authenticated/cualquier rol son miembros), no a
-- anon/authenticated individualmente. `revoke ... from anon, authenticated`
-- es un no-op silencioso si el grant real está en PUBLIC -- lo confirmé
-- primero con la versión incorrecta (no quitó el privilegio) y lo corregí
-- a `from public`, validado con has_function_privilege() antes y después.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.audit_movimientos() from public;

-- auth_rol(), auth_empresa_id(), auth_puede_escribir() y
-- auth_ve_todas_empresas() son justo lo opuesto: TODAS las policies de RLS
-- de 20260816090009 las invocan dentro de su USING/WITH CHECK, y esas
-- policies se evalúan corriendo como el rol `authenticated` (el rol que
-- PostgREST asume por request). Postgres exige que el rol que ejecuta la
-- consulta tenga EXECUTE sobre cualquier función referenciada en la policy,
-- SECURITY DEFINER o no -- revocarles EXECUTE a `authenticated` rompería
-- toda policy de la aplicación (toda tabla quedaría inaccesible incluso
-- para su dueño legítimo).
--
-- Quedan, entonces, llamables directo vía RPC -- pero eso no filtra nada:
-- las cuatro solo devuelven datos derivados del propio auth.uid() de quien
-- llama (su propio rol/empresa), lo mismo que ya podría leer con
-- `select rol, empresa_id from profiles where id = auth.uid()`. Revisado y
-- aceptado como hallazgo de severidad baja, no un problema real en este
-- esquema -- ver discusión completa en el historial de la sesión.
