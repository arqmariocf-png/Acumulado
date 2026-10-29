-- Reporte de recursos humanos para el director general (29-oct-2026, Mario:
-- "genera el reporte para director general de recursos humanos"). Una sola
-- RPC que junta, para la organización del admin maestro, lo que RH tiene
-- repartido en pantallas: plantilla (expedientes, cuentas, altas, bajas,
-- rotación, expedientes incompletos), asistencia del checador (días con
-- entrada, retardos, quién no checa), cumplimiento de tareas de todos los
-- tableros, evaluaciones de desempeño, nómina del backoffice (última semana y
-- quincena por empresa, mano de obra), EPP, herramienta a cargo, cuentas de
-- nómina y accesos al sistema. Devuelve null a cualquiera que no sea el admin
-- de la organización maestra (como fn_proyeccion_planta_datos).
-- Ya aplicado en producción.

create or replace function public.fn_reporte_rh_director(p_dias integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  hoy date := (now() at time zone 'America/Mexico_City')::date;
  desde date;
  v_grupo uuid;
  r jsonb;
begin
  if not public.auth_admin_global() then
    return null;
  end if;
  select grupo_id into v_grupo from public.profiles where id = auth.uid();
  desde := hoy - (greatest(coalesce(p_dias, 30), 7) - 1);

  with
  base_j as (select hora_entrada, tolerancia_min from public.perfiles_jornada where es_base limit 1),
  -- Empresa de cada persona: la de su contratación más reciente, si no la de su cuenta.
  pers as (
    select p.id, p.nombre, p.puesto, p.area, p.fecha_ingreso, p.fecha_baja, p.activo, p.profile_id, p.supervisor_profile_id,
           coalesce(
             (select c.empresa_id from public.contrataciones c where c.personal_id = p.id order by c.fecha_inicio desc nulls last, c.created_at desc limit 1),
             pr.empresa_id) as empresa_id,
           pr.activo as cuenta_activa, pr.rol::text as rol,
           coalesce(pj.hora_entrada, (select hora_entrada from base_j), '08:00'::time) as hora_entrada,
           coalesce(pj.tolerancia_min, (select tolerancia_min from base_j), 15) as tolerancia
    from public.personal p
    left join public.profiles pr on pr.id = p.profile_id
    left join public.perfiles_jornada pj on pj.id = p.perfil_jornada_id
    where p.grupo_id = v_grupo
  ),
  activos as (select * from pers where activo),
  emp as (select e.id, e.codigo, e.nombre, public.normalizar_texto_sql(e.nombre) as k from public.empresas e where e.grupo_id = v_grupo and e.activo),
  faltantes as (
    select a.id, a.nombre,
           (select string_agg(split_part(t.nombre, ' (', 1), ', ' order by t.orden)
              from public.tipos_documento_personal t
             where t.activo and t.aplica_a = 'todos' and (t.grupo_id = v_grupo or t.grupo_id is null)
               and not exists (select 1 from public.documentos_personal d where d.personal_id = a.id and d.tipo_documento_id = t.id)) as faltan
    from activos a
  ),
  -- Checador: primera entrada por persona y día del periodo.
  entradas as (
    select c.profile_id, (c.created_at at time zone 'America/Mexico_City')::date as d,
           min(c.created_at at time zone 'America/Mexico_City') as primera
    from public.checador_registros c
    where c.tipo = 'entrada' and c.anulada_en is null
      and c.created_at >= (desde::timestamp at time zone 'America/Mexico_City')
      and c.profile_id in (select profile_id from activos where profile_id is not null)
    group by c.profile_id, (c.created_at at time zone 'America/Mexico_City')::date
  ),
  marcas as (
    select e.profile_id, e.d, (e.primera::time > a.hora_entrada + make_interval(mins => a.tolerancia)) as retardo
    from entradas e join activos a on a.profile_id = e.profile_id
  ),
  habiles as (select count(*) as n from generate_series(desde, hoy, interval '1 day') d where extract(isodow from d) < 6),
  asis_persona as (
    select a.id, a.nombre, a.puesto, a.profile_id, a.empresa_id,
           (select count(*) from marcas m where m.profile_id = a.profile_id) as dias,
           (select count(*) from marcas m where m.profile_id = a.profile_id and m.retardo) as retardos
    from activos a where a.profile_id is not null
  ),
  -- Tareas de todos los tableros activos de la organización (hecha = última columna o archivada).
  tb as (
    select tb.id, tb.nombre, tb.area,
           (select c.id from public.tablero_columnas c where c.tablero_id = tb.id order by c.orden desc limit 1) as hecho
    from public.tableros tb
    where not tb.archivado
      and (tb.empresa_id in (select id from emp)
           or (tb.empresa_id is null and exists (select 1 from public.profiles pc where pc.id = tb.creado_por and pc.grupo_id = v_grupo)))
  ),
  t as (
    select tj.id, tj.tablero_id, tb.area, tj.asignado_a, tj.fecha_limite, tj.fecha_cambios,
           (tj.columna_id = tb.hecho or tj.archivada) as hecha,
           ((tj.columna_id = tb.hecho or tj.archivada) and (tj.fecha_limite is null or (tj.updated_at at time zone 'America/Mexico_City')::date <= tj.fecha_limite)) as a_tiempo,
           (not (tj.columna_id = tb.hecho or tj.archivada) and tj.fecha_limite is not null and tj.fecha_limite < hoy) as vencida,
           (tj.updated_at at time zone 'America/Mexico_City')::date as movida
    from public.tarjetas tj join tb on tb.id = tj.tablero_id
    where tj.eliminada_en is null
  ),
  t_periodo as (
    select * from t where (fecha_limite between desde and hoy) or (fecha_limite is null and hecha and movida between desde and hoy) or vencida
  ),
  -- Nómina del backoffice: última semana y última quincena por empresa.
  nom_sem as (
    select public.normalizar_texto_sql(r.datos ->> 'empresa') as k, (r.datos ->> 'fecha_fin')::date as fin, (r.datos ->> 'num_sem') as sem,
           count(*) as personas, sum((r.datos ->> 'pago')::numeric) as total
    from public.nomina_externa_renglones r where r.origen = 'nomina_semanal' and (r.datos ->> 'fecha_fin') is not null
    group by 1, 2, 3
  ),
  nom_sem_ult as (select distinct on (k) * from nom_sem order by k, fin desc),
  nom_quin as (
    select public.normalizar_texto_sql(r.datos ->> 'empresa') as k, (r.datos ->> 'fecha_fin')::date as fin,
           count(*) as personas, sum((r.datos ->> 'pago')::numeric) as total
    from public.nomina_externa_renglones r where r.origen = 'nomina_quincenal' and (r.datos ->> 'fecha_fin') is not null
    group by 1, 2
  ),
  nom_quin_ult as (select distinct on (k) * from nom_quin order by k, fin desc),
  mo as (
    select public.normalizar_texto_sql(r.datos ->> 'Empresa') as k, (r.datos ->> 'Fecha_fin')::date as fin,
           count(distinct r.datos ->> 'Id_trabajador') as personas, sum((r.datos ->> 'Monto')::numeric) as total
    from public.nomina_externa_renglones r where r.origen = 'mano_obra' and (r.datos ->> 'Fecha_fin') is not null
    group by 1, 2
  ),
  mo_ult as (select distinct on (k) * from mo order by k, fin desc),
  sem_tend as (
    select fin, sum(total) as total, sum(personas) as personas from nom_sem group by fin order by fin desc limit 8
  ),
  -- EPP
  epp as (
    select l.*, a.personal_id, pe.nombre as persona
    from public.epp_asignacion_lineas l
    join public.epp_asignaciones a on a.id = l.asignacion_id
    left join public.personal pe on pe.id = a.personal_id
    where a.empresa_id in (select id from emp)
  ),
  -- Cuentas del sistema de la organización
  cuentas as (
    select pr.id, pr.nombre, pr.rol::text as rol, pr.activo,
           exists (select 1 from public.push_subscripciones ps where ps.profile_id = pr.id) as push
    from public.profiles pr where pr.grupo_id = v_grupo
  )
  select jsonb_build_object(
    'desde', desde, 'hasta', hoy, 'dias', p_dias, 'habiles', (select n from habiles),
    'plantilla', jsonb_build_object(
      'activos', (select count(*) from activos),
      'con_cuenta', (select count(*) from activos where profile_id is not null),
      'checan', (select count(*) from asis_persona where dias > 0),
      'antiguedad_meses', (select round(avg((hoy - fecha_ingreso) / 30.44)::numeric, 1) from activos where fecha_ingreso is not null),
      'altas', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'puesto', puesto, 'fecha', fecha_ingreso, 'empresa', (select codigo from emp e where e.id = a.empresa_id)) order by fecha_ingreso desc), '[]') from activos a where fecha_ingreso between desde and hoy),
      'bajas', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'puesto', puesto, 'fecha', fecha_baja, 'cuenta_activa', coalesce(cuenta_activa, false)) order by fecha_baja desc), '[]') from pers where not activo and fecha_baja between desde and hoy),
      'bajas_con_cuenta', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'fecha', fecha_baja) order by fecha_baja), '[]') from pers where not activo and cuenta_activa),
      'por_empresa', (select coalesce(jsonb_agg(jsonb_build_object('empresa', coalesce(e.codigo, 'Sin empresa'), 'n', x.n) order by x.n desc), '[]')
                      from (select empresa_id, count(*) n from activos group by empresa_id) x left join emp e on e.id = x.empresa_id),
      'por_area', (select coalesce(jsonb_agg(jsonb_build_object('area', coalesce(nullif(area, ''), 'Sin área'), 'n', n) order by n desc), '[]') from (select area, count(*) n from activos group by area) x),
      'por_puesto', (select coalesce(jsonb_agg(jsonb_build_object('puesto', coalesce(nullif(puesto, ''), 'Sin puesto'), 'n', n) order by n desc), '[]') from (select puesto, count(*) n from activos group by puesto) x),
      'sin_cuenta', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'puesto', puesto) order by nombre), '[]') from activos where profile_id is null),
      'expedientes_incompletos', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'faltan', faltan) order by nombre), '[]') from faltantes where faltan is not null),
      'sin_jefe', (select count(*) from activos where supervisor_profile_id is null),
      'rotacion', (select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'altas', altas, 'bajas', bajas, 'plantilla_fin', plantilla_fin, 'rotacion_pct', rotacion_pct) order by mes), '[]')
                   from (select * from public.v_rotacion_mensual order by mes desc limit 6) x)
    ),
    'asistencia', jsonb_build_object(
      'personas', (select count(*) from asis_persona),
      'dias_con_entrada', (select coalesce(sum(dias), 0) from asis_persona),
      'retardos', (select coalesce(sum(retardos), 0) from asis_persona),
      'pct_asistencia', (select case when count(*) filter (where dias > 0) = 0 or (select n from habiles) = 0 then null
                                else round(100.0 * sum(dias) / (count(*) filter (where dias > 0) * (select n from habiles))) end from asis_persona),
      'pct_puntualidad', (select case when sum(dias) = 0 then null else round(100.0 * (sum(dias) - sum(retardos)) / sum(dias)) end from asis_persona),
      'no_checan', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'puesto', puesto) order by nombre), '[]') from asis_persona where dias = 0),
      'mas_faltas', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'puesto', puesto, 'dias', dias, 'faltas', (select n from habiles) - dias, 'retardos', retardos) order by dias, nombre), '[]')
                     from (select * from asis_persona where dias > 0 order by dias, nombre limit 10) x),
      'mas_retardos', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'puesto', puesto, 'dias', dias, 'retardos', retardos) order by retardos desc, nombre), '[]')
                       from (select * from asis_persona where retardos > 0 order by retardos desc, nombre limit 10) x)
    ),
    'tareas', jsonb_build_object(
      'tableros', (select count(*) from tb),
      'abiertas', (select count(*) from t where not hecha),
      'vencidas', (select count(*) from t where vencida),
      'periodo', (select jsonb_build_object(
          'total', count(*), 'hechas', count(*) filter (where hecha), 'a_tiempo', count(*) filter (where a_tiempo), 'vencidas', count(*) filter (where vencida),
          'pct_cumplimiento', case when count(*) = 0 then null else round(100.0 * count(*) filter (where hecha) / count(*)) end,
          'pct_a_tiempo', case when count(*) filter (where hecha) = 0 then null else round(100.0 * count(*) filter (where a_tiempo) / count(*) filter (where hecha)) end,
          'cambios_fecha', coalesce(sum(fecha_cambios), 0)) from t_periodo),
      'por_area', (select coalesce(jsonb_agg(jsonb_build_object('area', coalesce(area, 'sin área'), 'total', n, 'hechas', h, 'vencidas', v) order by v desc, n desc), '[]')
                   from (select area, count(*) n, count(*) filter (where hecha) h, count(*) filter (where vencida) v from t_periodo group by area) x),
      'por_persona', (select coalesce(jsonb_agg(jsonb_build_object('nombre', coalesce(p.nombre, 'Sin asignar'), 'total', n, 'hechas', h, 'a_tiempo', a, 'vencidas', v) order by v desc, n desc), '[]')
                      from (select asignado_a, count(*) n, count(*) filter (where hecha) h, count(*) filter (where a_tiempo) a, count(*) filter (where vencida) v from t_periodo group by asignado_a order by count(*) filter (where vencida) desc, count(*) desc limit 15) x
                      left join public.profiles p on p.id = x.asignado_a)
    ),
    'evaluaciones', jsonb_build_object(
      'firmadas_12m', (select count(*) from public.evaluaciones_desempeno e where e.grupo_id = v_grupo and e.estatus = 'firmada' and e.firmada_en >= now() - interval '12 months'),
      'borradores', (select count(*) from public.evaluaciones_desempeno e where e.grupo_id = v_grupo and e.estatus <> 'firmada'),
      'promedio', (select round(avg(calificacion)::numeric, 1) from public.evaluaciones_desempeno e where e.grupo_id = v_grupo and e.estatus = 'firmada' and e.firmada_en >= now() - interval '12 months'),
      'por_nivel', (select coalesce(jsonb_agg(jsonb_build_object('nivel', nivel, 'n', n) order by n desc), '[]') from (select nivel, count(*) n from public.evaluaciones_desempeno e where e.grupo_id = v_grupo and e.estatus = 'firmada' and e.firmada_en >= now() - interval '12 months' group by nivel) x),
      'sin_evaluacion_6m', (select count(*) from activos a where a.profile_id is not null and not exists (select 1 from public.evaluaciones_desempeno e where e.profile_id = a.profile_id and e.estatus = 'firmada' and e.firmada_en >= now() - interval '6 months')),
      'ultimas', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'puesto', puesto, 'calificacion', calificacion, 'nivel', nivel, 'fecha', (firmada_en at time zone 'America/Mexico_City')::date, 'evaluador', evaluador_nombre) order by firmada_en desc), '[]')
                  from (select * from public.evaluaciones_desempeno e where e.grupo_id = v_grupo and e.estatus = 'firmada' order by firmada_en desc limit 10) x)
    ),
    'nomina', jsonb_build_object(
      'semanal', (select coalesce(jsonb_agg(jsonb_build_object('empresa', e.codigo, 'semana', s.sem, 'fin', s.fin, 'personas', s.personas, 'total', s.total) order by s.total desc), '[]') from nom_sem_ult s join emp e on e.k = s.k),
      'quincenal', (select coalesce(jsonb_agg(jsonb_build_object('empresa', e.codigo, 'fin', q.fin, 'personas', q.personas, 'total', q.total) order by q.total desc), '[]') from nom_quin_ult q join emp e on e.k = q.k),
      'mano_obra', (select coalesce(jsonb_agg(jsonb_build_object('empresa', e.codigo, 'fin', m.fin, 'personas', m.personas, 'total', m.total) order by m.total desc), '[]') from mo_ult m join emp e on e.k = m.k),
      'semanal_tendencia', (select coalesce(jsonb_agg(jsonb_build_object('fin', fin, 'total', total, 'personas', personas) order by fin), '[]') from sem_tend),
      'sin_empresa', (select coalesce(jsonb_agg(distinct x.nombre), '[]') from (select s.k, (select r.datos ->> 'empresa' from public.nomina_externa_renglones r where r.origen = 'nomina_semanal' and public.normalizar_texto_sql(r.datos ->> 'empresa') = s.k limit 1) as nombre from nom_sem_ult s where not exists (select 1 from emp e where e.k = s.k)) x)
    ),
    'epp', jsonb_build_object(
      'entregadas', (select count(*) from epp where estado = 'entregado'),
      'vencidas', (select count(*) from epp where estado = 'entregado' and vence_el is not null and vence_el < hoy),
      'por_vencer_30', (select count(*) from epp where estado = 'entregado' and vence_el between hoy and hoy + 30),
      'por_surtir', (select count(*) from epp where estado = 'por_surtir'),
      'perdidas_por_descontar', (select coalesce(sum(descuento_monto), 0) from epp where estado = 'perdido' and descuento_aplicado_en is null),
      'solicitudes_pendientes', (select count(*) from public.epp_solicitudes s where s.grupo_id = v_grupo and s.estado = 'pendiente'),
      'vencidas_lista', (select coalesce(jsonb_agg(jsonb_build_object('persona', persona, 'pieza', descripcion, 'vencio', vence_el) order by vence_el), '[]') from (select * from epp where estado = 'entregado' and vence_el is not null and vence_el < hoy order by vence_el limit 15) x)
    ),
    'herramienta', jsonb_build_object(
      'asignadas', (select count(*) from public.herramientas h where h.empresa_id in (select id from emp) and h.estado = 'asignada'),
      'regreso_vencido', (select count(*) from public.herramientas h where h.empresa_id in (select id from emp) and h.estado = 'asignada' and h.devolver_el is not null and h.devolver_el < hoy),
      'extraviadas', (select count(*) from public.herramientas h where h.empresa_id in (select id from emp) and h.estado = 'extraviada'),
      'reparacion', (select count(*) from public.herramientas h where h.empresa_id in (select id from emp) and h.estado = 'reparacion'),
      'vencidas_lista', (select coalesce(jsonb_agg(jsonb_build_object('folio', folio, 'nombre', nombre, 'responsable', responsable_nombre, 'devolver_el', devolver_el) order by devolver_el), '[]')
                         from (select * from public.herramientas h where h.empresa_id in (select id from emp) and h.estado = 'asignada' and h.devolver_el is not null and h.devolver_el < hoy order by devolver_el limit 15) x)
    ),
    'financiamiento', jsonb_build_object(
      'cuentas', (select count(*) from public.cuentas_nomina c where c.grupo_id = v_grupo),
      'con_linea', (select count(*) from public.cuentas_nomina c where c.grupo_id = v_grupo and c.linea > 0 and c.estatus = 'activa'),
      'linea_total', (select coalesce(sum(linea), 0) from public.cuentas_nomina c where c.grupo_id = v_grupo and c.estatus = 'activa'),
      'con_sueldo', (select count(*) from public.cuentas_nomina c where c.grupo_id = v_grupo and c.sueldo_semanal > 0),
      'saldo_vigente', (select coalesce(sum(saldo), 0) from public.v_nomina_cargos v where v.grupo_id = v_grupo and v.estatus = 'vigente'),
      'cargos_vigentes', (select count(*) from public.v_nomina_cargos v where v.grupo_id = v_grupo and v.estatus = 'vigente'),
      'con_atraso', (select count(*) from public.v_nomina_cargos v where v.grupo_id = v_grupo and v.estatus = 'vigente' and coalesce(v.atraso, 0) > 0),
      'por_firmar', (select count(*) from public.v_nomina_cargos v where v.grupo_id = v_grupo and v.estatus = 'por_firmar')
    ),
    'accesos', jsonb_build_object(
      'activas', (select count(*) from cuentas where activo),
      'con_push', (select count(*) from cuentas where activo and push),
      'sin_push', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'rol', rol) order by nombre), '[]') from cuentas where activo and not push and rol <> 'pendiente'),
      'pendientes', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre) order by nombre), '[]') from cuentas where activo and rol = 'pendiente'),
      'por_rol', (select coalesce(jsonb_agg(jsonb_build_object('rol', rol, 'n', n) order by n desc), '[]') from (select rol, count(*) n from cuentas where activo group by rol) x)
    )
  ) into r;
  return r;
end;
$function$;

revoke all on function public.fn_reporte_rh_director(integer) from public, anon;
grant execute on function public.fn_reporte_rh_director(integer) to authenticated, service_role;
