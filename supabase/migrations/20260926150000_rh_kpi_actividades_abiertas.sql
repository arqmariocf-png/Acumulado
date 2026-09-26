-- KPI 8 (cumplimiento de actividades): además de los agregados, la lista de
-- actividades abiertas (pendientes, vencidas, sin fecha) con lo necesario
-- para abrir la tarjeta desde la gráfica (/tareas/<tablero>?tarjeta=<id>).
-- Mario, 26-sep-2026: "marca un pendiente, ¿cuál sería? dame el vínculo".
-- Ya aplicado en producción (26-sep-2026).

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
    return jsonb_build_object('resumen', jsonb_build_object('total', 0, 'hechas', 0, 'a_tiempo', 0, 'vencidas', 0, 'pendientes', 0), 'por_semana', '[]'::jsonb, 'por_persona', '[]'::jsonb, 'abiertas', '[]'::jsonb);
  end if;
  select id into v_hecho from public.tablero_columnas where tablero_id = v_tablero order by orden desc limit 1;

  with t as (
    select tj.id, tj.tablero_id, tj.titulo, tj.asignado_a, tj.supervisor_id, tj.fecha_limite, tj.columna_id,
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
                    left join public.profiles p on p.id = x.asignado_a),
    -- Las que siguen abiertas, con lo necesario para abrir la tarjeta
    -- (/tareas/<tablero>?tarjeta=<id>): vencidas primero, luego por fecha.
    'abiertas', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'tablero_id', t.tablero_id, 'titulo', t.titulo, 'fecha_limite', t.fecha_limite,
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
