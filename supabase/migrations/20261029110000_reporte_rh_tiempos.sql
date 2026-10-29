-- Reporte de RH de tiempos y checador (29-oct-2026, Mario: "genera el reporte
-- del área de RH a manera de información más específica en cuanto tiempos y
-- checador"). Por persona y por día: primera entrada, salida a comer, regreso,
-- última salida, horas activas (salida − entrada − comida; sin comida, el día
-- completo), retardo en minutos contra la hora de entrada + tolerancia de su
-- perfil de jornada (o 08:00 + 15); y por persona en el periodo: días hábiles
-- según su jornada (lun-vie, o lun-sáb si su perfil es de 6 días), días con
-- entrada, faltas, retardos y minutos de retardo, hora promedio de entrada y
-- salida, horas activas totales y por día, horas esperadas (horas_semana ÷
-- días por semana × días con entrada), días sin salida, comida promedio,
-- marcas manuales / offline / anuladas. Lo ven RH (cualquier nivel), dirección
-- y admin de su organización; espectador no. Ya aplicado en producción.

create or replace function public.fn_reporte_rh_tiempos(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_grupo uuid;
  v_desde date := least(p_desde, p_hasta);
  v_hasta date := greatest(p_desde, p_hasta);
  r jsonb;
begin
  select pr.grupo_id into v_grupo
    from public.profiles pr
   where pr.id = auth.uid() and pr.activo and not coalesce(pr.espectador, false)
     and pr.rol in ('rh', 'admin', 'direccion');
  if v_grupo is null then
    return null;
  end if;
  if v_hasta - v_desde > 185 then
    raise exception 'El periodo no puede pasar de 6 meses';
  end if;

  with
  base_j as (select hora_entrada, tolerancia_min, horas_semana, dias_semana from public.perfiles_jornada where es_base limit 1),
  pers as (
    select p.id, p.nombre, p.puesto, p.area, p.profile_id,
           coalesce(pj.nombre, (select 'base' from base_j), 'sin perfil') as jornada,
           coalesce(pj.hora_entrada, (select hora_entrada from base_j), '08:00'::time) as hora_entrada,
           coalesce(pj.tolerancia_min, (select tolerancia_min from base_j), 15) as tolerancia,
           coalesce(pj.horas_semana, (select horas_semana from base_j), 48) as horas_semana,
           coalesce(pj.dias_semana, (select dias_semana from base_j), 6) as dias_semana,
           e.codigo as empresa
    from public.personal p
    left join public.perfiles_jornada pj on pj.id = p.perfil_jornada_id
    left join public.profiles pr on pr.id = p.profile_id
    left join public.empresas e on e.id = coalesce(
      (select c.empresa_id from public.contrataciones c where c.personal_id = p.id order by c.fecha_inicio desc nulls last, c.created_at desc limit 1),
      pr.empresa_id)
    where p.grupo_id = v_grupo and p.activo and p.profile_id is not null
  ),
  m as (
    select c.profile_id, c.tipo,
           (c.created_at at time zone 'America/Mexico_City') as t,
           (c.created_at at time zone 'America/Mexico_City')::date as d,
           c.manual, c.sincronizada_offline, (c.anulada_en is not null) as anulada, c.ubicacion_id
    from public.checador_registros c
    where c.profile_id in (select profile_id from pers)
      and c.created_at >= (v_desde::timestamp at time zone 'America/Mexico_City')
      and c.created_at < ((v_hasta + 1)::timestamp at time zone 'America/Mexico_City')
  ),
  dia as (
    select m.profile_id, m.d,
           min(m.t) filter (where m.tipo = 'entrada' and not m.anulada) as entrada,
           max(m.t) filter (where m.tipo = 'salida' and not m.anulada) as salida,
           min(m.t) filter (where m.tipo = 'comida_inicio' and not m.anulada) as comida_inicio,
           max(m.t) filter (where m.tipo = 'comida_fin' and not m.anulada) as comida_fin,
           count(*) filter (where m.manual and not m.anulada) as manuales,
           count(*) filter (where m.sincronizada_offline and not m.anulada) as offline,
           count(*) filter (where m.anulada) as anuladas,
           mode() within group (order by m.ubicacion_id) as ubicacion_id
    from m group by m.profile_id, m.d
  ),
  dia_c as (
    select d.*, p.hora_entrada, p.tolerancia,
           case when d.entrada is not null and d.salida is not null and d.salida > d.entrada
                then round(extract(epoch from (d.salida - d.entrada)) / 60
                     - case when d.comida_inicio is not null and d.comida_fin is not null and d.comida_fin > d.comida_inicio
                            then extract(epoch from (d.comida_fin - d.comida_inicio)) / 60 else 0 end)::int
                else null end as minutos,
           case when d.comida_inicio is not null and d.comida_fin is not null and d.comida_fin > d.comida_inicio
                then round(extract(epoch from (d.comida_fin - d.comida_inicio)) / 60)::int else null end as comida_min,
           case when d.entrada is not null and d.entrada::time > p.hora_entrada + make_interval(mins => p.tolerancia)
                then round(extract(epoch from (d.entrada::time - p.hora_entrada)) / 60)::int else 0 end as retardo_min
    from dia d join pers p on p.profile_id = d.profile_id
  ),
  dias_p as (
    select p.profile_id,
           (select count(*) from generate_series(v_desde, v_hasta, interval '1 day') g where extract(isodow from g) <= least(greatest(p.dias_semana, 5), 6)) as habiles
    from pers p
  ),
  por_persona as (
    select p.id, p.nombre, p.puesto, p.area, p.empresa, p.profile_id, p.jornada, p.hora_entrada, p.tolerancia, p.horas_semana, p.dias_semana,
           dp.habiles,
           (select count(*) from dia_c x where x.profile_id = p.profile_id and x.entrada is not null) as dias_con_entrada,
           (select count(*) from dia_c x where x.profile_id = p.profile_id and x.retardo_min > 0) as retardos,
           (select coalesce(sum(x.retardo_min), 0) from dia_c x where x.profile_id = p.profile_id) as retardo_min_total,
           (select to_char(to_timestamp(avg(extract(epoch from x.entrada::time))) at time zone 'UTC', 'HH24:MI') from dia_c x where x.profile_id = p.profile_id and x.entrada is not null) as entrada_prom,
           (select to_char(to_timestamp(avg(extract(epoch from x.salida::time))) at time zone 'UTC', 'HH24:MI') from dia_c x where x.profile_id = p.profile_id and x.salida is not null) as salida_prom,
           (select coalesce(sum(x.minutos), 0) from dia_c x where x.profile_id = p.profile_id) as minutos_total,
           (select count(*) from dia_c x where x.profile_id = p.profile_id and x.minutos is not null) as dias_completos,
           (select count(*) from dia_c x where x.profile_id = p.profile_id and x.entrada is not null and x.salida is null) as dias_sin_salida,
           (select count(*) from dia_c x where x.profile_id = p.profile_id and x.comida_min is not null) as dias_con_comida,
           (select round(avg(x.comida_min)) from dia_c x where x.profile_id = p.profile_id and x.comida_min is not null) as comida_prom_min,
           (select coalesce(sum(x.manuales), 0) from dia_c x where x.profile_id = p.profile_id) as manuales,
           (select coalesce(sum(x.offline), 0) from dia_c x where x.profile_id = p.profile_id) as offline,
           (select coalesce(sum(x.anuladas), 0) from dia_c x where x.profile_id = p.profile_id) as anuladas,
           (select u.nombre from public.checador_ubicaciones u where u.id = (select mode() within group (order by x.ubicacion_id) from dia_c x where x.profile_id = p.profile_id and x.ubicacion_id is not null)) as ubicacion
    from pers p join dias_p dp on dp.profile_id = p.profile_id
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta,
    'resumen', (select jsonb_build_object(
        'personas', count(*),
        'checan', count(*) filter (where dias_con_entrada > 0),
        'dias_con_entrada', coalesce(sum(dias_con_entrada), 0),
        'faltas', coalesce(sum(greatest(habiles - dias_con_entrada, 0)) filter (where dias_con_entrada > 0), 0),
        'retardos', coalesce(sum(retardos), 0),
        'minutos_total', coalesce(sum(minutos_total), 0),
        'dias_sin_salida', coalesce(sum(dias_sin_salida), 0),
        'manuales', coalesce(sum(manuales), 0), 'offline', coalesce(sum(offline), 0), 'anuladas', coalesce(sum(anuladas), 0)
      ) from por_persona),
    'personas', (select coalesce(jsonb_agg(jsonb_build_object(
        'personal_id', id, 'profile_id', profile_id, 'nombre', nombre, 'puesto', puesto, 'area', area, 'empresa', empresa,
        'jornada', jornada, 'hora_entrada', to_char(hora_entrada, 'HH24:MI'), 'tolerancia', tolerancia, 'horas_semana', horas_semana, 'dias_semana', dias_semana,
        'habiles', habiles, 'dias_con_entrada', dias_con_entrada, 'faltas', greatest(habiles - dias_con_entrada, 0),
        'retardos', retardos, 'retardo_min_total', retardo_min_total,
        'entrada_prom', entrada_prom, 'salida_prom', salida_prom,
        'minutos_total', minutos_total, 'dias_completos', dias_completos,
        'minutos_esperados', round(horas_semana * 60.0 / greatest(dias_semana, 1) * dias_completos)::int,
        'dias_sin_salida', dias_sin_salida, 'dias_con_comida', dias_con_comida, 'comida_prom_min', comida_prom_min,
        'manuales', manuales, 'offline', offline, 'anuladas', anuladas, 'ubicacion', ubicacion
      ) order by nombre), '[]') from por_persona),
    'detalle', (select coalesce(jsonb_agg(jsonb_build_object(
        'profile_id', x.profile_id, 'fecha', x.d,
        'entrada', to_char(x.entrada, 'HH24:MI'), 'comida_inicio', to_char(x.comida_inicio, 'HH24:MI'), 'comida_fin', to_char(x.comida_fin, 'HH24:MI'), 'salida', to_char(x.salida, 'HH24:MI'),
        'minutos', x.minutos, 'comida_min', x.comida_min, 'retardo_min', x.retardo_min,
        'manuales', x.manuales, 'offline', x.offline, 'anuladas', x.anuladas
      ) order by x.profile_id, x.d), '[]') from dia_c x),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('fecha', d, 'entradas', n, 'retardos', rt, 'minutos', mn) order by d), '[]')
                from (select d, count(*) filter (where entrada is not null) n, count(*) filter (where retardo_min > 0) rt, coalesce(sum(minutos), 0) mn from dia_c group by d) x)
  ) into r;
  return r;
end;
$function$;

revoke all on function public.fn_reporte_rh_tiempos(date, date) from public, anon;
grant execute on function public.fn_reporte_rh_tiempos(date, date) to authenticated, service_role;
