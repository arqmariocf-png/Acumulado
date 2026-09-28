-- Fecha compromiso con autorización (Mario, 28-sep-2026): una vez fijada la
-- fecha límite de una tarjeta, moverla requiere autorización del jefe
-- inmediato y cada cambio se cuenta (tarjetas.fecha_cambios) para los KPI.
-- Jefe inmediato = supervisor a cargo de la tarjeta, jefe (RH) de la
-- persona asignada, responsable del proyecto del tablero, rol empresa de
-- esa empresa, o admin/corporativo/dirección. El jefe cambia directo (queda
-- registrado y contado); los demás solicitan con motivo y el jefe resuelve.
-- Ya aplicado en producción (28-sep-2026).
alter table public.tarjetas add column if not exists fecha_cambios integer not null default 0;

create table if not exists public.tarjeta_cambios_fecha (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references public.tarjetas (id) on delete cascade,
  fecha_anterior date,
  fecha_nueva date,
  motivo text,
  solicitado_por uuid not null references public.profiles (id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  resuelto_por uuid references public.profiles (id),
  resuelto_en timestamptz,
  comentario text,
  created_at timestamptz not null default now()
);
create index if not exists tarjeta_cambios_fecha_tarjeta_idx on public.tarjeta_cambios_fecha (tarjeta_id, created_at desc);
create index if not exists tarjeta_cambios_fecha_pendientes_idx on public.tarjeta_cambios_fecha (estado) where estado = 'pendiente';
alter table public.tarjeta_cambios_fecha enable row level security;

drop policy if exists frontera_organizacion on public.tarjeta_cambios_fecha;
create policy frontera_organizacion on public.tarjeta_cambios_fecha as restrictive for all
  using (exists (select 1 from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = tarjeta_cambios_fecha.tarjeta_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))))
  with check (exists (select 1 from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = tarjeta_cambios_fecha.tarjeta_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))));
drop policy if exists tarjeta_cambios_fecha_select on public.tarjeta_cambios_fecha;
create policy tarjeta_cambios_fecha_select on public.tarjeta_cambios_fecha
  for select using (exists (select 1 from public.tarjetas ta where ta.id = tarjeta_cambios_fecha.tarjeta_id));
-- Escritura solo por las RPC (definer) y el trigger.

create or replace function public.auth_es_jefe_de_tarjeta(p_tarjeta_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.tarjetas ta
    join public.tableros t on t.id = ta.tablero_id
    left join public.proyectos p on p.id = t.proyecto_id
    where ta.id = p_tarjeta_id
      and (
        public.auth_rol() in ('admin', 'corporativo', 'direccion')
        or ta.supervisor_id = auth.uid()
        or p.responsable_id = auth.uid()
        or (public.auth_rol() = 'empresa' and t.empresa_id = public.auth_empresa_id())
        or exists (select 1 from public.personal pe where pe.profile_id = ta.asignado_a and pe.supervisor_profile_id = auth.uid())
      )
  )
$$;

create or replace function public.tarjetas_fecha_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if new.fecha_limite is not distinct from old.fecha_limite then return new; end if;
  if old.fecha_limite is null then return new; end if;              -- primera fecha: libre y no cuenta
  if v_uid is null then return new; end if;                          -- service role (funciones internas)
  if current_setting('acumulado.fecha_autorizada', true) = '1' then  -- viene de fn_tarjeta_fecha_resolver
    new.fecha_cambios := old.fecha_cambios + 1;
    return new;
  end if;
  if public.auth_es_jefe_de_tarjeta(old.id) then
    insert into public.tarjeta_cambios_fecha (tarjeta_id, fecha_anterior, fecha_nueva, motivo, solicitado_por, estado, resuelto_por, resuelto_en)
    values (old.id, old.fecha_limite, new.fecha_limite, 'Cambio directo del jefe', v_uid, 'aprobado', v_uid, now());
    new.fecha_cambios := old.fecha_cambios + 1;
    return new;
  end if;
  raise exception 'La fecha compromiso ya está fijada (%). Cambiarla requiere autorización de tu jefe inmediato: solicítalo desde la tarjeta con el motivo.', old.fecha_limite
    using errcode = 'P0001';
