-- Alcance por persona y por rol, no solo por rol (Mario, 28-sep-2026):
-- "cada empresa funciona por separado; yo activo qué roles manejan más de
-- una". Tres piezas:
--
--   1. roles_alcance(rol, multiempresa): el interruptor por rol que el admin
--      maestro prende desde Admin → Accesos por rol.
--   2. profiles.todas_las_empresas + profile_empresas(profile_id, empresa_id):
--      lo que cada persona maneja además de su empresa principal
--      (profiles.empresa_id sigue siendo la principal: donde checa y donde
--      está su expediente).
--   3. empresa_en_alcance() / auth_ve_todas_empresas() reescritas con esa
--      regla, y las ~40 policies y 13 funciones que comparaban contra UNA
--      empresa (`empresa_id = auth_empresa_id()`) reescritas para usar
--      empresa_en_alcance(): se transforman aquí mismo con regexp sobre
--      pg_policy / pg_proc, de forma determinista, para no reescribir a
--      mano 40 policies.
--
-- Compatibilidad: quien hoy tiene empresa en blanco (veía todas) queda con
-- todas_las_empresas = true, y su rol se siembra con multiempresa = true, así
-- que nadie ve ni más ni menos que antes. A partir de aquí el admin asigna
-- empresas por persona y decide por rol. Ya aplicado en producción.

-- 1. Interruptor por rol -----------------------------------------------------
create table if not exists public.roles_alcance (
  rol public.app_rol primary key,
  multiempresa boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
alter table public.roles_alcance enable row level security;
drop policy if exists roles_alcance_select on public.roles_alcance;
create policy roles_alcance_select on public.roles_alcance for select using (public.auth_rol() <> 'pendiente');
drop policy if exists roles_alcance_write on public.roles_alcance;
create policy roles_alcance_write on public.roles_alcance for all
  using (public.auth_admin_global()) with check (public.auth_admin_global());
grant select on public.roles_alcance to authenticated;
grant insert, update, delete on public.roles_alcance to authenticated;

-- Siembra: dirección general y áreas del grupo manejan varias; además
-- cualquier rol que HOY tenga gente con empresa en blanco (para no
-- quitarle a nadie lo que ya veía). El resto arranca en una sola empresa.
insert into public.roles_alcance (rol, multiempresa)
select r, r in ('admin', 'corporativo', 'direccion', 'rh', 'rh_documentos', 'almacen', 'produccion')
       or exists (select 1 from public.profiles p where p.rol = r and p.empresa_id is null and p.rol <> 'pendiente')
from unnest(enum_range(null::public.app_rol)) r
on conflict (rol) do nothing;

-- 2. Alcance por persona -----------------------------------------------------
alter table public.profiles add column if not exists todas_las_empresas boolean not null default false;
update public.profiles set todas_las_empresas = true where empresa_id is null and rol <> 'pendiente' and not todas_las_empresas;

create table if not exists public.profile_empresas (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, empresa_id)
);
alter table public.profile_empresas enable row level security;
drop policy if exists frontera_organizacion on public.profile_empresas;
create policy frontera_organizacion on public.profile_empresas as restrictive for all
  using (public.perfil_en_alcance(profile_id) and public.empresa_en_mi_organizacion(empresa_id))
  with check (public.perfil_en_alcance(profile_id) and public.empresa_en_mi_organizacion(empresa_id));
drop policy if exists profile_empresas_select on public.profile_empresas;
create policy profile_empresas_select on public.profile_empresas for select
  using (profile_id = (select auth.uid()) or public.auth_rol() in ('admin', 'rh'));
drop policy if exists profile_empresas_write on public.profile_empresas;
create policy profile_empresas_write on public.profile_empresas for all
  using (public.auth_rol() = 'admin') with check (public.auth_rol() = 'admin');
grant select, insert, update, delete on public.profile_empresas to authenticated;

-- 3. Las funciones de alcance -----------------------------------------------
-- Una sola consulta sobre profiles (regla de rendimiento del 26-sep): nada
-- de funciones anidadas por fila.
create or replace function public.empresa_en_alcance(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles pr
    left join public.grupos g on g.id = pr.grupo_id
    left join public.roles_alcance ra on ra.rol = pr.rol
    join public.empresas e on e.id = p_empresa_id
    where pr.id = auth.uid()
      and pr.rol <> 'pendiente'
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

-- "Ve todas las de su organización": admin, o rol multiempresa con la marca
-- de todas. Alguien con dos empresas asignadas NO ve todas: ve las dos.
create or replace function public.auth_ve_todas_empresas()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr
    left join public.roles_alcance ra on ra.rol = pr.rol
    where pr.id = auth.uid()
      and (pr.rol = 'admin' or (coalesce(ra.multiempresa, false) and pr.todas_las_empresas))
  )
$$;

