-- Cumplimiento de RH con TODAS las tareas (Mario, 6-oct-2026: "en las
-- pantallas de cumplimiento de RH deben aparecer y vincularse todas las
-- tareas, no solamente las que asignen"). Antes solo contaba el tablero
-- "RH · Actividades"; ahora todos los tableros activos de la organización
-- (los de empresa por su empresa; los corporativos sin empresa, por la
-- organización de quien los creó). "Hecha" = en la última columna de SU
-- tablero, o archivada (no eliminada). Las eliminadas no cuentan. Cada
-- abierta trae el tablero para ligarla.
--
-- Ya aplicado en producción.

create or replace function public.fn_rh_kpi_actividades()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_grupo uuid;
  r jsonb;
begin
  if not public.auth_rh_directivo() then
    raise exception 'Solo RH directivo' using errcode = '42501';
  end if;
  select grupo_id into v_grupo from public.profiles where id = auth.uid();

  with tb as (
    select tb.id, tb.nombre,
           (select c.id from public.tablero_columnas c where c.tablero_id = tb.id order by c.orden desc limit 1) as hecho
    from public.tableros tb
    where not tb.archivado
      and (tb.empresa_id = any (public.auth_empresas_organizacion())
           or (tb.empresa_id is null and exists (select 1 from public.profiles pc where pc.id = tb.creado_por and pc.grupo_id = v_grupo)))
  ), t as (
    select tj.id, tj.tablero_id, tb.nombre as tablero, tj.titulo, tj.asignado_a, tj.supervisor_id, tj.fecha_limite, tj.columna_id, tj.fecha_cambios,
           (tj.columna_id = tb.hecho or tj.archivada) as hecha,
           ((tj.columna_id = tb.hecho or tj.archivada) and (tj.fecha_limite is null or (tj.updated_at at time zone 'America/Mexico_City')::date <= tj.fecha_limite)) as a_tiempo,
           (not (tj.columna_id = tb.hecho or tj.archivada) and tj.fecha_limite is not null and tj.fecha_limite < hoy) as vencida,
           date_trunc('week', coalesce(tj.fecha_limite, (tj.created_at at time zone 'America/Mexico_City')::date))::date as semana
    from public.tarjetas tj
    join tb on tb.id = tj.tablero_id
    where tj.eliminada_en is null
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
        'tableros', count(distinct tablero_id),
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
        'id', t.id, 'tablero_id', t.tablero_id, 'tablero', t.tablero, 'titulo', t.titulo, 'fecha_limite', t.fecha_limite, 'cambios_fecha', t.fecha_cambios,
        'responsable', p.nombre, 'supervisor', s.nombre, 'columna', c.nombre,
        'estado', case when t.vencida then 'vencida' when t.fecha_limite is null then 'sin_fecha' else 'pendiente' end
      ) order by t.vencida desc, t.fecha_limite nulls last, t.titulo), '[]'::jsonb)
      from (select * from t where not hecha limit 300) t
      left join public.profiles p on p.id = t.asignado_a
      left join public.profiles s on s.id = t.supervisor_id
      left join public.tablero_columnas c on c.id = t.columna_id)
  ) into r;
  return r;
end;
$function$;
