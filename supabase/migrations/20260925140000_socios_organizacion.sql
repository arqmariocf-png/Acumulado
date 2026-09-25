-- Socios por organización (25-sep-2026). Mario: "como socio sería Aldo en
-- ARSSA y Laura en ARSSA, y así se irán viendo los demás". Un socio ve la
-- vista de socio (/socio) solo con las organizaciones donde está dado de
-- alta; el admin de la organización maestra las ve todas. `inicio` = la
-- vista de socio es su primera pantalla al entrar (Laura conserva su inicio
-- de trabajo y entra a la vista de socio desde el menú). Ya aplicado en
-- producción.

create table if not exists public.socios_organizacion (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  grupo_id uuid not null references public.grupos (id) on delete cascade,
  inicio boolean not null default true,
  participacion numeric(5, 2),
  notas text,
  otorgado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (profile_id, grupo_id)
);

alter table public.socios_organizacion enable row level security;

drop policy if exists socios_select_propio on public.socios_organizacion;
create policy socios_select_propio on public.socios_organizacion
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.auth_rol() = 'admin');

drop policy if exists socios_admin_write on public.socios_organizacion;
create policy socios_admin_write on public.socios_organizacion
  for all to authenticated
  using (public.auth_rol() = 'admin')
  with check (public.auth_rol() = 'admin');

create or replace function public.auth_es_socio()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.socios_organizacion s where s.profile_id = auth.uid())
$$;

-- Resumen de socio: el admin ve todas las organizaciones; un socio, las suyas.
create or replace function public.fn_socio_resumen()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  es_admin boolean := coalesce(public.auth_rol() = 'admin', false);
  resultado jsonb;
begin
  if not es_admin and not public.auth_es_socio() then
    raise exception 'Solo el administrador o un socio puede ver el resumen de socio' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id,
           'codigo', g.codigo,
           'nombre', g.nombre,
           'marca_comercial', g.marca_comercial,
           'es_maestro', g.es_maestro,
           'activo', g.activo,
           'empresas', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', em.id,
                      'codigo', em.codigo,
                      'nombre', em.nombre,
                      'activo', em.activo,
                      'kpis', public.fn_kpis_empresa(em.id)
                    ) order by em.nombre)
             from public.empresas em
             where em.grupo_id = g.id
           ), '[]'::jsonb)
         ) order by g.es_maestro desc, g.nombre), '[]'::jsonb)
    into resultado
  from public.grupos g
  where g.activo
    and (es_admin or exists (select 1 from public.socios_organizacion s where s.grupo_id = g.id and s.profile_id = auth.uid()));

  return jsonb_build_object('grupos', resultado, 'calculado_en', now(), 'es_admin', es_admin);
end;
$$;

-- Administración de socios (solo admin). Se hace por RPC porque `grupos`
-- tiene RLS sin policies para el navegador.
create or replace function public.fn_socios_listar()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.auth_rol() = 'admin', false) is not true then
    raise exception 'Solo el administrador administra socios' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'grupos', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'codigo', g.codigo, 'nombre', g.nombre, 'marca_comercial', g.marca_comercial, 'es_maestro', g.es_maestro) order by g.es_maestro desc, g.nombre), '[]'::jsonb) from public.grupos g where g.activo),
    'socios', (select coalesce(jsonb_agg(jsonb_build_object('profile_id', s.profile_id, 'nombre', p.nombre, 'rol', p.rol, 'grupo_id', s.grupo_id, 'grupo_nombre', coalesce(g.marca_comercial, g.nombre), 'grupo_codigo', g.codigo, 'inicio', s.inicio, 'created_at', s.created_at) order by g.nombre, p.nombre), '[]'::jsonb)
               from public.socios_organizacion s join public.profiles p on p.id = s.profile_id join public.grupos g on g.id = s.grupo_id)
  );
end;
$$;

create or replace function public.fn_socio_asignar(p_profile uuid, p_grupo uuid, p_inicio boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.auth_rol() = 'admin', false) is not true then
    raise exception 'Solo el administrador administra socios' using errcode = '42501';
  end if;
  insert into public.socios_organizacion (profile_id, grupo_id, inicio, otorgado_por)
  values (p_profile, p_grupo, coalesce(p_inicio, true), auth.uid())
  on conflict (profile_id, grupo_id) do update set inicio = excluded.inicio, otorgado_por = excluded.otorgado_por;
end;
$$;

create or replace function public.fn_socio_quitar(p_profile uuid, p_grupo uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.auth_rol() = 'admin', false) is not true then
    raise exception 'Solo el administrador administra socios' using errcode = '42501';
  end if;
  delete from public.socios_organizacion where profile_id = p_profile and grupo_id = p_grupo;
end;
$$;

revoke all on function public.auth_es_socio() from public, anon;
revoke all on function public.fn_socios_listar() from public, anon;
revoke all on function public.fn_socio_asignar(uuid, uuid, boolean) from public, anon;
revoke all on function public.fn_socio_quitar(uuid, uuid) from public, anon;
grant execute on function public.auth_es_socio() to authenticated;
grant execute on function public.fn_socios_listar() to authenticated;
grant execute on function public.fn_socio_asignar(uuid, uuid, boolean) to authenticated;
grant execute on function public.fn_socio_quitar(uuid, uuid) to authenticated;

-- Laura Ortaza socia de ARSSA (conserva su inicio de finanzas). Aldo se da
-- de alta cuando tenga cuenta.
insert into public.socios_organizacion (profile_id, grupo_id, inicio, otorgado_por)
select p.id, g.id, false, (select id from public.profiles where rol = 'admin' order by created_at limit 1)
from public.profiles p, public.grupos g
where p.nombre ilike 'Laura Ortaza%' and g.codigo = 'ARSSA'
on conflict (profile_id, grupo_id) do nothing;
