-- El filtro de periodo del KPI de asistencias acepta "Hoy" (1 día); antes
-- el mínimo era 7 (Mario, 28-sep-2026). Misma función que
-- 20260926130000, solo cambia greatest(..., 1). Ya aplicado en producción.
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
  desde := hoy - (greatest(coalesce(p_dias, 30), 1) - 1);

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
