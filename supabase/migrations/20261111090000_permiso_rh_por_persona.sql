-- Acceso a Recursos humanos por persona (11-nov-2026, Mario: "dale acceso a
-- Laura al sistema de RH"). Laura es `direccion`; RH está amarrado al rol
-- `rh` en ~50 policies y ~15 funciones, y cambiarle el rol le quitaría
-- finanzas. Mismo molde que contabilidad/tesorería: permiso por persona
-- `permisos_modulo` 'rh'.
--
-- En la base: `auth_tiene_permiso_rh()`; `auth_rol_rh()` /
-- `auth_rol_rh_definer()` = el rol de siempre, salvo que la persona tenga el
-- permiso: entonces 'rh'. Las policies que nombran 'rh'::app_rol (y no lo
-- excluyen) pasan a leer el rol por esas funciones; igual las funciones de
-- checador, nómina externa, comedor y equilibrio BBVA que lo comparan con
-- `auth_rol()`. Las que leen `profiles.rol` directo (RH directivo, EPP) se
-- parchan a mano. NO se tocan `auth_ve_datos_financieros` (ahí 'rh' está
-- excluido: Laura seguiría sin finanzas), ni fn_rh_de / escalamientos
-- (quién recibe los avisos de RH). En la app: `esRh(p)` en `lib/modulos.ts`.
-- Ya aplicado en producción (permiso_rh_por_persona).

alter table public.permisos_modulo drop constraint if exists permisos_modulo_modulo_check;
alter table public.permisos_modulo add constraint permisos_modulo_modulo_check check (modulo = any (array[
  'inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva', 'comedor', 'legal',
  'checador', 'contabilidad', 'tesoreria', 'punto_venta', 'compras', 'cotizador', 'herramienta', 'cumplimiento', 'caja', 'logistica', 'rh']));

create or replace function public.auth_tiene_permiso_rh()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.permisos_modulo pm
    join public.profiles p on p.id = pm.profile_id
    where pm.profile_id = auth.uid() and pm.modulo = 'rh'
      and p.activo and not coalesce(p.espectador, false) and p.rol <> 'pendiente')
$$;
revoke all on function public.auth_tiene_permiso_rh() from public, anon;
grant execute on function public.auth_tiene_permiso_rh() to authenticated;

create or replace function public.auth_rol_rh()
returns public.app_rol language sql stable security definer set search_path = public as $$
  select case when r <> 'pendiente' and public.auth_tiene_permiso_rh() then 'rh'::public.app_rol else r end
    from (select public.auth_rol() as r) x
$$;
create or replace function public.auth_rol_rh_definer()
returns public.app_rol language sql stable security definer set search_path = public as $$
  select case when r is not null and r <> 'pendiente' and public.auth_tiene_permiso_rh() then 'rh'::public.app_rol else r end
    from (select public.auth_rol_definer() as r) x
$$;
revoke all on function public.auth_rol_rh() from public, anon;
revoke all on function public.auth_rol_rh_definer() from public, anon;
grant execute on function public.auth_rol_rh() to authenticated;
grant execute on function public.auth_rol_rh_definer() to authenticated;

-- Policies que nombran 'rh'::app_rol: el rol se lee por auth_rol_rh*.
do $x$
declare r record; q text; w text; n int := 0;
begin
  for r in
    select tablename, policyname, qual, with_check from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) ~ '''rh''::app_rol'
       and (coalesce(qual, '') || coalesce(with_check, '')) !~ '<> ''rh''::app_rol'
  loop
    q := regexp_replace(regexp_replace(r.qual, '\mauth_rol_definer\(\)', 'auth_rol_rh_definer()', 'g'), '\mauth_rol\(\)', 'auth_rol_rh()', 'g');
    w := regexp_replace(regexp_replace(r.with_check, '\mauth_rol_definer\(\)', 'auth_rol_rh_definer()', 'g'), '\mauth_rol\(\)', 'auth_rol_rh()', 'g');
    if q is distinct from r.qual or w is distinct from r.with_check then
      execute format('alter policy %I on public.%I %s %s', r.policyname, r.tablename,
        case when r.qual is not null then 'using (' || q || ')' else '' end,
        case when r.with_check is not null then 'with check (' || w || ')' else '' end);
      n := n + 1;
    end if;
  end loop;
  raise notice 'policies de RH reescritas: %', n;
end $x$;

-- Funciones que comparan auth_rol() con 'rh' (RH como uno más de los permitidos).
do $x$
declare r record; d text; n text;
begin
  for r in
    select p.oid, p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in (
       'auth_aplica_nomina_comedor', 'auth_ve_checador_de', 'auth_ve_equilibrio_bbva',
       'checador_ajustar_marca', 'checador_anular_marca', 'checador_asignar_ubicacion',
       'checador_marca_manual', 'checador_reclasificar_marcas', 'fn_checador_cerrar_jornadas',
       'marcar_error_sincronizacion_nomina_externa', 'reemplazar_renglones_nomina_externa')
  loop
    d := pg_get_functiondef(r.oid);
    n := regexp_replace(d, '\mauth_rol\(\)', 'auth_rol_rh()', 'g');
    if n <> d then execute n; end if;
  end loop;
end $x$;

-- Funciones que leen profiles.rol directo: el permiso cuenta como rh.
do $x$
declare d text; n text; f text;
begin
  foreach f in array array['auth_rh_directivo', 'auth_rh_directivo_definer'] loop
    d := pg_get_functiondef(('public.' || f)::regproc);
    n := replace(d, $r$(pr.rol = 'rh' and coalesce(pr.rh_nivel, 'directivo') = 'directivo')$r$,
                    $r$((pr.rol = 'rh' or public.auth_tiene_permiso_rh()) and coalesce(pr.rh_nivel, 'directivo') = 'directivo')$r$);
    if n = d then raise exception '% no tenía la condición esperada', f; end if;
    execute n;
  end loop;

  d := pg_get_functiondef('public.auth_opera_epp'::regproc);
  n := replace(d, $r$p.rol in ('rh', 'admin')$r$, $r$(p.rol in ('rh', 'admin') or public.auth_tiene_permiso_rh())$r$);
  if n = d then raise exception 'auth_opera_epp no tenía la condición esperada'; end if;
  execute n;

  d := pg_get_functiondef('public.auth_solicita_epp'::regproc);
  n := replace(d, $r$p.rol in ('rh', 'admin', 'supervisor', 'responsable')$r$, $r$(p.rol in ('rh', 'admin', 'supervisor', 'responsable') or public.auth_tiene_permiso_rh())$r$);
  if n = d then raise exception 'auth_solicita_epp no tenía la condición esperada'; end if;
  execute n;
end $x$;
