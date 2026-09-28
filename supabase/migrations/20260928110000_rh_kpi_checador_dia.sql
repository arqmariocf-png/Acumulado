-- Detalle de un día del KPI de asistencias (Eréndira, 28-sep-2026): clic
-- en la barra del día y sale quién ya checó (primera entrada, retardo,
-- última salida) y quién no, de la plantilla activa con cuenta. Misma regla
-- de retardo que fn_rh_kpi_checador. Ya aplicado en producción.
create or replace function public.fn_rh_kpi_checador_dia(p_dia date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare r jsonb;
begin
  if not public.auth_rh_directivo() then
    raise exception 'Solo RH directivo' using errcode = '42501';
  end if;
  with base as (select hora_entrada, tolerancia_min from public.perfiles_jornada where es_base limit 1),
  plantilla as (
    select p.id as personal_id, p.nombre, p.profile_id, p.area, p.puesto,
           coalesce(pj.hora_entrada, (select hora_entrada from base), '08:00'::time) as hora_entrada,
           coalesce(pj.tolerancia_min, (select tolerancia_min from base), 15) as tolerancia,
           (select e.codigo from public.contrataciones c join public.empresas e on e.id = c.empresa_id where c.personal_id = p.id order by c.created_at desc limit 1) as empresa
    from public.personal p
    left join public.perfiles_jornada pj on pj.id = p.perfil_jornada_id
    where p.activo and p.profile_id is not null
  ),
  marcas as (
    select r.profile_id,
           min(r.created_at at time zone 'America/Mexico_City') filter (where r.tipo = 'entrada') as primera_entrada,
           max(r.created_at at time zone 'America/Mexico_City') filter (where r.tipo = 'salida') as ultima_salida
    from public.checador_registros r
    where r.anulada_en is null
      and (r.created_at at time zone 'America/Mexico_City')::date = p_dia
    group by r.profile_id
  ),
  filas as (
    select pl.nombre, pl.area, pl.puesto, pl.empresa, pl.hora_entrada,
           m.primera_entrada, m.ultima_salida,
           (m.primera_entrada is not null) as checo,
           (m.primera_entrada is not null and m.primera_entrada::time > pl.hora_entrada + make_interval(mins => pl.tolerancia)) as retardo,
           case when m.primera_entrada is not null and m.primera_entrada::time > pl.hora_entrada + make_interval(mins => pl.tolerancia)
                then extract(epoch from (m.primera_entrada::time - pl.hora_entrada)) / 60 else null end as minutos_tarde
    from plantilla pl
    left join marcas m on m.profile_id = pl.profile_id
  )
  select jsonb_build_object(
    'dia', p_dia,
    'plantilla', (select count(*) from filas),
    'checaron', (select count(*) from filas where checo),
    'retardos', (select count(*) from filas where retardo),
    'sin_checar', (select count(*) from filas where not checo),
    'personas', (select coalesce(jsonb_agg(jsonb_build_object(
        'nombre', nombre, 'area', area, 'puesto', puesto, 'empresa', empresa,
        'hora_entrada', to_char(hora_entrada, 'HH24:MI'),
        'entrada', to_char(primera_entrada, 'HH24:MI'),
        'salida', to_char(ultima_salida, 'HH24:MI'),
        'checo', checo, 'retardo', retardo, 'minutos_tarde', round(minutos_tarde)
      ) order by checo desc, retardo desc, primera_entrada, nombre), '[]'::jsonb) from filas)
  ) into r;
  return r;
end;
$function$;
revoke all on function public.fn_rh_kpi_checador_dia(date) from public;
grant execute on function public.fn_rh_kpi_checador_dia(date) to authenticated, service_role;