-- Para la app: la lista de empresas que la persona maneja.
create or replace function public.auth_empresas_alcance()
returns uuid[] language sql stable security definer set search_path = public as $$
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
  where pr.id = auth.uid() and pr.rol <> 'pendiente'
$$;

create or replace function public.fn_mi_alcance()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'empresas', to_jsonb(public.auth_empresas_alcance()),
    'todas', public.auth_ve_todas_empresas(),
    'multiempresa', coalesce((select ra.multiempresa from public.profiles pr left join public.roles_alcance ra on ra.rol = pr.rol where pr.id = auth.uid()), false),
    'principal', public.auth_empresa_id()
  )
$$;
grant execute on function public.auth_empresas_alcance() to authenticated;
grant execute on function public.fn_mi_alcance() to authenticated;

-- 4. Policies que comparaban contra UNA empresa ------------------------------
-- `(X.empresa_id = auth_empresa_id())` → `empresa_en_alcance(X.empresa_id)`
-- `(auth_empresa_id() IS NULL) OR …`   → se quita (lo cubre empresa_en_alcance)
-- `(X.empresa_id <> auth_empresa_id())` → `NOT empresa_en_alcance(X.empresa_id)`
-- profiles se queda como está (compara el renglón propio, no alcance).
do $$
declare
  r record;
  q text;
  wc text;
  ddl text;
  n int := 0;
begin
  for r in
    select c.relname tabla, p.polname, p.polcmd::text cmd, p.polpermissive perm,
           pg_get_expr(p.polqual, p.polrelid) q, pg_get_expr(p.polwithcheck, p.polrelid) wc,
           (select string_agg(quote_ident(rolname), ', ') from pg_roles where oid = any(p.polroles)) roles
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname <> 'profiles'
      and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'empresa_id (=|<>) auth_empresa_id\(\)|auth_empresa_id\(\) IS NULL'
        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'empresa_id (=|<>) auth_empresa_id\(\)|auth_empresa_id\(\) IS NULL')
  loop
    q := regexp_replace(regexp_replace(regexp_replace(r.q, '\(auth_empresa_id\(\) IS NULL\) OR ', '', 'g'),
           '\(([a-z_]+\.)?empresa_id <> auth_empresa_id\(\)\)', 'NOT empresa_en_alcance(\1empresa_id)', 'g'),
           '\(([a-z_]+\.)?empresa_id = auth_empresa_id\(\)\)', 'empresa_en_alcance(\1empresa_id)', 'g');
    wc := regexp_replace(regexp_replace(regexp_replace(r.wc, '\(auth_empresa_id\(\) IS NULL\) OR ', '', 'g'),
           '\(([a-z_]+\.)?empresa_id <> auth_empresa_id\(\)\)', 'NOT empresa_en_alcance(\1empresa_id)', 'g'),
           '\(([a-z_]+\.)?empresa_id = auth_empresa_id\(\)\)', 'empresa_en_alcance(\1empresa_id)', 'g');
    ddl := format('drop policy if exists %I on public.%I; create policy %I on public.%I as %s for %s to %s%s%s',
      r.polname, r.tabla, r.polname, r.tabla,
      case when r.perm then 'permissive' else 'restrictive' end,
      case r.cmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
      coalesce(r.roles, 'public'),
      case when q is not null then ' using (' || q || ')' else '' end,
      case when wc is not null then ' with check (' || wc || ')' else '' end);
    execute ddl;
    n := n + 1;
  end loop;
  raise notice 'alcance multiempresa: % policies reescritas', n;
end $$;

-- 5. Funciones que comparaban contra UNA empresa -----------------------------
do $$
declare
  r record;
  def text;
  n int := 0;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname not in ('auth_ve_todas_empresas', 'empresa_en_alcance', 'auth_empresa_id', 'auth_empresas_alcance', 'fn_mi_alcance')
      and (pg_get_functiondef(p.oid) ~ '[a-z_.]+ (=|<>) public\.auth_empresa_id\(\)'
        or pg_get_functiondef(p.oid) ~ 'public\.auth_empresa_id\(\) (= p_empresa_id|is null or )')
  loop
    def := regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(r.def,
      '\(public\.auth_ve_todas_empresas\(\) or ([a-z_.]+) = public\.auth_empresa_id\(\)\)', 'public.empresa_en_alcance(\1)', 'g'),
      'public\.auth_empresa_id\(\) is null or ', '', 'g'),
      'public\.auth_empresa_id\(\) = p_empresa_id', 'public.empresa_en_alcance(p_empresa_id)', 'g'),
      '([a-z_.]+) <> public\.auth_empresa_id\(\)', 'not public.empresa_en_alcance(\1)', 'g'),
      '([a-z_.]+) = public\.auth_empresa_id\(\)', 'public.empresa_en_alcance(\1)', 'g');
    execute def;
    n := n + 1;
  end loop;
  raise notice 'alcance multiempresa: % funciones reescritas', n;
end $$;
