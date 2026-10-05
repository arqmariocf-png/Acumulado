-- ── Espectador: solo el encabezado y los menús, ningún dato ──────────────
--
-- Mario (2-oct-2026): "el rol de espectador solo ve barra principal y menús,
-- no enseñes información de ninguna empresa". Espectadores hoy: María
-- Alejandra (Estudio K) y Aldo (ARSSA). La marca `profiles.espectador` ya
-- impedía escribir (20260929170000); ahora tampoco lee.
--
-- Cuatro capas, porque los datos llegan por cuatro caminos:
--   1. Tablas: restrictiva de lectura `espectador_sin_datos` en todas las de
--      public salvo las que arman el encabezado y el menú (su organización,
--      sus módulos, su suscripción, catálogos de planes y roles). De
--      profiles solo su propio renglón.
--   2. Helpers de alcance (empresas que ve, empresas de su organización):
--      vacíos para el espectador. Los usan las funciones SECURITY DEFINER de
--      KPIs (fn_kpis_alcance, fn_kpis_empresa_publica, fn_mi_alcance).
--   3. auth_rol() -- la versión que usan las FUNCIONES; las policies usan
--      auth_rol_definer() desde 20260928210000 -- responde 'pendiente' para
--      el espectador, y auth_es_socio / auth_rh_directivo responden false:
--      fn_socio_resumen, fn_pu_explosion_insumos, fn_rh_kpi_* lo rechazan.
--   4. Vistas que corrían como su dueño y se saltaban RLS: las cinco que
--      no cambian nada para los usuarios de Loma (medido como Mario, Laura,
--      Alma, Eréndira y Delia) pasan a security_invoker. v_checador_marcas y
--      v_remisiones_produccion NO: le quitaban marcas a RH y remisiones a
--      almacén; quedan pendientes.
-- Además ninguna de las once vistas de dueño se lee sin sesión (ya aplicado
-- en producción como `vistas_sin_acceso_anonimo`).

revoke all on public.v_remisiones_produccion, public.avance_recepcion_oc, public.avance_embarque_ov,
  public.avance_resolucion_linea, public.v_pu_bandeja_almacen, public.v_pu_analisis_detalle,
  public.v_directorio, public.v_bbva_folio_paso, public.v_supervisores_bbva,
  public.v_checador_marcas, public.v_personal_produccion from anon;

create or replace function public.auth_es_espectador()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select p.espectador from public.profiles p where p.id = auth.uid()), false)
$$;

-- 1. Tablas ----------------------------------------------------------------
do $$
declare
  t record;
  n integer := 0;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relispartition
      and c.relname not in (
        'profiles', 'grupos', 'grupo_modulos', 'modulos', 'suscripciones',
        'planes', 'plan_escalones', 'permisos_modulo', 'roles_alcance',
        'push_subscripciones'
      )
  loop
    execute format('drop policy if exists espectador_sin_datos on public.%I', t.relname);
    execute format(
      'create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
         using (not (select public.auth_es_espectador()))',
      t.relname);
    n := n + 1;
  end loop;
  raise notice 'espectador sin datos: % tablas', n;
end
$$;

create policy espectador_solo_su_perfil on public.profiles as restrictive for select to authenticated
  using (id = (select auth.uid()) or not (select public.auth_es_espectador()));

-- 2. Helpers de alcance ----------------------------------------------------
create or replace function public.auth_empresas_alcance()
returns uuid[]
language sql
stable security definer
set search_path = public
as $$
  select coalesce(array_agg(e.id order by e.nombre), '{}'::uuid[])
  from public.profiles pr
  left join public.grupos g on g.id = pr.grupo_id
  left join public.roles_alcance ra on ra.rol = pr.rol
  join public.empresas e on (
    (pr.rol = 'admin' and coalesce(g.es_maestro, false))
    or (e.grupo_id = pr.grupo_id and (
          pr.rol = 'admin'
          or e.id = pr.empresa_id
          or (coalesce(ra.multiempresa, false) and (
                pr.todas_las_empresas
                or exists (select 1 from public.profile_empresas pe where pe.profile_id = pr.id and pe.empresa_id = e.id)))))
  )
  where pr.id = auth.uid() and pr.rol <> 'pendiente' and not pr.espectador
$$;

create or replace function public.auth_empresas_organizacion()
returns uuid[]
language sql
stable security definer
set search_path = public
as $$
  select coalesce(array_agg(e.id), '{}'::uuid[])
  from public.profiles pr
  left join public.grupos g on g.id = pr.grupo_id
  join public.empresas e on ((pr.rol = 'admin' and coalesce(g.es_maestro, false)) or e.grupo_id = pr.grupo_id)
  where pr.id = auth.uid() and not pr.espectador
$$;

create or replace function public.empresa_en_alcance(p_empresa_id uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    left join public.grupos g on g.id = pr.grupo_id
    left join public.roles_alcance ra on ra.rol = pr.rol
    join public.empresas e on e.id = p_empresa_id
    where pr.id = auth.uid()
      and pr.rol <> 'pendiente'
      and not pr.espectador
      and (
        (pr.rol = 'admin' and coalesce(g.es_maestro, false))
        or (e.grupo_id = pr.grupo_id and (
              pr.rol = 'admin'
              or e.id = pr.empresa_id
              or (coalesce(ra.multiempresa, false) and (
                    pr.todas_las_empresas
                    or exists (select 1 from public.profile_empresas pe where pe.profile_id = pr.id and pe.empresa_id = e.id)))
        ))
      )
  )
$$;

create or replace function public.empresa_en_mi_organizacion(p_empresa_id uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    left join public.grupos g on g.id = pr.grupo_id
    where pr.id = auth.uid()
      and not pr.espectador
      and ((pr.rol = 'admin' and coalesce(g.es_maestro, false))
           or exists (select 1 from public.empresas e where e.id = p_empresa_id and e.grupo_id = pr.grupo_id))
  )
$$;

-- 3. Rol, socio y RH directivo dentro de funciones -------------------------
create or replace function public.auth_rol()
returns app_rol
language sql
stable security definer
set search_path = public
as $$
  select case when espectador then 'pendiente'::app_rol else rol end
  from public.profiles where id = auth.uid()
$$;

create or replace function public.auth_es_socio()
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (select 1 from public.socios_organizacion s where s.profile_id = auth.uid())
     and not public.auth_es_espectador()
$$;

create or replace function public.auth_es_socio_definer()
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (select 1 from public.socios_organizacion s where s.profile_id = auth.uid())
     and not public.auth_es_espectador()
$$;

create or replace function public.auth_rh_directivo()
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and not pr.espectador
      and (pr.rol = 'admin' or (pr.rol = 'rh' and coalesce(pr.rh_nivel, 'directivo') = 'directivo'))
  )
$$;

create or replace function public.auth_rh_directivo_definer()
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and not pr.espectador
      and (pr.rol = 'admin' or (pr.rol = 'rh' and coalesce(pr.rh_nivel, 'directivo') = 'directivo'))
  )
$$;

-- 4. Vistas que corrían como su dueño --------------------------------------
alter view public.avance_recepcion_oc set (security_invoker = true);
alter view public.avance_embarque_ov set (security_invoker = true);
alter view public.avance_resolucion_linea set (security_invoker = true);
alter view public.v_pu_bandeja_almacen set (security_invoker = true);
alter view public.v_pu_analisis_detalle set (security_invoker = true);