end;
$$;
drop trigger if exists tarjetas_fecha_guard on public.tarjetas;
create trigger tarjetas_fecha_guard before update of fecha_limite on public.tarjetas
  for each row execute function public.tarjetas_fecha_guard();

create or replace function public.fn_tarjeta_fecha_solicitar(p_tarjeta_id uuid, p_fecha date, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_actual date; v_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo del cambio de fecha'; end if;
  if not exists (select 1 from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = p_tarjeta_id and public.tablero_visible(t.empresa_id)) then
    raise exception 'Tarjeta no encontrada o sin acceso' using errcode = '42501';
  end if;
  select fecha_limite into v_actual from public.tarjetas where id = p_tarjeta_id;
  if v_actual is not distinct from p_fecha then raise exception 'La fecha propuesta es la misma que la actual'; end if;
  if exists (select 1 from public.tarjeta_cambios_fecha c where c.tarjeta_id = p_tarjeta_id and c.estado = 'pendiente') then
    raise exception 'Ya hay una solicitud de cambio de fecha pendiente para esta tarjeta';
  end if;
  insert into public.tarjeta_cambios_fecha (tarjeta_id, fecha_anterior, fecha_nueva, motivo, solicitado_por)
  values (p_tarjeta_id, v_actual, p_fecha, trim(p_motivo), v_uid) returning id into v_id;
  insert into public.tarjeta_actividad (tarjeta_id, tipo, detalle, actor_id)
  values (p_tarjeta_id, 'editada', jsonb_build_object('accion', 'fecha_solicitud', 'de', v_actual, 'a', p_fecha, 'motivo', trim(p_motivo)), v_uid);
  return v_id;
end;
$$;

create or replace function public.fn_tarjeta_fecha_resolver(p_solicitud_id uuid, p_aprobar boolean, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); s public.tarjeta_cambios_fecha%rowtype;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into s from public.tarjeta_cambios_fecha where id = p_solicitud_id;
  if s.id is null then raise exception 'Solicitud no encontrada'; end if;
  if s.estado <> 'pendiente' then raise exception 'La solicitud ya fue %', s.estado; end if;
  if not public.auth_es_jefe_de_tarjeta(s.tarjeta_id) then
    raise exception 'Solo el jefe inmediato (supervisor de la tarjeta, jefe de la persona, responsable del proyecto o dirección) puede autorizar el cambio de fecha' using errcode = '42501';
  end if;
  if s.solicitado_por = v_uid and public.auth_rol() not in ('admin', 'corporativo', 'direccion') then
    raise exception 'No puedes autorizar tu propia solicitud' using errcode = '42501';
  end if;
  update public.tarjeta_cambios_fecha
  set estado = case when p_aprobar then 'aprobado' else 'rechazado' end, resuelto_por = v_uid, resuelto_en = now(), comentario = nullif(trim(coalesce(p_comentario, '')), '')
  where id = p_solicitud_id;
  if p_aprobar then
    perform set_config('acumulado.fecha_autorizada', '1', true);
    update public.tarjetas set fecha_limite = s.fecha_nueva where id = s.tarjeta_id;
    perform set_config('acumulado.fecha_autorizada', '0', true);
  end if;
  insert into public.tarjeta_actividad (tarjeta_id, tipo, detalle, actor_id)
  values (s.tarjeta_id, 'editada', jsonb_build_object('accion', case when p_aprobar then 'fecha_autorizada' else 'fecha_rechazada' end, 'de', s.fecha_anterior, 'a', s.fecha_nueva, 'comentario', nullif(trim(coalesce(p_comentario, '')), '')), v_uid);
end;
$$;

revoke all on function public.fn_tarjeta_fecha_solicitar(uuid, date, text) from public;
revoke all on function public.fn_tarjeta_fecha_resolver(uuid, boolean, text) from public;
grant execute on function public.fn_tarjeta_fecha_solicitar(uuid, date, text) to authenticated, service_role;
grant execute on function public.fn_tarjeta_fecha_resolver(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.auth_es_jefe_de_tarjeta(uuid) to authenticated, service_role;

-- KPI de RH: cuántas veces se movieron fechas (resumen.cambios_fecha,
-- resumen.con_fecha_movida, por_persona[].cambios_fecha, abiertas[].cambios_fecha).
create or replace function public.fn_rh_kpi_actividades()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_tablero uuid;
  v_hecho uuid;
  r jsonb;
begin
  if not public.auth_rh_directivo() then
    raise exception 'Solo RH directivo' using errcode = '42501';
  end if;
  select id into v_tablero from public.tableros where nombre = 'RH · Actividades' limit 1;
  if v_tablero is null then
    return jsonb_build_object('resumen', jsonb_build_object('total', 0, 'hechas', 0, 'a_tiempo', 0, 'vencidas', 0, 'pendientes', 0, 'cambios_fecha', 0), 'por_semana', '[]'::jsonb, 'por_persona', '[]'::jsonb, 'abiertas', '[]'::jsonb);
  end if;
  select id into v_hecho from public.tablero_columnas where tablero_id = v_tablero order by orden desc limit 1;

  with t as (
    select tj.id, tj.tablero_id, tj.titulo, tj.asignado_a, tj.supervisor_id, tj.fecha_limite, tj.columna_id, tj.fecha_cambios,
           (tj.columna_id = v_hecho or tj.archivada) as hecha,
           ((tj.columna_id = v_hecho or tj.archivada) and (tj.fecha_limite is null or (tj.updated_at at time zone 'America/Mexico_City')::date <= tj.fecha_limite)) as a_tiempo,
           (not (tj.columna_id = v_hecho or tj.archivada) and tj.fecha_limite is not null and tj.fecha_limite < hoy) as vencida,
           date_trunc('week', coalesce(tj.fecha_limite, (tj.created_at at time zone 'America/Mexico_City')::date))::date as semana
    from public.tarjetas tj
    where tj.tablero_id = v_tablero
  )
  select jsonb_build_object(
    'resumen', (select jsonb_build_object(
        'total', count(*),
        'hechas', count(*) filter (where hecha),
        'a_tiempo', count(*) filter (where a_tiempo),
        'vencidas', count(*) filter (where vencida),
        'pendientes', count(*) filter (where not hecha and not vencida),
        'cambios_fecha', coalesce(sum(fecha_cambios), 0),
        'con_fecha_movida', count(*) filter (where fecha_cambios > 0),
        'pct_cumplimiento', case when count(*) = 0 then null else round(100.0 * count(*) filter (where hecha) / count(*)) end,
        'pct_a_tiempo', case when count(*) filter (where hecha) = 0 then null else round(100.0 * count(*) filter (where a_tiempo) / count(*) filter (where hecha)) end
      ) from t),
    'por_semana', (select coalesce(jsonb_agg(jsonb_build_object('semana', semana, 'total', n, 'hechas', h, 'a_tiempo', a, 'vencidas', v) order by semana), '[]'::jsonb)
                   from (select semana, count(*) n, count(*) filter (where hecha) h, count(*) filter (where a_tiempo) a, count(*) filter (where vencida) v
                         from t where semana >= date_trunc('week', hoy)::date - interval '7 weeks' group by semana) s),
    'por_persona', (select coalesce(jsonb_agg(jsonb_build_object('nombre', coalesce(p.nombre, 'Sin asignar'), 'total', n, 'hechas', h, 'a_tiempo', a, 'vencidas', v, 'cambios_fecha', cf) order by v desc, n desc), '[]'::jsonb)
                    from (select asignado_a, count(*) n, count(*) filter (where hecha) h, count(*) filter (where a_tiempo) a, count(*) filter (where vencida) v, coalesce(sum(fecha_cambios), 0) cf from t group by asignado_a) x
                    left join public.profiles p on p.id = x.asignado_a),
    'abiertas', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'tablero_id', t.tablero_id, 'titulo', t.titulo, 'fecha_limite', t.fecha_limite, 'cambios_fecha', t.fecha_cambios,
        'responsable', p.nombre, 'supervisor', s.nombre, 'columna', c.nombre,
        'estado', case when t.vencida then 'vencida' when t.fecha_limite is null then 'sin_fecha' else 'pendiente' end
      ) order by t.vencida desc, t.fecha_limite nulls last, t.titulo), '[]'::jsonb)
      from (select * from t where not hecha limit 200) t
      left join public.profiles p on p.id = t.asignado_a
      left join public.profiles s on s.id = t.supervisor_id
      left join public.tablero_columnas c on c.id = t.columna_id)
  ) into r;
  return r;
end;
$function$;
