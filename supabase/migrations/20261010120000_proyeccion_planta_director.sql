-- Proyección anual de la planta para el director general (Mario, 10-oct-2026:
-- "hacer proyección para mi rol como director general en Clavicón; un dash
-- resumen con la proyección anual con la programación actual que existe,
-- quitando semanas y días de vacaciones del personal, y estimados de venta /
-- producción y utilidad anual").
--
-- La función solo junta los datos (todo sin IVA); el cálculo de días
-- productivos, festivos, vacaciones de ley y utilidad está en
-- web/src/lib/proyeccionPlanta.ts (con pruebas). Solo el admin de la
-- organización maestra: cuenta dinero y nómina.
--
-- Ya aplicado en producción.

create or replace function public.fn_proyeccion_planta_datos(p_empresa uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with permitido as (select (select public.auth_admin_global_definer()) as ok),
  emp as (select id, nombre, public.normalizar_texto_sql(nombre) as k from public.empresas where id = p_empresa),
  nom as (
    select r.datos ->> 'empleado' as empleado, r.datos ->> 'puesto' as puesto,
           (r.datos ->> 'fecha_inicio')::date as ini, (r.datos ->> 'pago')::numeric as pago
      from public.nomina_externa_renglones r, emp
     where r.origen = 'nomina_semanal' and public.normalizar_texto_sql(r.datos ->> 'empresa') = emp.k
  ),
  ultima as (select max(ini) as ini from nom),
  personas as (
    select n.empleado, max(n.puesto) as puesto, sum(n.pago) as pago_semanal,
           (select pe.fecha_ingreso from public.personal pe where pe.backoffice_empleado = n.empleado limit 1) as ingreso
      from nom n, ultima u where n.ini = u.ini group by n.empleado
  ),
  lotes as (
    select o.folio, o.estado, o.fecha_inicio, o.fecha_fin, o.dias_planeados,
           coalesce(nullif(o.cantidad_producida, 0), o.cantidad_planeada) as cantidad, p.nombre as producto, o.producto_id
      from public.ordenes_produccion o join public.productos_produccion p on p.id = o.producto_id
     where o.empresa_id = p_empresa and o.estado <> 'cancelada'
  ),
  -- Producto principal: el del lote más reciente.
  prod as (select producto_id from lotes order by fecha_inicio desc limit 1),
  receta as (
    select coalesce(sum(ri.cantidad_por_unidad * coalesce(s.costo_peps, u.costo_unitario, s.costo_promedio_ponderado, 0)), 0) as mp_pieza,
           jsonb_agg(jsonb_build_object('materia', mp.nombre, 'por_pieza', ri.cantidad_por_unidad,
                     'costo', coalesce(s.costo_peps, u.costo_unitario, s.costo_promedio_ponderado))) as detalle
      from prod join public.receta_items ri on ri.producto_id = prod.producto_id
      join public.materias_primas mp on mp.id = ri.materia_prima_id
      left join public.v_stock_materia_prima s on s.materia_prima_id = ri.materia_prima_id
      left join lateral (
        select m.costo_unitario from public.movimientos_materia_prima m
         where m.materia_prima_id = ri.materia_prima_id and m.tipo = 'entrada'
         order by m.fecha desc, m.created_at desc limit 1
      ) u on true
  ),
  venta as (
    select round(sum(l.cantidad * l.precio_unitario) / nullif(sum(l.cantidad), 0), 4) as precio, sum(l.cantidad) as vendido
      from public.remisiones_produccion r join public.remisiones_produccion_lineas l on l.remision_id = r.id
     where r.empresa_id = p_empresa and r.tipo = 'salida' and l.precio_unitario is not null
  ),
  -- Gastos de la planta (OC sin IVA de su proyecto corporativo), sin la
  -- materia prima de la receta ni impuestos (ISR).
  gastos as (
    select date_trunc('month', oc.fecha_creacion)::date as mes, round(sum(coalesce(i.subtotal, oc.total / 1.16)), 2) as monto
      from public.ordenes_compra oc
      left join public.v_oc_importes i on i.orden_compra_id = oc.id
     where oc.empresa_id = p_empresa and oc.proyecto ilike 'Corporativo%'
       and coalesce(oc.estatus_backoffice, '') <> 'Cancelada' and oc.rechazada_en is null
       and oc.fecha_creacion >= (date_trunc('month', current_date) - interval '6 months')::date
       and not exists (
         select 1 from public.ordenes_compra_lineas l
          where l.orden_compra_id = oc.id
            and (l.item ilike 'ISR%' or exists (
                  select 1 from public.receta_items ri join public.materias_primas mp on mp.id = ri.materia_prima_id
                   where ri.producto_id = (select producto_id from prod)
                     and public.normalizar_texto_sql(l.item) like '%' || split_part(public.normalizar_texto_sql(mp.nombre), ' ', 1) || '%'))
       )
     group by 1
  )
  select case when (select ok from permitido) then jsonb_build_object(
    'empresa', (select nombre from emp),
    'personas', coalesce((select jsonb_agg(jsonb_build_object('nombre', regexp_replace(empleado, '_[A-Za-z]+$', ''), 'puesto', puesto, 'pago_semanal', pago_semanal, 'ingreso', ingreso) order by empleado) from personas), '[]'::jsonb),
    'lotes', coalesce((select jsonb_agg(jsonb_build_object('folio', folio, 'estado', estado, 'inicio', fecha_inicio, 'fin', fecha_fin, 'dias', dias_planeados, 'cantidad', cantidad, 'producto', producto) order by fecha_inicio) from lotes), '[]'::jsonb),
    'mp_pieza', (select round(mp_pieza, 4) from receta),
    'receta', (select detalle from receta),
    'precio_venta', (select precio from venta),
    'vendido', (select vendido from venta),
    'gastos_mes', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'monto', monto) order by mes) from gastos), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.fn_proyeccion_planta_datos(uuid) from public, anon;
grant execute on function public.fn_proyeccion_planta_datos(uuid) to authenticated;
