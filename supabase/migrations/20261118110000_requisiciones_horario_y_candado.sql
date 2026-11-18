-- Requerimientos (18-nov-2026, Mario): "hay que quitar que se pueda
-- modificar los requerimientos pasados" y "hay que agregar los horarios de
-- requerimiento". Un horario por organización (días y hora desde/hasta, en
-- hora de México) en `requisiciones_horario`:
--   · Fuera del horario, quien pide en obra (roles básicos, responsable,
--     producción) no puede mandar requisiciones (trigger
--     requisiciones_horario_guard). Admin, corporativo, dirección, empresa,
--     almacén y RH no se bloquean (EPP, compras internas).
--   · Una requisición solo la edita quien la pidió (renglones, cantidades,
--     cancelar) el MISMO día en que la mandó y mientras el horario siga
--     abierto; después queda cerrada ("pasada"). Admin y corporativo siguen
--     editando (auth_requisiciones_editables + policy requisiciones_update).
-- Default LOMA: lunes a sábado 08:00–18:00 (se ajusta en Requisiciones ›
-- "Horario para pedir"). Sin palabras prohibidas por el MCP.

create table if not exists public.requisiciones_horario (
  grupo_id uuid primary key references public.grupos (id) on delete cascade,
  activo boolean not null default true,
  dias_semana int[] not null default '{1,2,3,4,5,6}',   -- ISO: 1 lunes … 7 domingo
  hora_desde time not null default '08:00',
  hora_hasta time not null default '18:00',
  nota text,
  actualizado_por uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  check (hora_hasta > hora_desde),
  check (dias_semana <@ '{1,2,3,4,5,6,7}'::int[] and array_length(dias_semana, 1) >= 1)
);
alter table public.requisiciones_horario enable row level security;
grant select, insert, update on public.requisiciones_horario to authenticated;

create or replace function public.requisiciones_horario_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.actualizado_por := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create or replace trigger requisiciones_horario_antes before insert or update on public.requisiciones_horario
  for each row execute function public.requisiciones_horario_antes();

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'requisiciones_horario' and policyname = 'frontera_organizacion') then
    create policy frontera_organizacion on public.requisiciones_horario as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'requisiciones_horario' and policyname = 'espectador_sin_datos') then
    create policy espectador_sin_datos on public.requisiciones_horario as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'requisiciones_horario' and policyname = 'director_general') then
    create policy director_general on public.requisiciones_horario for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'requisiciones_horario' and policyname = 'requisiciones_horario_select') then
    create policy requisiciones_horario_select on public.requisiciones_horario for select to authenticated
      using ((select public.auth_rol_definer()) <> 'pendiente');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'requisiciones_horario' and policyname = 'requisiciones_horario_write') then
    create policy requisiciones_horario_write on public.requisiciones_horario for all to authenticated
      using ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion']::app_rol[]))
      with check ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion']::app_rol[])
                  and (select public.auth_suscripcion_permite_escribir_definer()));
  end if;
end $$;
create or replace trigger solo_consulta before insert or update or delete on public.requisiciones_horario
  for each statement execute function public.bloquear_solo_consulta();

-- Siembra: LOMA con el horario por defecto (lun-sáb 08:00-18:00).
insert into public.requisiciones_horario (grupo_id)
select g.id from public.grupos g where g.codigo = 'LOMA'
on conflict (grupo_id) do nothing;

-- ¿El horario de esa organización está abierto en ese instante (hora MX)?
-- Sin horario o inactivo → siempre abierto.
create or replace function public.fn_requisiciones_horario_abierto(p_grupo uuid, p_en timestamptz default now())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select (extract(isodow from (p_en at time zone 'America/Mexico_City'))::int = any (h.dias_semana))
       and (p_en at time zone 'America/Mexico_City')::time >= h.hora_desde
       and (p_en at time zone 'America/Mexico_City')::time < h.hora_hasta
    from public.requisiciones_horario h where h.grupo_id = p_grupo and h.activo
  ), true)
$$;

create or replace function public.fn_requisiciones_horario_texto(p_grupo uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when h.grupo_id is null or not h.activo then null
    else format('%s de %s a %s',
      (select string_agg(x, ', ' order by d) from unnest(h.dias_semana) with ordinality as u(d, o)
         cross join lateral (select (array['lun','mar','mié','jue','vie','sáb','dom'])[d] as x) y),
      to_char(h.hora_desde, 'HH24:MI'), to_char(h.hora_hasta, 'HH24:MI')) end
  from public.requisiciones_horario h where h.grupo_id = p_grupo
$$;

-- Roles que piden en obra y se sujetan al horario.
create or replace function public.fn_requisiciones_horario_aplica(p_rol text)
returns boolean language sql immutable as $$
  select p_rol in ('operativo', 'administrativo', 'supervisor', 'directivo', 'responsable', 'produccion')
$$;

-- Candado al crear fuera de horario.
create or replace function public.requisiciones_horario_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rol text := (select rol::text from public.profiles where id = auth.uid());
  v_grupo uuid := (select e.grupo_id from public.empresas e where e.id = new.empresa_id);
begin
  if auth.uid() is null or not public.fn_requisiciones_horario_aplica(v_rol) then return new; end if;
  if not public.fn_requisiciones_horario_abierto(v_grupo, now()) then
    raise exception 'Las requisiciones se reciben %. Fuera de ese horario no se pueden mandar.',
      coalesce(public.fn_requisiciones_horario_texto(v_grupo), 'en el horario de la organización');
  end if;
  return new;
end $$;
create or replace trigger requisiciones_horario_guard before insert on public.requisiciones
  for each row execute function public.requisiciones_horario_guard();

-- ¿Quien la pidió todavía puede editarla? Mismo día (hora MX), enviada, sin
-- avanzar de etapa y con el horario abierto. Admin/corporativo siempre.
create or replace function public.fn_requisicion_editable_por_solicitante(p_requisicion_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.requisiciones r
    join public.empresas e on e.id = r.empresa_id
    where r.id = p_requisicion_id
      and r.solicitado_por = auth.uid()
      and r.estado = 'enviada'
      and r.etapa = 'solicitada'
      and (r.created_at at time zone 'America/Mexico_City')::date = (now() at time zone 'America/Mexico_City')::date
      and public.fn_requisiciones_horario_abierto(e.grupo_id, now()))
$$;

create or replace function public.auth_requisiciones_editables()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(r.id), '{}'::uuid[])
  from public.requisiciones r
  join public.empresas e on e.id = r.empresa_id
  where r.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])
    and ((select public.auth_rol_definer()) = any (array['admin', 'corporativo']::app_rol[])
         or (r.solicitado_por = (select auth.uid()) and r.estado = 'enviada' and r.etapa = 'solicitada'
             and (r.created_at at time zone 'America/Mexico_City')::date = (now() at time zone 'America/Mexico_City')::date
             and public.fn_requisiciones_horario_abierto(e.grupo_id, now())))
$$;

-- La requisición misma (comentario, cancelar) sigue la misma regla.
alter policy requisiciones_update on public.requisiciones
  using (id = any ((select public.auth_requisiciones_editables())::uuid[]))
  with check (id = any ((select public.auth_requisiciones_editables())::uuid[])
              or (select public.auth_rol_definer()) = any (array['admin', 'corporativo']::app_rol[]));
