-- Evaluación de desempeño del personal (23-oct-2026, Mario: "hazme un formato
-- de evaluación de desempeño del personal dentro de la aplicación con las
-- tareas cumplidas"). Por persona y periodo: lo automático sale del sistema
-- (tareas asignadas, hechas, a tiempo, vencidas, cambios de fecha, días con
-- entrada en el checador) y lo demás lo califica quien evalúa (criterios 1-5,
-- fortalezas, áreas de mejora, acuerdos). Se guarda como foto del momento en
-- `evaluaciones_desempeno.datos` para que el formato impreso no cambie después.
--
-- Evalúan RH, dirección, admin y el jefe directo (personal.supervisor_profile_id);
-- la persona evaluada ve las suyas una vez firmadas. Frontera por organización,
-- espectador, director general y solo consulta.
--
-- Ya aplicado en producción (evaluacion_desempeno).

create table if not exists public.evaluaciones_desempeno (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  profile_id uuid not null references public.profiles (id),
  personal_id uuid references public.personal (id),
  nombre text not null,
  puesto text,
  periodo_desde date not null,
  periodo_hasta date not null,
  datos jsonb not null default '{}'::jsonb,
  criterios jsonb not null default '{}'::jsonb,
  fortalezas text,
  mejoras text,
  acuerdos text,
  calificacion numeric(5, 2),
  nivel text,
  estatus text not null default 'borrador' check (estatus in ('borrador', 'firmada')),
  firmada_en timestamptz,
  evaluador_id uuid default auth.uid() references auth.users (id),
  evaluador_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (periodo_hasta >= periodo_desde)
);
create index if not exists evaluaciones_desempeno_persona_idx on public.evaluaciones_desempeno (grupo_id, profile_id, periodo_hasta desc);
create index if not exists evaluaciones_desempeno_personal_idx on public.evaluaciones_desempeno (personal_id);
create index if not exists evaluaciones_desempeno_evaluador_idx on public.evaluaciones_desempeno (evaluador_id);

-- Quién evalúa a quién: RH, dirección, admin a toda su organización; el jefe
-- directo a su gente.
create or replace function public.auth_evalua_a(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles yo join public.profiles otro on otro.grupo_id = yo.grupo_id
     where yo.id = auth.uid() and yo.activo and not yo.espectador and otro.id = p_profile
       and (yo.rol in ('admin', 'rh', 'direccion')
            or exists (select 1 from public.personal pe where pe.profile_id = p_profile and pe.supervisor_profile_id = yo.id)))
$$;
revoke all on function public.auth_evalua_a(uuid) from public, anon;
grant execute on function public.auth_evalua_a(uuid) to authenticated;

create or replace function public.evaluaciones_desempeno_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.grupo_id is null then new.grupo_id := public.auth_grupo_id(); end if;
    new.evaluador_id := auth.uid();
    select nombre into new.evaluador_nombre from public.profiles where id = auth.uid();
  elsif old.estatus = 'firmada' then
    raise exception 'Una evaluación firmada ya no se edita.';
  end if;
  if new.estatus = 'firmada' and new.firmada_en is null then new.firmada_en := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger evaluaciones_desempeno_antes before insert or update on public.evaluaciones_desempeno
  for each row execute function public.evaluaciones_desempeno_antes();

alter table public.evaluaciones_desempeno enable row level security;
create policy frontera_organizacion on public.evaluaciones_desempeno as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
create policy espectador_sin_datos on public.evaluaciones_desempeno as restrictive for select using (not (select public.auth_es_espectador()));
create policy director_general on public.evaluaciones_desempeno for all
  using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
create policy evaluaciones_desempeno_select on public.evaluaciones_desempeno for select
  using (public.auth_evalua_a(profile_id) or (profile_id = (select auth.uid()) and estatus = 'firmada'));
create policy evaluaciones_desempeno_insert on public.evaluaciones_desempeno for insert
  with check (public.auth_evalua_a(profile_id));
create policy evaluaciones_desempeno_update on public.evaluaciones_desempeno for update
  using (public.auth_evalua_a(profile_id)) with check (public.auth_evalua_a(profile_id));
create trigger solo_consulta before insert or update on public.evaluaciones_desempeno
  for each statement execute function public.bloquear_solo_consulta();
grant select, insert, update on public.evaluaciones_desempeno to authenticated;

-- Personas que puede evaluar quien pregunta (personal activo con cuenta).
create or replace function public.fn_evaluacion_personas()
returns table (personal_id uuid, profile_id uuid, nombre text, puesto text, empresa text, area text, jefe text, fecha_ingreso date)
language sql stable security definer set search_path = public as $$
  select pe.id, pe.profile_id, pe.nombre, pe.puesto, e.codigo, pe.area, j.nombre, pe.fecha_ingreso
    from public.personal pe
    join public.profiles yo on yo.id = auth.uid()
    left join public.profiles pr on pr.id = pe.profile_id
    left join public.empresas e on e.id = pr.empresa_id
    left join public.profiles j on j.id = pe.supervisor_profile_id
   where pe.activo and pe.profile_id is not null and pe.grupo_id = yo.grupo_id
     and yo.activo and not yo.espectador
     and (yo.rol in ('admin', 'rh', 'direccion') or pe.supervisor_profile_id = yo.id)
   order by (pe.supervisor_profile_id = yo.id) desc, pe.nombre
$$;
revoke all on function public.fn_evaluacion_personas() from public, anon;
grant execute on function public.fn_evaluacion_personas() to authenticated;

-- Lo que el sistema sabe de la persona en el periodo: tareas (responsable o
-- corresponsable) con fecha límite en el periodo —o sin fecha y creadas en
-- él—, hecha = última columna del tablero o archivada, a tiempo = movida a
-- Hecho (updated_at) en o antes de la fecha límite; días con entrada en el
-- checador y retardos no se califican aquí (eso lo ve RH en Asistencia).
create or replace function public.fn_evaluacion_datos(p_profile uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_grupo uuid;
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  r jsonb;
begin
  if not public.auth_evalua_a(p_profile) then
    raise exception 'Solo RH, dirección, el administrador o el jefe directo evalúan a esta persona' using errcode = '42501';
  end if;
  if p_hasta < p_desde then raise exception 'El periodo está al revés'; end if;
  select grupo_id into v_grupo from public.profiles where id = p_profile;

  with tb as (
    select tb.id, tb.nombre, tb.proyecto_id,
           (select c.id from public.tablero_columnas c where c.tablero_id = tb.id order by c.orden desc limit 1) as hecho
      from public.tableros tb
      join public.empresas e on e.id = tb.empresa_id
     where e.grupo_id = v_grupo
    union all
    select tb.id, tb.nombre, tb.proyecto_id,
           (select c.id from public.tablero_columnas c where c.tablero_id = tb.id order by c.orden desc limit 1)
      from public.tableros tb
      join public.profiles pc on pc.id = tb.creado_por and pc.grupo_id = v_grupo
     where tb.empresa_id is null
  ), t as (
    select tj.id, tj.titulo, tb.nombre as tablero, tj.tablero_id, tj.fecha_limite, tj.fecha_cambios,
           (tj.asignado_a = p_profile) as responsable,
           (tj.columna_id = tb.hecho or tj.archivada) as hecha,
           (tj.updated_at at time zone 'America/Mexico_City')::date as hecha_en,
           ((tj.columna_id = tb.hecho or tj.archivada) and (tj.fecha_limite is null or (tj.updated_at at time zone 'America/Mexico_City')::date <= tj.fecha_limite)) as a_tiempo,
           (not (tj.columna_id = tb.hecho or tj.archivada) and tj.fecha_limite is not null and tj.fecha_limite < v_hoy) as vencida
      from public.tarjetas tj
      join tb on tb.id = tj.tablero_id
     where tj.eliminada_en is null
       and (tj.asignado_a = p_profile or p_profile = any (coalesce(tj.corresponsables, '{}'::uuid[])))
       and ((tj.fecha_limite between p_desde and p_hasta)
            or (tj.fecha_limite is null and (tj.created_at at time zone 'America/Mexico_City')::date between p_desde and p_hasta))
  ), marcas as (
    select (m.created_at at time zone 'America/Mexico_City')::date as dia
      from public.v_checador_marcas m
     where m.profile_id = p_profile and m.tipo = 'entrada' and not coalesce(m.anulada, false)
       and (m.created_at at time zone 'America/Mexico_City')::date between p_desde and p_hasta
     group by 1
  ), persona as (
    select pe.nombre, pe.puesto, pe.area, pe.fecha_ingreso, j.nombre as jefe, e.codigo as empresa
      from public.profiles pr
      left join public.personal pe on pe.profile_id = pr.id and pe.activo
      left join public.profiles j on j.id = pe.supervisor_profile_id
      left join public.empresas e on e.id = pr.empresa_id
     where pr.id = p_profile
     order by pe.created_at desc nulls last limit 1
  )
  select jsonb_build_object(
    'persona', (select jsonb_build_object('nombre', coalesce(pe.nombre, pr.nombre), 'puesto', pe.puesto, 'area', pe.area, 'fecha_ingreso', pe.fecha_ingreso, 'jefe', pe.jefe, 'empresa', pe.empresa)
                  from public.profiles pr left join persona pe on true where pr.id = p_profile),
    'resumen', (select jsonb_build_object(
        'total', count(*),
        'hechas', count(*) filter (where hecha),
        'a_tiempo', count(*) filter (where a_tiempo),
        'tarde', count(*) filter (where hecha and not a_tiempo),
        'vencidas', count(*) filter (where vencida),
        'pendientes', count(*) filter (where not hecha and not vencida),
        'cambios_fecha', coalesce(sum(fecha_cambios), 0),
        'como_responsable', count(*) filter (where responsable),
        'dias_con_entrada', (select count(*) from marcas),
        'dias_habiles', (select count(*) from generate_series(p_desde, p_hasta, interval '1 day') d where extract(isodow from d) < 6)
      ) from t),
    'tareas', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'titulo', t.titulo, 'tablero', t.tablero, 'tablero_id', t.tablero_id, 'fecha_limite', t.fecha_limite,
        'hecha', t.hecha, 'hecha_en', case when t.hecha then t.hecha_en end, 'a_tiempo', t.a_tiempo, 'vencida', t.vencida,
        'responsable', t.responsable, 'cambios_fecha', t.fecha_cambios
      ) order by t.fecha_limite nulls last, t.titulo), '[]'::jsonb) from t)
  ) into r;
  return r;
end;
$$;
revoke all on function public.fn_evaluacion_datos(uuid, date, date) from public, anon;
grant execute on function public.fn_evaluacion_datos(uuid, date, date) to authenticated;
