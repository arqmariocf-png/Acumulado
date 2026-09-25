-- Reconcilia dos cosas que se construyeron el mismo día en ramas distintas:
-- los socios por organización (20260925140000_socios_organizacion) y la
-- frontera entre organizaciones. Las dos tocan fn_socio_resumen(), que es la
-- pantalla donde se ven las empresas de cada organización con su saldo
-- consolidado, sus pagos vencidos y su plantilla.
--
-- Lo que hay que cerrar:
--
-- 1. "admin" ya no quiere decir "dueño de la plataforma". El admin de una
--    organización CLIENTE también cumple `auth_rol() = 'admin'`, así que
--    tal como estaba se llevaba las cifras de Grupo Loma. El resumen se
--    reparte: el admin de la maestra ve todas; el admin de un cliente, la
--    suya; un socio, aquellas donde lo dieron de alta.
--
-- 2. Ser socio es un permiso que CRUZA organizaciones a propósito (Laura es
--    de Loma y es socia de ARSSA). Por eso solo lo puede otorgar la
--    organización maestra: con la policy anterior, el admin de un cliente se
--    insertaba a sí mismo como socio de Loma y el resumen le abría todo. Eso
--    no es un hueco de la vista, es una escalada de privilegio.
--
-- 3. fn_kpis_empresa() es SECURITY DEFINER y recibe la empresa que le pidan:
--    por sí sola le da a cualquier autenticado los números de la empresa que
--    quiera. Se revoca y queda para uso interno.

-- ── La tabla de socios, dentro de la frontera ───────────────────────────
-- El renglón es de la organización de la PERSONA (como permisos_modulo), no
-- de la organización que se le concede: si fuera al revés, Laura -- que es de
-- Loma -- no vería su propio renglón de socia de ARSSA. Que el permiso cruce
-- organizaciones lo resuelve fn_socio_resumen(), que es SECURITY DEFINER y
-- lee la tabla sin pasar por RLS.
create policy frontera_organizacion on public.socios_organizacion as restrictive for all
  using (exists (select 1 from public.profiles pr where pr.id = socios_organizacion.profile_id and public.grupo_en_alcance(pr.grupo_id)))
  with check (exists (select 1 from public.profiles pr where pr.id = socios_organizacion.profile_id and public.grupo_en_alcance(pr.grupo_id)));

-- Otorgar "socio" es un acto de plataforma, no de cliente.
drop policy if exists socios_admin_write on public.socios_organizacion;
create policy socios_admin_write on public.socios_organizacion
  for all to authenticated
  using (public.auth_admin_global())
  with check (public.auth_admin_global());

-- ── El resumen ──────────────────────────────────────────────────────────
create or replace function public.fn_socio_resumen()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  es_admin_maestro boolean := public.auth_admin_global();
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
    and (
      es_admin_maestro
      or (es_admin and g.id = public.auth_grupo_id())
      or exists (select 1 from public.socios_organizacion s where s.grupo_id = g.id and s.profile_id = (select auth.uid()))
    );

  return jsonb_build_object('grupos', resultado, 'calculado_en', now(), 'es_admin', es_admin);
end;
$$;

-- ── Administración de socios: solo la organización maestra ──────────────
create or replace function public.fn_socios_listar()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.auth_admin_global() then
    raise exception 'Solo el administrador de la organización maestra administra socios' using errcode = '42501';
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
  if not public.auth_admin_global() then
    raise exception 'Solo el administrador de la organización maestra administra socios' using errcode = '42501';
  end if;
  insert into public.socios_organizacion (profile_id, grupo_id, inicio, otorgado_por)
  values (p_profile, p_grupo, coalesce(p_inicio, true), (select auth.uid()))
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
  if not public.auth_admin_global() then
    raise exception 'Solo el administrador de la organización maestra administra socios' using errcode = '42501';
  end if;
  delete from public.socios_organizacion where profile_id = p_profile and grupo_id = p_grupo;
end;
$$;

-- ── Los KPIs por empresa, acotados ──────────────────────────────────────
create or replace function public.fn_kpis_empresa_publica(e uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.empresa_en_mi_organizacion(e) then public.fn_kpis_empresa(e)
    else '{}'::jsonb
  end
$$;

revoke all on function public.fn_kpis_empresa(uuid) from public, anon, authenticated;
grant execute on function public.fn_kpis_empresa(uuid) to service_role;
revoke all on function public.fn_kpis_empresa_publica(uuid) from public, anon;
grant execute on function public.fn_kpis_empresa_publica(uuid) to authenticated;
