-- KPIs del nivel RH directivo (Mario, 26-sep-2026): pestañas 6, 7 y 8 del
-- módulo de RH. Tres funciones que devuelven jsonb ya agregado para que el
-- navegador solo pinte; todas exigen auth_rh_directivo() (RH directivo o
-- admin) porque cuentan gente de toda la organización.
-- Ya aplicado en producción (26-sep-2026, migración "rh_kpis_directivo").

-- 6. Checador: asistencias y retardos de los últimos N días. Retardo = la
-- primera entrada del día es posterior a hora_entrada + tolerancia del perfil
-- de jornada de la persona (o del perfil base, o 08:00 / 15 min).
create or replace function public.fn_rh_kpi_checador(p_dias integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  hoy date := (now() at time zone 'America/Mexico_City')::date;
  desde date;
  r jsonb;
begin
  if not public.auth_rh_directivo() then
    raise exception 'Solo RH directivo' using errcode = '42501';
  end if;
  desde := hoy - (greatest(coalesce(p_dias, 30), 7) - 1);

  with base as (select hora_entrada, tolerancia_min from public.perfiles_jornada where es_base limit 1),
  plantilla as (
    select p.id as personal_id, p.nombre, p.profile_id,
           coalesce(pj.hora_entrada, (select hora_entrada from base), '08:00'::time) as hora_entrada,
           coalesce(pj.tolerancia_min, (select tolerancia_min from base), 15) as tolerancia
    from public.personal p
    left join public.perfiles_jornada pj on pj.id = p.perfil_jornada_id
    where p.activo and p.profile_id is not null
  ),
  entradas as (
    select r.profile_id,
           (r.created_at at time zone 'America/Mexico_City')::date as d,
           min(r.created_at at time zone 'America/Mexico_City') as primera
    from public.checador_registros r
    where r.tipo = 'entrada' and r.anulada_en is null
      and r.created_at >= (desde::timestamp at time zone 'America/Mexico_City')
    group by r.profile_id, (r.created_at at time zone 'America/Mexico_City')::date
  ),
  marcas as (
    select e.d, e.profile_id, pl.nombre, e.primera,
           (e.primera::time > pl.hora_entrada + make_interval(mins => pl.tolerancia)) as retardo
    from entradas e
    join plantilla pl on pl.profile_id = e.profile_id
  ),
  dias as (select generate_series(desde, hoy, interval '1 day')::date as d)
  select jsonb_build_object(
    'desde', desde, 'hasta', hoy,
    'plantilla', (select count(*) from plantilla),
    'resumen', (select jsonb_build_object(
        'asistencias', count(*),
        'retardos', count(*) filter (where retardo),
        'pct_puntualidad', case when count(*) = 0 then null else round(100.0 * count(*) filter (where not retardo) / count(*)) end
      ) from marcas),
    'por_dia', (select jsonb_agg(jsonb_build_object(
        'd', dd.d,
        'a_tiempo', (select count(*) from marcas m where m.d = dd.d and not m.retardo),
        'retardos', (select count(*) from marcas m where m.d = dd.d and m.retardo)
      ) order by dd.d) from dias dd),
    'por_persona', (select coalesce(jsonb_agg(jsonb_build_object(
        'nombre', pl.nombre,
        'asistencias', (select count(*) from marcas m where m.profile_id = pl.profile_id),
        'retardos', (select count(*) from marcas m where m.profile_id = pl.profile_id and m.retardo)
      ) order by (select count(*) from marcas m where m.profile_id = pl.profile_id and m.retardo) desc, pl.nombre), '[]'::jsonb) from plantilla pl)
  ) into r;
  return r;
end;
$function$;

-- 7. Vacantes y rotación: 12 meses de v_rotacion_mensual más el estado de las
-- vacantes (abiertas por área con días abiertas, cubiertas con días de
-- cobertura).
create or replace function public.fn_rh_kpi_vacantes()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  hoy date := (now() at time zone 'America/Mexico_City')::date;
  r jsonb;
begin
  if not public.auth_rh_directivo() then
    raise exception 'Solo RH directivo' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'rotacion', (select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'altas', altas, 'bajas', bajas, 'plantilla_inicio', plantilla_inicio, 'plantilla_fin', plantilla_fin, 'rotacion_pct', rotacion_pct) order by mes), '[]'::jsonb)
                  from (select * from public.v_rotacion_mensual order by mes desc limit 12) x),
    'vacantes_por_estatus', (select coalesce(jsonb_agg(jsonb_build_object('estatus', estatus, 'n', n) order by estatus), '[]'::jsonb) from (select estatus, count(*) n from public.vacantes group by estatus) v),
    'abiertas_por_area', (select coalesce(jsonb_agg(jsonb_build_object('area', coalesce(area, 'Sin área'), 'n', n, 'dias_promedio', dias) order by n desc), '[]'::jsonb)
                          from (select area, count(*) n, round(avg(hoy - fecha_apertura)) dias from public.vacantes where estatus = 'abierta' group by area) a),
    'abiertas', (select jsonb_build_object('n', count(*), 'dias_promedio', round(avg(hoy - fecha_apertura))) from public.vacantes where estatus = 'abierta'),
    'cubiertas', (select jsonb_build_object('n', count(*), 'dias_promedio_cobertura', round(avg(fecha_cierre - fecha_apertura))) from public.vacantes where estatus = 'cubierta' and fecha_cierre is not null),
    'plantilla_activa', (select count(*) from public.personal where activo)
  ) into r;
  return r;
