-- Rendimiento (Mario: "está muy lento", 28-sep-2026). Las policies llamaban
-- a los helpers de alcance POR FILA (auth_rol(), empresa_en_alcance(fila),
-- empresa_en_mi_organizacion(fila)…) y cada llamada es una consulta
-- SECURITY DEFINER: ~0.35-2 ms por fila, 1-8 s en tablas de 2-3 mil
-- renglones, aunque el resultado no cambie dentro de la consulta.
--
-- Truco estándar de Postgres: `(select f())` dentro de la policy se evalúa
-- UNA vez por consulta (InitPlan). Medido en movimientos (2 107 filas, Laura):
-- 4 400 ms con las funciones por fila → 9 ms con InitPlans.
--
-- OJO: NO sirve envolver el `(select …)` dentro de una función SQL: Postgres
-- no inlina funciones cuyo cuerpo tiene subconsulta, y se vuelve peor (dos
-- llamadas por fila). Por eso el `(select …)` se escribe en la policy misma.
-- Aquí se reescriben todas las policies por regexp sobre pg_policy:
--
--   auth_rol()                    → (select public.auth_rol_definer())
--   <helper sin args>()           → (select public.<helper>_definer())
--   empresa_en_alcance(X)         → (X = any ((select public.auth_empresas_alcance())::uuid[]))
--   empresa_en_mi_organizacion(X) → (X = any ((select public.auth_empresas_organizacion())::uuid[]))
--   grupo_en_alcance(X), perfil_en_alcance(X), auth_modulo_habilitado('c'),
--   auth_tiene_modulo('m'), tablero_visible(X): igual, contra un arreglo.
--
-- Las funciones originales se quedan (las llaman otras funciones y RPC); las
-- copias `_definer` son idénticas y existen para que la policy tenga un
-- nombre estable que llamar una sola vez. **Regla nueva: en una policy nunca
-- se llama a un helper directo por fila; se usa `(select helper_definer())`
-- o `X = any ((select arreglo())::uuid[])`.** Ya aplicado en producción.

-- 1. Copias _definer de los helpers sin argumentos -------------------------
do $$
declare
  nombre text;
  def text;
begin
  foreach nombre in array array[
    'auth_admin_global', 'auth_bbva_mantenimiento', 'auth_empresa_id', 'auth_es_socio', 'auth_grupo_id',
    'auth_opera_proyectos_empresa', 'auth_puede_administrar_tableros', 'auth_puede_comprobar_gasto',
    'auth_puede_escribir', 'auth_puede_escribir_inventario', 'auth_puede_escribir_pu', 'auth_revisa_gastos',
    'auth_rh_directivo', 'auth_rol', 'auth_rol_basico', 'auth_suscripcion_permite_escribir',
    'auth_ve_datos_bancarios', 'auth_ve_datos_financieros', 'auth_ve_todas_empresas'
  ] loop
    if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = nombre || '_definer') then
      continue;
    end if;
    select pg_get_functiondef(p.oid) into def
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = nombre and p.pronargs = 0;
    if def is null then raise exception 'No existe public.%()', nombre; end if;
    def := replace(def, 'FUNCTION public.' || nombre || '()', 'FUNCTION public.' || nombre || '_definer()');
    execute def;
    execute format('revoke execute on function public.%I() from public; grant execute on function public.%I() to authenticated, service_role', nombre || '_definer', nombre || '_definer');
  end loop;
end $$;

-- 2. Arreglos por usuario (una consulta cada uno, SECURITY DEFINER) ---------
create or replace function public.auth_empresas_organizacion()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(e.id), '{}'::uuid[])
  from public.profiles pr
  left join public.grupos g on g.id = pr.grupo_id
  join public.empresas e on ((pr.rol = 'admin' and coalesce(g.es_maestro, false)) or e.grupo_id = pr.grupo_id)
  where pr.id = auth.uid()
$$;
create or replace function public.auth_grupos_alcance()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when pr.rol = 'admin' and coalesce(g.es_maestro, false) then (select array_agg(id) from public.grupos)
    when pr.grupo_id is not null then array[pr.grupo_id]
    else '{}'::uuid[] end
  from public.profiles pr left join public.grupos g on g.id = pr.grupo_id
  where pr.id = auth.uid()
$$;
create or replace function public.auth_modulos_habilitados()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(gm.modulo_clave), '{}'::text[])
  from public.profiles pr
  join public.grupo_modulos gm on gm.grupo_id = pr.grupo_id and gm.habilitado
  where pr.id = auth.uid()
$$;
create or replace function public.auth_modulos_asignados()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(pm.modulo), '{}'::text[]) from public.permisos_modulo pm where pm.profile_id = auth.uid()
$$;
create or replace function public.auth_perfiles_alcance()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}'::uuid[])
  from public.profiles p
  where p.grupo_id = any (public.auth_grupos_alcance())
