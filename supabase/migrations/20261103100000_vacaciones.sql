-- Vacaciones y permisos (3-nov-2026, Mario: "habilitar un módulo de
-- vacaciones, con recordatorio de quién se va y cuándo regresa").
--
--   * `vacaciones`: una fila por ausencia (vacaciones, permiso con/sin goce,
--     incapacidad) de una persona de RH (`personal`), con desde/hasta, los
--     días hábiles que cuenta (lun-vie o lun-sáb según su jornada, sin los
--     festivos del art. 74 LFT), quién la cubre, estado solicitada →
--     autorizada | rechazada | cancelada.
--   * Saldo por ley (art. 76 LFT, reforma 2023): 12 días el primer año, +2
--     por año hasta 20 en el quinto y +2 por cada 5 años después; el periodo
--     corre de aniversario a aniversario sobre `personal.fecha_ingreso`.
--     `fn_vacaciones_saldo(personal)` = días de ley − autorizados − pendientes
--     del periodo en curso.
--   * Pide la persona (su propio expediente), su jefe directo o RH/dirección/
--     admin (`fn_vacaciones_solicitar`); autorizan o rechazan RH, dirección y
--     admin (`fn_vacaciones_resolver`); lo que RH captura queda autorizado
--     de una vez. Nadie escribe la tabla directo.
--   * Recordatorios: pg_cron `vacaciones-recordatorios` a las 14:00 UTC
--     (8:00 MX) → `fn_vacaciones_recordatorios()`: el día anterior a la
--     salida avisa a la persona ("mañana empiezan tus vacaciones, regresas
--     el…") y a su jefe, a RH y a quien cubre ("X sale mañana, regresa
--     el…"); el día anterior al regreso avisa a los mismos. Una vez por
--     ausencia y aviso (`vacaciones_avisos`). También avisa a RH y al jefe
--     al solicitar, y a la persona al autorizar o rechazar.
--   * Las ausencias autorizadas ya no cuentan como falta en Tiempos y
--     checador (`fn_reporte_rh_tiempos`: días hábiles − días de ausencia).
-- Ya aplicado en producción.

-- Festivos de descanso obligatorio (art. 74 LFT) de un año.
create or replace function public.fn_festivos_lft(p_anio int)
returns date[] language sql immutable as $$
  select array[
    make_date(p_anio, 1, 1),
    (make_date(p_anio, 2, 1) + ((8 - extract(isodow from make_date(p_anio, 2, 1))::int) % 7))::date,
    (make_date(p_anio, 3, 1) + ((8 - extract(isodow from make_date(p_anio, 3, 1))::int) % 7) + 14)::date,
    make_date(p_anio, 5, 1),
    make_date(p_anio, 9, 16),
    (make_date(p_anio, 11, 1) + ((8 - extract(isodow from make_date(p_anio, 11, 1))::int) % 7) + 14)::date,
    make_date(p_anio, 12, 25)
  ] || case when (p_anio - 2024) % 6 = 0 then array[make_date(p_anio, 10, 1)] else '{}'::date[] end
$$;

-- Días hábiles entre dos fechas (inclusive) para una jornada de 5 o 6 días.
create or replace function public.fn_dias_habiles_lft(p_desde date, p_hasta date, p_dias_semana int default 6)
returns int language sql immutable as $$
  select count(*)::int
    from generate_series(p_desde, p_hasta, interval '1 day') g
   where extract(isodow from g) <= (case when coalesce(p_dias_semana, 6) <= 5 then 5 else 6 end)
     and not (g::date = any (public.fn_festivos_lft(extract(year from g)::int)))
$$;

-- Siguiente día hábil después de una fecha (día en que regresa).
create or replace function public.fn_siguiente_habil_lft(p_fecha date, p_dias_semana int default 6)
returns date language sql immutable as $$
  select min(g::date)
    from generate_series(p_fecha + 1, p_fecha + 15, interval '1 day') g
   where extract(isodow from g) <= (case when coalesce(p_dias_semana, 6) <= 5 then 5 else 6 end)
     and not (g::date = any (public.fn_festivos_lft(extract(year from g)::int)))
$$;

-- Días de vacaciones por año de servicio (art. 76 LFT): 1º 12, 2º 14 … 5º 20,
-- luego +2 por cada 5 años.
create or replace function public.fn_vacaciones_dias_ley(p_anio_servicio int)
returns int language sql immutable as $$
  select case
    when p_anio_servicio <= 1 then 12
    when p_anio_servicio <= 5 then 12 + 2 * (p_anio_servicio - 1)
    else 20 + 2 * (floor((p_anio_servicio - 6) / 5.0)::int + 1)
  end
$$;

create or replace function public.fn_vacaciones_etiqueta(p_tipo text)
returns text language sql immutable as $$
  select case p_tipo when 'vacaciones' then 'Vacaciones' when 'permiso_con_goce' then 'Permiso con goce'
                     when 'permiso_sin_goce' then 'Permiso sin goce' when 'incapacidad' then 'Incapacidad' else p_tipo end
$$;

create or replace function public.auth_opera_vacaciones()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.activo and not coalesce(p.espectador, false)
       and p.rol in ('rh', 'admin', 'direccion'))
$$;
grant execute on function public.auth_opera_vacaciones() to authenticated;

create table if not exists public.vacaciones (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  personal_id uuid not null references public.personal (id),
  profile_id uuid references public.profiles (id),
  personal_nombre text not null,
  empresa_id uuid references public.empresas (id),
  tipo text not null default 'vacaciones' check (tipo in ('vacaciones', 'permiso_con_goce', 'permiso_sin_goce', 'incapacidad')),
  desde date not null,
  hasta date not null check (hasta >= desde),
  dias int not null check (dias >= 0),
  regresa_el date not null,
  cubre_profile_id uuid references public.profiles (id),
  cubre_nombre text,
  notas text,
  estado text not null default 'solicitada' check (estado in ('solicitada', 'autorizada', 'rechazada', 'cancelada')),
  solicitado_por uuid references public.profiles (id),
  solicitante_nombre text,
  resuelta_por uuid references public.profiles (id),
  resuelta_en timestamptz,
  rechazo_motivo text,
  cancelada_en timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists vacaciones_personal_idx on public.vacaciones (personal_id, desde);
create index if not exists vacaciones_profile_idx on public.vacaciones (profile_id);
create index if not exists vacaciones_grupo_fechas_idx on public.vacaciones (grupo_id, desde, hasta) where estado in ('solicitada', 'autorizada');
create index if not exists vacaciones_cubre_idx on public.vacaciones (cubre_profile_id);
create index if not exists vacaciones_solicitado_idx on public.vacaciones (solicitado_por);
create index if not exists vacaciones_resuelta_idx on public.vacaciones (resuelta_por);
create index if not exists vacaciones_empresa_idx on public.vacaciones (empresa_id);

-- Avisos ya mandados (uno por ausencia y tipo).
create table if not exists public.vacaciones_avisos (
  vacacion_id uuid not null references public.vacaciones (id) on delete cascade,
  grupo_id uuid not null references public.grupos (id),
  tipo text not null check (tipo in ('salida', 'regreso')),
  enviado_en timestamptz not null default now(),
  primary key (vacacion_id, tipo)
);

alter table public.vacaciones enable row level security;
alter table public.vacaciones_avisos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['vacaciones', 'vacaciones_avisos'] loop
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))$p$, t);
    execute format($p$create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()))$p$, t);
    execute format($p$create policy director_general on public.%I for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()))$p$, t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I
      for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Ve: la persona (las suyas), quien la cubre, quien la pidió, su jefe directo