end;
$function$;

-- 8. Cumplimiento de actividades: tarjetas del tablero "RH · Actividades".
-- Hecha = está en la última columna o archivada; a tiempo = hecha y movida
-- antes de la fecha límite; vencida = no hecha y con límite pasado.
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
    return jsonb_build_object('resumen', jsonb_build_object('total', 0, 'hechas', 0, 'a_tiempo', 0, 'vencidas', 0, 'pendientes', 0), 'por_semana', '[]'::jsonb, 'por_persona', '[]'::jsonb);
  end if;
  select id into v_hecho from public.tablero_columnas where tablero_id = v_tablero order by orden desc limit 1;

  with t as (
    select tj.id, tj.titulo, tj.asignado_a, tj.fecha_limite,
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
        'pct_cumplimiento', case when count(*) = 0 then null else round(100.0 * count(*) filter (where hecha) / count(*)) end,
        'pct_a_tiempo', case when count(*) filter (where hecha) = 0 then null else round(100.0 * count(*) filter (where a_tiempo) / count(*) filter (where hecha)) end
      ) from t),
    'por_semana', (select coalesce(jsonb_agg(jsonb_build_object('semana', semana, 'total', n, 'hechas', h, 'a_tiempo', a, 'vencidas', v) order by semana), '[]'::jsonb)
                   from (select semana, count(*) n, count(*) filter (where hecha) h, count(*) filter (where a_tiempo) a, count(*) filter (where vencida) v
                         from t where semana >= date_trunc('week', hoy)::date - interval '7 weeks' group by semana) s),
    'por_persona', (select coalesce(jsonb_agg(jsonb_build_object('nombre', coalesce(p.nombre, 'Sin asignar'), 'total', n, 'hechas', h, 'a_tiempo', a, 'vencidas', v) order by v desc, n desc), '[]'::jsonb)
                    from (select asignado_a, count(*) n, count(*) filter (where hecha) h, count(*) filter (where a_tiempo) a, count(*) filter (where vencida) v from t group by asignado_a) x
                    left join public.profiles p on p.id = x.asignado_a)
  ) into r;
  return r;
end;
$function$;

revoke all on function public.fn_rh_kpi_checador(integer) from public;
revoke all on function public.fn_rh_kpi_vacantes() from public;
revoke all on function public.fn_rh_kpi_actividades() from public;
grant execute on function public.fn_rh_kpi_checador(integer) to authenticated, service_role;
grant execute on function public.fn_rh_kpi_vacantes() to authenticated, service_role;
grant execute on function public.fn_rh_kpi_actividades() to authenticated, service_role;