$$;
revoke execute on function public.auth_empresas_organizacion(), public.auth_grupos_alcance(), public.auth_modulos_habilitados(), public.auth_modulos_asignados(), public.auth_perfiles_alcance() from public;
grant execute on function public.auth_empresas_organizacion(), public.auth_grupos_alcance(), public.auth_modulos_habilitados(), public.auth_modulos_asignados(), public.auth_perfiles_alcance() to authenticated, service_role;

-- 3. Reescritura de las policies ------------------------------------------
-- (plpgsql no admite funciones anidadas: el reescritor es una función
-- temporal que se borra al final).
create or replace function public.tmp_reescribir_policy(t text) returns text language plpgsql as $f$
begin
  if t is null then return null; end if;
  t := regexp_replace(t, '\mempresa_en_alcance\(([A-Za-z_][A-Za-z0-9_.]*)\)', '(\1 = any ((select public.auth_empresas_alcance())::uuid[]))', 'g');
  t := regexp_replace(t, '\mempresa_en_mi_organizacion\(([A-Za-z_][A-Za-z0-9_.]*)\)', '(\1 = any ((select public.auth_empresas_organizacion())::uuid[]))', 'g');
  t := regexp_replace(t, '\mgrupo_en_alcance\(([A-Za-z_][A-Za-z0-9_.]*)\)', '(\1 is not null and \1 = any ((select public.auth_grupos_alcance())::uuid[]))', 'g');
  t := regexp_replace(t, '\mperfil_en_alcance\(([A-Za-z_][A-Za-z0-9_.]*)\)', '(\1 = any ((select public.auth_perfiles_alcance())::uuid[]))', 'g');
  t := regexp_replace(t, '\mauth_modulo_habilitado\(''([a-z_]+)''::text\)', '((select public.auth_admin_global_definer()) or (''\1''::text = any ((select public.auth_modulos_habilitados())::text[])))', 'g');
  t := regexp_replace(t, '\mauth_tiene_modulo\(''([a-z_]+)''::text\)', '(''\1''::text = any ((select public.auth_modulos_asignados())::text[]))', 'g');
  t := regexp_replace(t, '\mtablero_visible\(([A-Za-z_][A-Za-z0-9_.]*)\)', '((select public.auth_rol_definer()) <> ''pendiente''::app_rol and (\1 is null or (select public.auth_ve_todas_empresas_definer()) or \1 = any ((select public.auth_empresas_alcance())::uuid[])))', 'g');
  return t;
end $f$;

do $$
declare
  r record;
  q text;
  wc text;
  n int := 0;
  nombre text;
  helpers text[] := array[
    'auth_admin_global', 'auth_bbva_mantenimiento', 'auth_empresa_id', 'auth_es_socio', 'auth_grupo_id',
    'auth_opera_proyectos_empresa', 'auth_puede_administrar_tableros', 'auth_puede_comprobar_gasto',
    'auth_puede_escribir', 'auth_puede_escribir_inventario', 'auth_puede_escribir_pu', 'auth_revisa_gastos',
    'auth_rh_directivo', 'auth_rol', 'auth_rol_basico', 'auth_suscripcion_permite_escribir',
    'auth_ve_datos_bancarios', 'auth_ve_datos_financieros', 'auth_ve_todas_empresas'];
begin
  for r in
    select c.relname tabla, p.polname, p.polcmd::text cmd, p.polpermissive perm,
           pg_get_expr(p.polqual, p.polrelid) q, pg_get_expr(p.polwithcheck, p.polrelid) wc,
           (select string_agg(quote_ident(rolname), ', ') from pg_roles where oid = any(p.polroles)) roles
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
  loop
    q := public.tmp_reescribir_policy(r.q);
    wc := public.tmp_reescribir_policy(r.wc);
    foreach nombre in array helpers loop
      q := regexp_replace(q, '\m' || nombre || '\(\)', '(select public.' || nombre || '_definer())', 'g');
      wc := regexp_replace(wc, '\m' || nombre || '\(\)', '(select public.' || nombre || '_definer())', 'g');
    end loop;
    if q is not distinct from r.q and wc is not distinct from r.wc then continue; end if;
    execute format('drop policy if exists %I on public.%I; create policy %I on public.%I as %s for %s to %s%s%s',
      r.polname, r.tabla, r.polname, r.tabla,
      case when r.perm then 'permissive' else 'restrictive' end,
      case r.cmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
      coalesce(r.roles, 'public'),
      case when q is not null then ' using (' || q || ')' else '' end,
      case when wc is not null then ' with check (' || wc || ')' else '' end);
    n := n + 1;
  end loop;
  raise notice 'helpers una vez por consulta: % policies reescritas', n;
end $$;
drop function public.tmp_reescribir_policy(text);
