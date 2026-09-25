-- Nivel "socio" (25-sep-2026): Mario participa en varias organizaciones
-- (Grupo Loma y, como primer ejemplo, ARSSA) y quiere una pantalla por
-- encima de la dirección general con todas las empresas de todas ellas y
-- los KPIs de cada una. Los KPIs del organigrama se calculan en el
-- navegador sin filtro de empresa; aquí se calculan POR EMPRESA en la base,
-- en una sola llamada, con las mismas reglas que web/src/lib/indicadores.ts
-- (misma clave = mismo significado). Solo el admin puede llamarla.
-- Ya aplicado en producción.

create or replace function public.fn_kpis_empresa(e uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with hoy as (
    select (now() at time zone 'America/Mexico_City')::date as d,
           ((now() at time zone 'America/Mexico_City')::date)::timestamp at time zone 'America/Mexico_City' as inicio
  )
  select jsonb_build_object(
    -- finanzas
    'fin_saldo_consolidado', (select coalesce(sum(saldo_cierre), 0) from v_saldo_cierre_cuenta where empresa_id = e),
    'fin_pagos_vencidos', (select count(*) from pagos_programados where empresa_id = e and estatus = 'pendiente' and fecha_programada < (select d from hoy)),
    'fin_pagos_semana', (select coalesce(sum(monto), 0) from pagos_programados where empresa_id = e and estatus = 'pendiente' and fecha_programada between (select d from hoy) and (select d from hoy) + 7),
    'fin_saldos_desactualizados', (select count(*) from v_saldo_cierre_cuenta where empresa_id = e and fecha_ultimo_movimiento < (select d from hoy) - 7),
    'fin_prestamos_abiertos', (select count(*) from v_prestamos_intercompania where empresa_id = e and abs(coalesce(monto, 0)) > 0.01),
    -- contabilidad
    'movimientos_revisar', (select coalesce(sum(coalesce(ambiguos, 0) + coalesce(duplicados, 0) + coalesce(faltantes, 0)), 0) from v_pendientes_por_empresa where empresa_id = e),
    'cont_sin_cfdi', (select coalesce(sum(coalesce(faltantes, 0)), 0) from v_pendientes_por_empresa where empresa_id = e),
    'carga_sin_estado', (select case when exists (select 1 from v_estado_carga_empresa where empresa_id = e and ultima_carga_estado_cuenta is null) then 1 else 0 end),
    'cont_dias_ultima_carga', (select extract(day from now() - max(completed_at))::int from archivos_cargados where empresa_id = e and estado = 'completado'),
    'cont_cargas_error', (select count(*) from archivos_cargados where empresa_id = e and estado = 'error' and created_at >= now() - interval '30 days'),
    -- recursos humanos
    'rh_asistencia_hoy', (
      with plantilla as (
        select distinct p.profile_id
        from personal p
        join contrataciones c on c.personal_id = p.id and c.empresa_id = e and c.estatus = 'vigente'
        where p.activo and p.profile_id is not null
      )
      select case when count(*) = 0 then null
                  else round(100.0 * count(*) filter (where exists (
                    select 1 from checador_registros r
                    where r.profile_id = plantilla.profile_id and r.tipo = 'entrada' and r.anulada_en is null
                      and r.created_at >= (select inicio from hoy))) / count(*))
             end
      from plantilla
    ),
    'rh_personal_activo', (select count(distinct c.personal_id) from contrataciones c join personal p on p.id = c.personal_id where c.empresa_id = e and c.estatus = 'vigente' and p.activo),
    'rh_accesos', (select count(*) from v_personal_accesos where empresa_contratacion_id = e and activo and profile_id is null and docs_indispensables >= 3),
    'rh_contratos', (select count(*) from contrataciones where empresa_id = e and estatus = 'vigente' and fecha_fin between (select d from hoy) and (select d from hoy) + 15),
    'rh_vacantes', (select count(*) from vacantes where empresa_id = e and estatus = 'abierta'),
    'rh_firmas_pendientes', (select count(*) from solicitudes_firma where empresa_id = e and estatus = 'pendiente'),
    -- almacén
    'inventario_oc', (select count(*) from avance_recepcion_oc where empresa_id = e and estado_recepcion = 'parcial'),
    'alm_partidas_faltantes', (select count(*) from v_oc_lineas_avance l join ordenes_compra oc on oc.id = l.orden_compra_id where oc.empresa_id = e and l.estado = 'parcial'),
    'alm_partidas_excedente', (select count(*) from v_oc_lineas_avance l join ordenes_compra oc on oc.id = l.orden_compra_id where oc.empresa_id = e and l.estado = 'excedido'),
    'alm_entradas_sin_oc', (select count(*) from movimientos_inventario where empresa_id = e and tipo = 'entrada' and not es_ajuste and orden_compra_id is null),
    'alm_productos_sin_costo', (select count(*) from productos where empresa_id = e and activo and costo_referencia is null),
    'alm_movimientos_hoy', (select count(*) from movimientos_inventario where empresa_id = e and created_at >= (select inicio from hoy)),
    -- logística
    'inventario_remisiones', (select count(*) from remisiones_salida where empresa_id = e and estatus = 'emitida'),
    'produccion_remisiones', (select count(*) from remisiones_produccion where empresa_id = e and estatus = 'emitida'),
    'log_ov_parciales', (select count(*) from avance_embarque_ov where empresa_id = e and estado_embarque = 'parcial'),
    'log_requisiciones', (select count(*) from avance_resolucion_linea a join requisiciones r on r.id = a.requisicion_id where r.empresa_id = e and a.cantidad_sin_resolver > 0),
    'log_dias_entrega', (select coalesce(round(avg(extract(epoch from (entregada_en - created_at)) / 86400)::numeric, 1), 0) from remisiones_salida where empresa_id = e and estatus = 'entregada' and entregada_en is not null and created_at >= now() - interval '30 days'),
    'log_remisiones_semana', (select count(*) from remisiones_salida where empresa_id = e and created_at >= now() - interval '7 days'),
    -- operación
    'produccion_ordenes', (select count(*) from ordenes_produccion where empresa_id = e and estado in ('planeada', 'en_proceso')),
    'op_ordenes_atrasadas', (select count(*) from ordenes_produccion where empresa_id = e and estado in ('planeada', 'en_proceso') and fecha_estimada_embarque < (select d from hoy)),
    'op_operaciones_retrasadas', (select count(*) from operaciones_programadas op join ordenes_produccion o on o.id = op.orden_produccion_id where o.empresa_id = e and op.estado in ('programada', 'en_proceso') and op.fin_programado < now()),
    'precios_pendientes', (select count(*) from pu_analisis where empresa_id = e and estado in ('material_confirmado', 'autorizado')),
    'op_pu_borrador_viejos', (select count(*) from pu_analisis where empresa_id = e and estado = 'borrador' and updated_at < now() - interval '7 days'),
    'op_tareas_vencidas', (select count(*) from tarjetas t join tableros tb on tb.id = t.tablero_id where tb.empresa_id = e and not t.archivada and t.fecha_limite < (select d from hoy)),
    'op_proyectos_activos', (select count(*) from proyectos where empresa_id = e and activo),
    -- generales de la tarjeta
    'usuarios', (select count(*) from profiles where empresa_id = e and rol <> 'pendiente'),
    'cuentas_bancarias', (select count(*) from cuentas_bancarias where empresa_id = e and activo)
  );
$$;

revoke all on function public.fn_kpis_empresa(uuid) from public, anon, authenticated;

-- Organizaciones (grupos) con sus empresas y los KPIs de cada una. La tabla
-- grupos tiene RLS sin policies todavía (la frontera entre organizaciones
-- se está construyendo en otra rama), por eso se lee desde aquí con
-- security definer y guarda de admin, en vez de desde el navegador.
create or replace function public.fn_socio_resumen()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resultado jsonb;
begin
  if coalesce(public.auth_rol() = 'admin', false) is not true then
    raise exception 'Solo el administrador puede ver el resumen de socio' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id,
           'codigo', g.codigo,
           'nombre', g.nombre,
           'marca_comercial', g.marca_comercial,
           'es_maestro', g.es_maestro,
           'activo', g.activo,
           'empresas', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', em.id,
                      'codigo', em.codigo,
                      'nombre', em.nombre,
                      'activo', em.activo,
                      'kpis', public.fn_kpis_empresa(em.id)
                    ) order by em.nombre)
             from public.empresas em
             where em.grupo_id = g.id
           ), '[]'::jsonb)
         ) order by g.es_maestro desc, g.nombre), '[]'::jsonb)
    into resultado
  from public.grupos g
  where g.activo;

  return jsonb_build_object('grupos', resultado, 'calculado_en', now());
end;
$$;

revoke all on function public.fn_socio_resumen() from public, anon;
grant execute on function public.fn_socio_resumen() to authenticated;