-- o quien ve su checador (supervisor, responsable de checador), y RH/
-- dirección/admin todas las de su organización. Se escribe solo por funciones.
create policy vacaciones_select on public.vacaciones for select to authenticated
  using (profile_id = (select auth.uid())
         or cubre_profile_id = (select auth.uid())
         or solicitado_por = (select auth.uid())
         or (select public.auth_opera_vacaciones())
         or (profile_id is not null and public.auth_ve_checador_de(profile_id)));

-- RH de una organización (con cuenta activa).
create or replace function public.fn_rh_de(p_grupo uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}'::uuid[]) from public.profiles p
   where p.grupo_id = p_grupo and p.rol = 'rh' and p.activo and not coalesce(p.espectador, false)
$$;
revoke all on function public.fn_rh_de(uuid) from public, anon, authenticated;

-- Saldo de vacaciones de ley de una persona en su periodo de servicio en curso.
create or replace function public.fn_vacaciones_saldo(p_personal uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v public.personal%rowtype;
  v_anios int; v_periodo_desde date; v_periodo_hasta date; v_ley int; v_tomados int; v_pendientes int;
  v_dias_semana int;
begin
  select * into v from public.personal where id = p_personal;
  if v.id is null then return null; end if;
  if not (v.profile_id = auth.uid() or public.auth_opera_vacaciones()
          or (v.profile_id is not null and public.auth_ve_checador_de(v.profile_id))
          or v.supervisor_profile_id = auth.uid()) then
    return null;
  end if;
  v_anios := greatest(extract(year from age(current_date, v.fecha_ingreso))::int, 0);
  v_periodo_desde := v.fecha_ingreso + make_interval(years => v_anios);
  v_periodo_hasta := v_periodo_desde + interval '1 year' - interval '1 day';
  v_ley := public.fn_vacaciones_dias_ley(v_anios + 1);
  select coalesce(sum(dias), 0) into v_tomados from public.vacaciones
   where personal_id = v.id and tipo = 'vacaciones' and estado = 'autorizada' and desde between v_periodo_desde and v_periodo_hasta;
  select coalesce(sum(dias), 0) into v_pendientes from public.vacaciones
   where personal_id = v.id and tipo = 'vacaciones' and estado = 'solicitada' and desde between v_periodo_desde and v_periodo_hasta;
  select coalesce(pj.dias_semana, 6) into v_dias_semana from public.perfiles_jornada pj where pj.id = v.perfil_jornada_id;
  return jsonb_build_object(
    'personal_id', v.id, 'nombre', v.nombre, 'fecha_ingreso', v.fecha_ingreso,
    'anios_cumplidos', v_anios, 'anio_servicio', v_anios + 1,
    'periodo_desde', v_periodo_desde, 'periodo_hasta', v_periodo_hasta,
    'dias_ley', v_ley, 'tomados', v_tomados, 'pendientes', v_pendientes,
    'disponibles', v_ley - v_tomados - v_pendientes,
    'dias_semana', coalesce(v_dias_semana, 6));
end;
$$;
grant execute on function public.fn_vacaciones_saldo(uuid) to authenticated;

-- Personas con su saldo: RH/dirección/admin toda la organización; un jefe
-- solo su gente; cualquiera, su propio expediente.
create or replace function public.fn_vacaciones_personas()
returns table (personal_id uuid, nombre text, puesto text, empresa text, profile_id uuid, supervisor_profile_id uuid, fecha_ingreso date, a_mi_cargo boolean, saldo jsonb)
language sql stable security definer set search_path = public as $$
  select pe.id, pe.nombre, pe.puesto, e.codigo, pe.profile_id, pe.supervisor_profile_id, pe.fecha_ingreso,
         coalesce(pe.supervisor_profile_id = auth.uid(), false),
         public.fn_vacaciones_saldo(pe.id)
    from public.personal pe
    left join public.profiles pr on pr.id = pe.profile_id
    left join public.empresas e on e.id = pr.empresa_id
   where pe.activo and pe.fecha_baja is null
     and pe.grupo_id = (select p.grupo_id from public.profiles p where p.id = auth.uid())
     and (public.auth_opera_vacaciones() or pe.profile_id = auth.uid() or pe.supervisor_profile_id = auth.uid()
          or (pe.profile_id is not null and public.auth_ve_checador_de(pe.profile_id)))
   order by coalesce(pe.supervisor_profile_id = auth.uid(), false) desc, pe.nombre
$$;
revoke all on function public.fn_vacaciones_personas() from public, anon;
grant execute on function public.fn_vacaciones_personas() to authenticated;

create or replace function public.fn_vacaciones_solicitar(p_personal uuid, p_tipo text, p_desde date, p_hasta date, p_notas text default null, p_cubre uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_yo public.profiles%rowtype;
  v public.personal%rowtype;
  v_opera boolean;
  v_dias_semana int;
  v_dias int;
  v_saldo jsonb;
  v_id uuid;
  v_estado text;
  v_cubre_nombre text;
  v_avisar uuid[];
  v_regresa date;
begin
  select * into v_yo from public.profiles where id = auth.uid();
  if v_yo.id is null or v_yo.rol = 'pendiente' or coalesce(v_yo.espectador, false) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v from public.personal where id = p_personal;
  if v.id is null or v.grupo_id is distinct from v_yo.grupo_id or not v.activo or v.fecha_baja is not null then
    raise exception 'Elige a una persona activa de tu organización.';
  end if;
  v_opera := public.auth_opera_vacaciones();
  if not (v_opera or v.profile_id = v_yo.id or v.supervisor_profile_id = v_yo.id) then
    raise exception 'Solo la persona, su jefe directo o RH piden vacaciones.' using errcode = '42501';
  end if;
  if p_tipo not in ('vacaciones', 'permiso_con_goce', 'permiso_sin_goce', 'incapacidad') then
    raise exception 'Tipo no válido';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'Revisa las fechas: el regreso no puede ser antes de la salida.'; end if;
  if p_hasta - p_desde > 120 then raise exception 'Máximo 120 días por registro.'; end if;
  if p_desde < current_date - 60 and not v_opera then raise exception 'Solo RH registra ausencias de hace más de 60 días.'; end if;
  if exists (select 1 from public.vacaciones x where x.personal_id = v.id and x.estado in ('solicitada', 'autorizada')
               and x.desde <= p_hasta and x.hasta >= p_desde) then
    raise exception 'Ya hay una ausencia registrada que se encima con esas fechas.';
  end if;
  select coalesce(pj.dias_semana, 6) into v_dias_semana from public.perfiles_jornada pj where pj.id = v.perfil_jornada_id;
  v_dias_semana := coalesce(v_dias_semana, 6);
  v_dias := public.fn_dias_habiles_lft(p_desde, p_hasta, v_dias_semana);
  if v_dias = 0 then raise exception 'Esas fechas no tienen días hábiles.'; end if;
  if p_tipo = 'vacaciones' then
    v_saldo := public.fn_vacaciones_saldo(v.id);
    if (v_saldo->>'disponibles')::int < v_dias and not v_opera then
      raise exception 'Pides % días y tienes % disponibles en tu periodo (% de ley, % ya tomados o pendientes). Habla con RH.',
        v_dias, (v_saldo->>'disponibles')::int, v_saldo->>'dias_ley', (v_saldo->>'tomados')::int + (v_saldo->>'pendientes')::int;
    end if;
  end if;
  if p_cubre is not null then
    select p.nombre into v_cubre_nombre from public.profiles p where p.id = p_cubre and p.grupo_id = v_yo.grupo_id and p.activo;
    if v_cubre_nombre is null then raise exception 'Quien cubre debe tener cuenta activa en tu organización.'; end if;
  end if;
  v_regresa := public.fn_siguiente_habil_lft(p_hasta, v_dias_semana);
  v_estado := case when v_opera then 'autorizada' else 'solicitada' end;
  insert into public.vacaciones (grupo_id, personal_id, profile_id, personal_nombre, empresa_id, tipo, desde, hasta, dias, regresa_el,
                                 cubre_profile_id, cubre_nombre, notas, estado, solicitado_por, solicitante_nombre, resuelta_por, resuelta_en)
  values (v.grupo_id, v.id, v.profile_id, v.nombre, (select pr.empresa_id from public.profiles pr where pr.id = v.profile_id),
          p_tipo, p_desde, p_hasta, v_dias, v_regresa, p_cubre, v_cubre_nombre, nullif(btrim(coalesce(p_notas, '')), ''),
          v_estado, v_yo.id, v_yo.nombre,
          case when v_opera then v_yo.id end, case when v_opera then now() end)
  returning id into v_id;

  if v_estado = 'solicitada' then
    v_avisar := public.fn_rh_de(v.grupo_id);
    if v.supervisor_profile_id is not null then v_avisar := v_avisar || v.supervisor_profile_id; end if;
    v_avisar := array(select distinct u from unnest(v_avisar) u where u <> v_yo.id);
    perform public.fn_push_aviso(v_avisar, 'Solicitud de ' || public.fn_vacaciones_etiqueta(p_tipo) || ' por autorizar',
      v.nombre || ' · del ' || to_char(p_desde, 'DD/MM') || ' al ' || to_char(p_hasta, 'DD/MM') || ' · ' || v_dias || ' días · regresa el ' || to_char(v_regresa, 'DD/MM'),
      '/vacaciones?tab=equipo');
  else
    v_avisar := '{}';
    if v.profile_id is not null and v.profile_id <> v_yo.id then v_avisar := v_avisar || v.profile_id; end if;
    if v.supervisor_profile_id is not null and v.supervisor_profile_id <> v_yo.id then v_avisar := v_avisar || v.supervisor_profile_id; end if;
    if p_cubre is not null and p_cubre <> v_yo.id then v_avisar := v_avisar || p_cubre; end if;
    if array_length(v_avisar, 1) > 0 then
      perform public.fn_push_aviso(v_avisar, public.fn_vacaciones_etiqueta(p_tipo) || ' registradas: ' || v.nombre,
        'Del ' || to_char(p_desde, 'DD/MM') || ' al ' || to_char(p_hasta, 'DD/MM') || ' · regresa el ' || to_char(v_regresa, 'DD/MM')
        || case when v_cubre_nombre is not null then ' · cubre ' || v_cubre_nombre else '' end,
        '/vacaciones');
    end if;
  end if;
  return jsonb_build_object('id', v_id, 'estado', v_estado, 'dias', v_dias, 'regresa_el', v_regresa);
end;
$$;
grant execute on function public.fn_vacaciones_solicitar(uuid, text, date, date, text, uuid) to authenticated;

create or replace function public.fn_vacaciones_resolver(p_id uuid, p_autorizar boolean, p_motivo text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v public.vacaciones%rowtype; v_yo public.profiles%rowtype; v_avisar uuid[]; v_sup uuid;
begin
  if not public.auth_opera_vacaciones() then raise exception 'Solo RH, dirección o admin autorizan.' using errcode = '42501'; end if;
  select * into v_yo from public.profiles where id = auth.uid();
  select * into v from public.vacaciones where id = p_id for update;
  if v.id is null or v.grupo_id is distinct from v_yo.grupo_id then raise exception 'No se encontró la solicitud.'; end if;
  if v.estado <> 'solicitada' then raise exception 'La solicitud ya está %.', v.estado; end if;
  if not p_autorizar and nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo del rechazo.'; end if;
  update public.vacaciones
     set estado = case when p_autorizar then 'autorizada' else 'rechazada' end,
         resuelta_por = v_yo.id, resuelta_en = now(),
         rechazo_motivo = case when p_autorizar then null else btrim(p_motivo) end
   where id = p_id;
  select supervisor_profile_id into v_sup from public.personal where id = v.personal_id;
  v_avisar := '{}';
  if v.profile_id is not null then v_avisar := v_avisar || v.profile_id; end if;
  if v.solicitado_por is not null then v_avisar := v_avisar || v.solicitado_por; end if;
  if p_autorizar then
    if v_sup is not null then v_avisar := v_avisar || v_sup; end if;
    if v.cubre_profile_id is not null then v_avisar := v_avisar || v.cubre_profile_id; end if;
  end if;
  v_avisar := array(select distinct u from unnest(v_avisar) u where u <> v_yo.id);
  if array_length(v_avisar, 1) > 0 then
    perform public.fn_push_aviso(v_avisar,
      public.fn_vacaciones_etiqueta(v.tipo) || case when p_autorizar then ' autorizadas: ' else ' rechazadas: ' end || v.personal_nombre,
      'Del ' || to_char(v.desde, 'DD/MM') || ' al ' || to_char(v.hasta, 'DD/MM') || ' · ' || v.dias || ' días'
        || case when p_autorizar then ' · regresa el ' || to_char(v.regresa_el, 'DD/MM') else ' · ' || btrim(p_motivo) end,
      '/vacaciones');
  end if;
end;
$$;
grant execute on function public.fn_vacaciones_resolver(uuid, boolean, text) to authenticated;

-- Cancela la persona (antes de que empiece) o RH/dirección/admin.
create or replace function public.fn_vacaciones_cancelar(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v public.vacaciones%rowtype; v_opera boolean;
begin
  v_opera := public.auth_opera_vacaciones();
  select * into v from public.vacaciones where id = p_id for update;
  if v.id is null then raise exception 'No se encontró el registro.'; end if;
  if not (v_opera or v.profile_id = auth.uid() or v.solicitado_por = auth.uid()) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if v.estado not in ('solicitada', 'autorizada') then raise exception 'Ya está %.', v.estado; end if;
  if not v_opera and v.desde <= current_date then raise exception 'Ya empezó; pide a RH que la cancele.'; end if;
  update public.vacaciones set estado = 'cancelada', cancelada_en = now() where id = p_id;
end;
$$;
grant execute on function public.fn_vacaciones_cancelar(uuid) to authenticated;

-- Recordatorios (pg_cron, 8:00 MX): el día anterior a salir y el día
-- anterior a regresar. Devuelve cuántos avisos mandó.
create or replace function public.fn_vacaciones_recordatorios()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  r record; v_avisar uuid[]; v_jefes uuid[]; n int := 0;
begin
  if auth.uid() is not null and not public.auth_opera_vacaciones() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  for r in
    select v.*, pe.supervisor_profile_id,
           case when v.desde = v_hoy + 1 then 'salida' when v.regresa_el = v_hoy + 1 then 'regreso' end as aviso
      from public.vacaciones v join public.personal pe on pe.id = v.personal_id
     where v.estado = 'autorizada' and (v.desde = v_hoy + 1 or v.regresa_el = v_hoy + 1)
  loop
    if exists (select 1 from public.vacaciones_avisos a where a.vacacion_id = r.id and a.tipo = r.aviso) then continue; end if;
    -- A la persona.
    if r.profile_id is not null then
      perform public.fn_push_aviso(array[r.profile_id],
        case when r.aviso = 'salida' then 'Mañana empiezan tus ' || lower(public.fn_vacaciones_etiqueta(r.tipo))
             else 'Mañana regresas' end,
        case when r.aviso = 'salida' then 'Del ' || to_char(r.desde, 'DD/MM') || ' al ' || to_char(r.hasta, 'DD/MM') || ' · regresas el ' || to_char(r.regresa_el, 'DD/MM')
                  || case when r.cubre_nombre is not null then ' · te cubre ' || r.cubre_nombre else '' end
             else 'Tus ' || lower(public.fn_vacaciones_etiqueta(r.tipo)) || ' terminan hoy; te esperamos el ' || to_char(r.regresa_el, 'DD/MM') || '.' end,
        '/vacaciones');
    end if;
    -- Al jefe, a RH y a quien cubre.
    v_jefes := public.fn_rh_de(r.grupo_id);
    if r.supervisor_profile_id is not null then v_jefes := v_jefes || r.supervisor_profile_id; end if;
    if r.cubre_profile_id is not null then v_jefes := v_jefes || r.cubre_profile_id; end if;
    v_avisar := array(select distinct u from unnest(v_jefes) u where u is distinct from r.profile_id);
    if array_length(v_avisar, 1) > 0 then
      perform public.fn_push_aviso(v_avisar,
        case when r.aviso = 'salida' then r.personal_nombre || ' sale mañana de ' || lower(public.fn_vacaciones_etiqueta(r.tipo))
             else r.personal_nombre || ' regresa mañana' end,
        case when r.aviso = 'salida' then 'Del ' || to_char(r.desde, 'DD/MM') || ' al ' || to_char(r.hasta, 'DD/MM') || ' · regresa el ' || to_char(r.regresa_el, 'DD/MM')
                  || case when r.cubre_nombre is not null then ' · cubre ' || r.cubre_nombre else '' end
             else 'Estuvo fuera del ' || to_char(r.desde, 'DD/MM') || ' al ' || to_char(r.hasta, 'DD/MM') || '.' end,
        '/vacaciones?tab=equipo');
    end if;
    insert into public.vacaciones_avisos (vacacion_id, grupo_id, tipo) values (r.id, r.grupo_id, r.aviso);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.fn_vacaciones_recordatorios() from public, anon;
grant execute on function public.fn_vacaciones_recordatorios() to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vacaciones-recordatorios';
    perform cron.schedule('vacaciones-recordatorios', '0 14 * * *', 'select public.fn_vacaciones_recordatorios();');
  end if;
end $$;

-- Tiempos y checador: los días de ausencia autorizada no cuentan como falta.
do $x$
declare d text; n text;
begin
  d := pg_get_functiondef('public.fn_reporte_rh_tiempos(date, date)'::regprocedure);
  n := replace(d,
    $$(select count(*) from generate_series(v_desde, v_hasta, interval '1 day') g where extract(isodow from g) <= least(greatest(p.dias_semana, 5), 6)) as habiles$$,
    $$(select count(*) from generate_series(v_desde, v_hasta, interval '1 day') g
               where extract(isodow from g) <= least(greatest(p.dias_semana, 5), 6)
                 and not exists (select 1 from public.vacaciones va where va.profile_id = p.profile_id and va.estado = 'autorizada' and g::date between va.desde and va.hasta)) as habiles$$);
  if n = d then raise exception 'fn_reporte_rh_tiempos: no se encontró el cálculo de días hábiles'; end if;
  execute n;
end $x$;
