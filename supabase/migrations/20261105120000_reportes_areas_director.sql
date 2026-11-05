-- Reportes de las áreas para el director general (5-nov-2026, Mario: "así
-- como generaste el reporte del área de recursos humanos, haz el de todas
-- las áreas para revisarlos e irlos puliendo"). Mismo molde que el de RH:
-- una función devuelve en un jsonb los indicadores del periodo y las listas
-- de cada área; la lib arma semáforos, alertas, resumen y la presentación.
-- Solo el admin de la organización maestra (null para cualquier otro).
-- Forma del jsonb: { area, desde, hasta, dias, indicadores: {clave: número},
-- secciones: {nombre: [renglones]} }. Primera versión: se pule con Mario.

-- ── Histórico (una foto por área, periodo en días y fecha de corte) ─────
create table if not exists public.reportes_areas_historico (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos(id),
  area text not null,
  desde date not null,
  hasta date not null,
  dias integer not null,
  indicadores jsonb not null,
  datos jsonb not null,
  generado_por uuid references auth.users(id) default auth.uid(),
  generado_por_nombre text,
  generado_en timestamptz not null default now(),
  unique (grupo_id, area, dias, hasta)
);
create index if not exists reportes_areas_historico_idx on public.reportes_areas_historico (grupo_id, area, hasta desc);

create or replace function public.reportes_areas_historico_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.grupo_id is null then new.grupo_id := public.auth_grupo_id(); end if;
  if new.generado_por_nombre is null and new.generado_por is not null then
    select nombre into new.generado_por_nombre from public.profiles where id = new.generado_por;
  end if;
  return new;
end;
$$;
create or replace trigger reportes_areas_historico_antes before insert or update on public.reportes_areas_historico
  for each row execute function public.reportes_areas_historico_antes();

alter table public.reportes_areas_historico enable row level security;
create policy frontera_organizacion on public.reportes_areas_historico as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
create policy reportes_areas_historico_select on public.reportes_areas_historico for select
  using ((select public.auth_admin_global_definer()));
create policy reportes_areas_historico_insert on public.reportes_areas_historico for insert
  with check ((select public.auth_admin_global_definer()));
create policy reportes_areas_historico_update on public.reportes_areas_historico for update
  using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
create policy espectador_sin_datos on public.reportes_areas_historico as restrictive for select using (not (select public.auth_es_espectador()));
create policy director_general on public.reportes_areas_historico for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
create trigger solo_consulta before insert or update on public.reportes_areas_historico for each statement execute function public.bloquear_solo_consulta();
grant select, insert, update on public.reportes_areas_historico to authenticated;

-- ── Finanzas ────────────────────────────────────────────────────────────
create or replace function public.fn_reporte_area_finanzas(p_grupo uuid, p_desde date, p_hoy date)
returns jsonb language sql stable security definer set search_path = public as $$
  with emp as (select id, codigo, nombre from public.empresas where grupo_id = p_grupo and activo),
  saldos as (
    select c.id as cuenta_id, c.empresa_id, c.banco, c.ultimos_4, coalesce(m.saldo, 0) + coalesce(c.ajuste_saldo, 0) as saldo, m.fecha_pago
      from public.cuentas_bancarias c
      join emp e on e.id = c.empresa_id
      left join lateral (select saldo, fecha_pago from public.movimientos m where m.cuenta_id = c.id order by fecha_pago desc, orden_en_archivo desc nulls last, created_at desc limit 1) m on true
     where c.activo
  ),
  pp as (select p.*, e.codigo as empresa from public.pagos_programados p join emp e on e.id = p.empresa_id),
  oc as (select v.*, e.codigo as empresa from public.v_oc_pagos v join emp e on e.id = v.empresa_id where coalesce(v.autorizacion, '') <> 'rechazada' and not coalesce(v.pagada_backoffice, false)),
  cxp as (select x.*, e.codigo as empresa from public.v_cxp_empresa x join emp e on e.id = x.empresa_id where coalesce(x.linea_credito, 0) > 0),
  deuda as (select d.* from public.v_deuda_creditos d join emp e on e.id = d.empresa_id where coalesce(d.estatus, 'vigente') not in ('liquidado', 'cancelado')),
  mov as (select m.* from public.movimientos m join emp e on e.id = m.empresa_id where m.fecha_pago between p_desde and p_hoy)
  select jsonb_build_object(
    'indicadores', jsonb_build_object(
      'saldo_bancos', (select round(coalesce(sum(saldo), 0), 2) from saldos),
      'cuentas_activas', (select count(*) from saldos),
      'cuentas_sin_estado_7d', (select count(*) from saldos where fecha_pago is null or fecha_pago < p_hoy - 7),
      'pagos_vencidos', (select count(*) from pp where estatus = 'pendiente' and fecha_programada < p_hoy),
      'pagos_vencidos_monto', (select round(coalesce(sum(monto), 0), 2) from pp where estatus = 'pendiente' and fecha_programada < p_hoy),
      'pagos_7d', (select count(*) from pp where estatus = 'pendiente' and fecha_programada between p_hoy and p_hoy + 7),
      'pagos_7d_monto', (select round(coalesce(sum(monto), 0), 2) from pp where estatus = 'pendiente' and fecha_programada between p_hoy and p_hoy + 7),
      'pagados_periodo', (select count(*) from pp where estatus = 'pagado' and pagado_en between p_desde and p_hoy),
      'pagados_periodo_monto', (select round(coalesce(sum(monto), 0), 2) from pp where estatus = 'pagado' and pagado_en between p_desde and p_hoy),
      'pagos_sin_comprobante', (select count(*) from pp where estatus = 'pagado' and pagado_en between p_desde and p_hoy and comprobante_path is null and coalesce(metodo, '') <> 'efectivo'),
      'pct_sin_comprobante', (select round(100.0 * count(*) filter (where comprobante_path is null) / nullif(count(*), 0)) from pp where estatus = 'pagado' and pagado_en between p_desde and p_hoy and coalesce(metodo, '') <> 'efectivo'),
      'oc_por_autorizar', (select count(*) from oc where autorizacion = 'pendiente' and coalesce(saldo, total) > 0.01),
      'oc_por_autorizar_monto', (select round(coalesce(sum(coalesce(saldo, total)), 0), 2) from oc where autorizacion = 'pendiente' and coalesce(saldo, total) > 0.01),
      'oc_con_saldo', (select count(*) from oc where coalesce(saldo, total) > 0.01),
      'oc_con_saldo_monto', (select round(coalesce(sum(coalesce(saldo, total)), 0), 2) from oc where coalesce(saldo, total) > 0.01),
      'oc_vencidas', (select count(*) from oc where coalesce(saldo, total) > 0.01 and vence is not null and vence < p_hoy),
      'oc_vencidas_monto', (select round(coalesce(sum(coalesce(saldo, total)), 0), 2) from oc where coalesce(saldo, total) > 0.01 and vence is not null and vence < p_hoy),
      'cxp_deuda', (select round(coalesce(sum(deuda), 0), 2) from cxp),
      'cxp_lineas', (select round(coalesce(sum(linea_credito), 0), 2) from cxp),
      'cxp_proveedores', (select count(*) from cxp),
      'cxp_rojos', (select count(*) from cxp where deuda > linea_credito),
      'deuda_financiera', (select round(coalesce(sum(saldo), 0), 2) from deuda where coalesce(moneda, 'MXN') = 'MXN'),
      'deuda_creditos', (select count(*) from deuda),
      'prestamos_30d', (select round(coalesce(sum(monto), 0), 2) from pp where tipo = 'prestamo' and estatus = 'pendiente' and fecha_programada between p_hoy and p_hoy + 30),
      'movimientos_periodo', (select count(*) from mov),
      'conciliados_pct', (select round(100.0 * count(*) filter (where estado_clasificacion = 'resuelto') / nullif(count(*), 0)) from mov),
      'en_revision', (select count(*) from mov where estado_clasificacion in ('pendiente_revision', 'ambiguo')),
      'gastos_por_revisar', (select count(*) from public.comprobaciones_gasto g join emp e on e.id = g.empresa_id where coalesce(g.estatus, 'pendiente') = 'pendiente')
    ),
    'secciones', jsonb_build_object(
      'saldos_por_empresa', (select coalesce(jsonb_agg(jsonb_build_object('empresa', e.codigo, 'saldo', s.saldo, 'cuentas', s.n, 'al', s.al) order by s.saldo desc), '[]')
                               from (select empresa_id, round(sum(saldo), 2) saldo, count(*) n, max(fecha_pago) al from saldos group by 1) s join emp e on e.id = s.empresa_id),
      'pagos_vencidos', (select coalesce(jsonb_agg(x order by (x ->> 'fecha')), '[]') from (
                           select jsonb_build_object('empresa', empresa, 'beneficiario', beneficiario, 'monto', monto, 'fecha', fecha_programada, 'tipo', tipo, 'metodo', metodo) x
                             from pp where estatus = 'pendiente' and fecha_programada < p_hoy order by fecha_programada limit 12) z),
      'cxp_top', (select coalesce(jsonb_agg(x), '[]') from (
                    select jsonb_build_object('proveedor', proveedor, 'empresa', empresa, 'deuda', round(deuda, 2), 'linea', linea_credito, 'pct', round(100 * deuda / nullif(linea_credito, 0))) x
                      from cxp order by deuda desc limit 10) z),
      'deuda_creditos', (select coalesce(jsonb_agg(x), '[]') from (
                           select jsonb_build_object('empresa', empresa_codigo, 'acreedor', acreedor, 'saldo', round(saldo, 2), 'moneda', moneda, 'vence', fecha_vencimiento, 'tasa', tasa_anual) x
                             from deuda order by saldo desc limit 10) z),
      'oc_por_autorizar', (select coalesce(jsonb_agg(x), '[]') from (
                             select jsonb_build_object('empresa', empresa, 'folio', id_orden, 'tipo', tipo, 'proveedor', proveedor, 'saldo', round(coalesce(saldo, total), 2), 'fecha', fecha_creacion) x
                               from oc where autorizacion = 'pendiente' and coalesce(saldo, total) > 0.01 order by coalesce(saldo, total) desc limit 10) z)
    )
  )
$$;

-- ── Contabilidad ────────────────────────────────────────────────────────
create or replace function public.fn_reporte_area_contabilidad(p_grupo uuid, p_desde date, p_hoy date)
returns jsonb language sql stable security definer set search_path = public as $$
  with emp as (select id, codigo, nombre from public.empresas where grupo_id = p_grupo and activo),
  cf as (select c.*, e.codigo as empresa from public.cfdi c join emp e on e.id = c.empresa_id
          where c.fecha between p_desde and p_hoy and coalesce(c.tipo_comprobante, 'I') <> 'N'),
  sat as (
    select e.id as empresa_id, e.codigo as empresa, s.tipo, s.hasta, s.estado, s.mensaje
      from emp e
      cross join (values ('emitidos'), ('recibidos')) t(tipo)
      left join lateral (
        select max(fecha_final)::date as hasta,
               (select estado from public.sat_descargas x where x.empresa_id = e.id and x.tipo = t.tipo order by created_at desc limit 1) as estado,
               (select mensaje from public.sat_descargas x where x.empresa_id = e.id and x.tipo = t.tipo order by created_at desc limit 1) as mensaje
          from public.sat_descargas d where d.empresa_id = e.id and d.tipo = t.tipo and d.estado in ('descargada', 'vacia')
      ) s on true
  ),
  sat_emp as (select empresa_id, empresa, min(hasta) as hasta, bool_or(estado = 'error') as con_error, max(mensaje) filter (where estado = 'error') as error from sat group by 1, 2),
  mov as (select m.*, e.codigo as empresa from public.movimientos m join emp e on e.id = m.empresa_id where m.fecha_pago between p_desde and p_hoy),
  cuentas as (
    select c.id, c.empresa_id, m.fecha_pago
      from public.cuentas_bancarias c join emp e on e.id = c.empresa_id
      left join lateral (select fecha_pago from public.movimientos m where m.cuenta_id = c.id order by fecha_pago desc limit 1) m on true
     where c.activo
  ),
  rem as (
    select 'almacen' as origen, r.folio, r.fecha, r.entregar_a as contraparte, e.codigo as empresa from public.remisiones_salida r join emp e on e.id = r.empresa_id where r.factura_estado = 'por_facturar'
    union all
    select 'planta', r.folio, r.fecha, r.contraparte, e.codigo from public.remisiones_produccion r join emp e on e.id = r.empresa_id where r.factura_estado = 'por_facturar'
  )
  select jsonb_build_object(
    'indicadores', jsonb_build_object(
      'cfdi_emitidos', (select count(*) from cf where tipo = 'emitido' and coalesce(tipo_comprobante, 'I') = 'I'),
      'cfdi_emitidos_monto', (select round(coalesce(sum(total), 0), 2) from cf where tipo = 'emitido' and coalesce(tipo_comprobante, 'I') = 'I'),
      'cfdi_recibidos', (select count(*) from cf where tipo = 'recibido' and coalesce(tipo_comprobante, 'I') = 'I'),
      'cfdi_recibidos_monto', (select round(coalesce(sum(total), 0), 2) from cf where tipo = 'recibido' and coalesce(tipo_comprobante, 'I') = 'I'),
      'complementos_periodo', (select count(*) from cf where coalesce(es_complemento_pago, false) or tipo_comprobante = 'P'),
      'sat_al_dia', (select count(*) from sat_emp where hasta >= p_hoy - 2),
      'sat_atrasadas', (select count(*) from sat_emp where hasta is null or hasta < p_hoy - 2),
      'sat_con_error', (select count(*) from sat_emp where con_error),
      'efirmas', (select count(*) from public.sat_efirmas f join emp e on e.id = f.empresa_id),
      'empresas', (select count(*) from emp),
      'movimientos_periodo', (select count(*) from mov),
      'conciliados', (select count(*) from mov where estado_clasificacion = 'resuelto'),
      'conciliados_pct', (select round(100.0 * count(*) filter (where estado_clasificacion = 'resuelto') / nullif(count(*), 0)) from mov),
      'en_revision', (select count(*) from mov where estado_clasificacion = 'pendiente_revision'),
      'ambiguos', (select count(*) from mov where estado_clasificacion = 'ambiguo'),
      'esperando_factura', (select count(*) from mov where estado_clasificacion = 'pendiente_esperado'),
      'duplicados', (select count(*) from mov where coalesce(posible_duplicado, false)),
      'estados_cuenta_cargados', (select count(*) from public.archivos_cargados a join emp e on e.id = a.empresa_id where a.tipo = 'estado_cuenta' and a.created_at >= p_desde),
      'cuentas_sin_estado_7d', (select count(*) from cuentas where fecha_pago is null or fecha_pago < p_hoy - 7),
      'remisiones_por_facturar', (select count(*) from rem)
    ),
    'secciones', jsonb_build_object(
      'por_empresa', (select coalesce(jsonb_agg(jsonb_build_object(
                          'empresa', e.codigo,
                          'emitidos', (select count(*) from cf where cf.empresa_id = e.id and tipo = 'emitido' and coalesce(tipo_comprobante, 'I') = 'I'),
                          'emitidos_monto', (select round(coalesce(sum(total), 0), 2) from cf where cf.empresa_id = e.id and tipo = 'emitido' and coalesce(tipo_comprobante, 'I') = 'I'),
                          'recibidos', (select count(*) from cf where cf.empresa_id = e.id and tipo = 'recibido' and coalesce(tipo_comprobante, 'I') = 'I'),
                          'recibidos_monto', (select round(coalesce(sum(total), 0), 2) from cf where cf.empresa_id = e.id and tipo = 'recibido' and coalesce(tipo_comprobante, 'I') = 'I'),
                          'movimientos', (select count(*) from mov where mov.empresa_id = e.id),
                          'conciliados_pct', (select round(100.0 * count(*) filter (where estado_clasificacion = 'resuelto') / nullif(count(*), 0)) from mov where mov.empresa_id = e.id),
                          'ultimo_estado', (select max(fecha_pago) from cuentas where cuentas.empresa_id = e.id)
                        ) order by e.codigo), '[]') from emp e),
      'sat_por_empresa', (select coalesce(jsonb_agg(jsonb_build_object('empresa', empresa, 'hasta', hasta, 'atrasada', (hasta is null or hasta < p_hoy - 2), 'error', error) order by empresa), '[]') from sat_emp),
      'remisiones_por_facturar', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('origen', origen, 'folio', folio, 'empresa', empresa, 'fecha', fecha, 'contraparte', contraparte) x from rem order by fecha limit 12) z)
    )
  )
$$;

-- ── Comercial (ventas, cobranza, CRM, punto de venta) ───────────────────
create or replace function public.fn_reporte_area_comercial(p_grupo uuid, p_desde date, p_hoy date)
returns jsonb language sql stable security definer set search_path = public as $$
  with emp as (select id, codigo, nombre from public.empresas where grupo_id = p_grupo and activo),
  ov as (select o.*, e.codigo as empresa from public.ordenes_venta o join emp e on e.id = o.empresa_id where o.fecha_ov between p_desde and p_hoy and o.cancelada_en is null),
  cartera as (select d from jsonb_array_elements(coalesce(public.fn_cxc_cartera() -> 'documentos', '[]'::jsonb)) d),
  cxc as (select (d ->> 'saldo')::numeric as saldo, (d ->> 'vence')::date as vence, d ->> 'cliente' as cliente, d ->> 'empresa' as empresa, (d ->> 'cliente_empresa_id') is not null as grupo from cartera where (d ->> 'saldo')::numeric > 0.01),
  crm as (select c.* from public.crm_prospectos c join emp e on e.id = c.empresa_id),
  cot as (select c.*, e.codigo as empresa from public.cotizaciones_produccion c join emp e on e.id = c.empresa_id where c.fecha between p_desde and p_hoy),
  pv as (select v.* from public.v_pv_ventas v join emp e on e.id = v.empresa_id where (v.fecha at time zone 'America/Mexico_City')::date between p_desde and p_hoy and v.estado <> 'cancelada')
  select jsonb_build_object(
    'indicadores', jsonb_build_object(
      'ov_periodo', (select count(*) from ov),
      'ov_periodo_monto', (select round(coalesce(sum(total), 0), 2) from ov),
      'ov_clientes', (select count(distinct lower(cliente)) from ov),
      'cxc_saldo', (select round(coalesce(sum(saldo), 0), 2) from cxc where not grupo),
      'cxc_vencido', (select round(coalesce(sum(saldo), 0), 2) from cxc where not grupo and vence is not null and vence < p_hoy),
      'cxc_documentos', (select count(*) from cxc where not grupo),
      'cxc_clientes', (select count(distinct cliente) from cxc where not grupo),
      'cxc_grupo', (select round(coalesce(sum(saldo), 0), 2) from cxc where grupo),
      'crm_abiertos', (select count(*) from crm where coalesce(etapa, 'nuevo') not in ('ganado', 'perdido')),
      'crm_sin_respuesta', (select count(*) from crm where coalesce(etapa, 'nuevo') not in ('ganado', 'perdido') and ultimo_entrante_en is not null and ultimo_entrante_en > coalesce(ultimo_saliente_en, '-infinity'::timestamptz) and ultimo_entrante_en < now() - interval '2 hours'),
      'crm_nuevos_periodo', (select count(*) from crm where created_at >= p_desde),
      'crm_ganados_periodo', (select count(*) from crm where etapa = 'ganado' and updated_at >= p_desde),
      'cotizaciones_periodo', (select count(*) from cot),
      'cotizaciones_convertidas', (select count(*) from cot where orden_venta_id is not null),
      'pv_ventas', (select count(*) from pv),
      'pv_monto', (select round(coalesce(sum(total), 0), 2) from pv),
      'pv_utilidad', (select round(coalesce(sum(utilidad), 0), 2) from pv),
      'pv_por_entregar', (select count(*) from pv where coalesce(por_entregar, 0) > 0)
    ),
    'secciones', jsonb_build_object(
      'ov_por_empresa', (select coalesce(jsonb_agg(x order by (x ->> 'monto')::numeric desc), '[]') from (select jsonb_build_object('empresa', empresa, 'n', count(*), 'monto', round(sum(total), 2)) x from ov group by empresa) z),
      'ov_top_clientes', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('cliente', cliente, 'empresa', empresa, 'n', count(*), 'monto', round(sum(total), 2)) x from ov group by cliente, empresa order by sum(total) desc limit 10) z),
      'cxc_top_clientes', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('cliente', cliente, 'empresa', empresa, 'saldo', round(sum(saldo), 2), 'vencido', round(sum(saldo) filter (where vence < p_hoy), 2), 'documentos', count(*)) x from cxc where not grupo group by cliente, empresa order by sum(saldo) desc limit 10) z),
      'crm_por_etapa', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('etapa', coalesce(etapa, 'nuevo'), 'n', count(*)) x from crm group by etapa order by count(*) desc) z),
      'cotizaciones', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('folio', folio, 'empresa', empresa, 'fecha', fecha, 'cliente', contraparte, 'estatus', estatus, 'convertida', orden_venta_id is not null) x from cot order by fecha desc limit 10) z)
    )
  )
$$;

-- ── Operación (obras) ───────────────────────────────────────────────────
create or replace function public.fn_reporte_area_operacion(p_grupo uuid, p_desde date, p_hoy date)
returns jsonb language sql stable security definer set search_path = public as $$
  with emp as (select id, codigo, nombre from public.empresas where grupo_id = p_grupo and activo),
  obras as (select p.id, p.nombre, p.empresa_id, e.codigo as empresa from public.proyectos p join emp e on e.id = p.empresa_id where p.activo),
  real as (select r.*, o.nombre, o.empresa from public.fn_avance_financiero_real() r join obras o on o.id = r.proyecto_id),
  por_obra as (
    select o.id, o.nombre, o.empresa,
           round(coalesce((select sum(monto_real) from real r where r.proyecto_id = o.id), 0), 2) as real_total,
           round(coalesce((select sum(pagado) from real r where r.proyecto_id = o.id), 0), 2) as pagado_total,
           round(coalesce((select sum(monto_real) from real r where r.proyecto_id = o.id and r.mes >= date_trunc('month', p_desde)::date), 0), 2) as gasto_periodo,
           round(coalesce((select sum(monto) from public.obra_presupuesto b where b.proyecto_id = o.id), (select sum(presupuesto) from public.proyecto_controles c where c.proyecto_id = o.id), 0), 2) as presupuesto
      from obras o
  ),
  tar as (
    select tb.proyecto_id, tj.id, tj.fecha_limite,
           (tj.columna_id = (select c.id from public.tablero_columnas c where c.tablero_id = tb.id order by c.orden desc limit 1) or tj.archivada) as hecha
      from public.tableros tb join obras o on o.id = tb.proyecto_id
      join public.tarjetas tj on tj.tablero_id = tb.id and tj.eliminada_en is null
     where not tb.archivado
  ),
  req as (select r.*, o.nombre as obra from public.requisiciones r join obras o on o.id = r.proyecto_id)
  select jsonb_build_object(
    'indicadores', jsonb_build_object(
      'obras_activas', (select count(*) from obras),
      'obras_con_gasto', (select count(*) from por_obra where real_total > 0),
      'obras_con_presupuesto', (select count(*) from por_obra where presupuesto > 0),
      'gasto_periodo', (select round(coalesce(sum(gasto_periodo), 0), 2) from por_obra),
      'real_total', (select round(coalesce(sum(real_total), 0), 2) from por_obra),
      'presupuesto_total', (select round(coalesce(sum(presupuesto), 0), 2) from por_obra),
      'pendiente_pago', (select round(coalesce(sum(real_total - pagado_total), 0), 2) from por_obra),
      'obras_rebasadas', (select count(*) from por_obra where presupuesto > 0 and real_total > presupuesto),
      'tareas_obra_abiertas', (select count(*) from tar where not hecha),
      'tareas_obra_vencidas', (select count(*) from tar where not hecha and fecha_limite is not null and fecha_limite < p_hoy),
      'tareas_hechas_periodo', (select count(*) from tar t join public.tarjetas tj on tj.id = t.id where t.hecha and (tj.updated_at at time zone 'America/Mexico_City')::date between p_desde and p_hoy),
      'requisiciones_periodo', (select count(*) from req where fecha between p_desde and p_hoy),
      'requisiciones_abiertas', (select count(*) from req where estado = 'enviada' and coalesce(etapa, 'solicitada') <> 'recibida'),
      'requisiciones_sin_resolver', (select count(*) from req where estado = 'enviada' and coalesce(etapa, 'solicitada') = 'solicitada')
    ),
    'secciones', jsonb_build_object(
      'obras_top_gasto', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('obra', nombre, 'empresa', empresa, 'gasto_periodo', gasto_periodo, 'real_total', real_total, 'presupuesto', presupuesto, 'pct', case when presupuesto > 0 then round(100 * real_total / presupuesto) end, 'id', id) x from por_obra where gasto_periodo > 0 order by gasto_periodo desc limit 10) z),
      'obras_rebasadas', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('obra', nombre, 'empresa', empresa, 'real_total', real_total, 'presupuesto', presupuesto, 'exceso', round(real_total - presupuesto, 2), 'id', id) x from por_obra where presupuesto > 0 and real_total > presupuesto order by real_total - presupuesto desc limit 10) z),
      'gasto_por_empresa', (select coalesce(jsonb_agg(x order by (x ->> 'gasto_periodo')::numeric desc), '[]') from (select jsonb_build_object('empresa', empresa, 'obras', count(*), 'gasto_periodo', round(sum(gasto_periodo), 2), 'real_total', round(sum(real_total), 2), 'presupuesto', round(sum(presupuesto), 2)) x from por_obra group by empresa) z),
      'requisiciones_por_etapa', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('etapa', coalesce(etapa, 'solicitada'), 'n', count(*)) x from req where estado = 'enviada' group by etapa order by count(*) desc) z),
      'tareas_vencidas_por_obra', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('obra', o.nombre, 'empresa', o.empresa, 'vencidas', count(*), 'id', o.id) x from tar t join obras o on o.id = t.proyecto_id where not t.hecha and t.fecha_limite < p_hoy group by o.id, o.nombre, o.empresa order by count(*) desc limit 10) z)
    )
  )
$$;

-- ── Compras y almacén ───────────────────────────────────────────────────
create or replace function public.fn_reporte_area_compras(p_grupo uuid, p_desde date, p_hoy date)
returns jsonb language sql stable security definer set search_path = public as $$
  with emp as (select id, codigo, nombre from public.empresas where grupo_id = p_grupo and activo),
  oc as (select o.*, e.codigo as empresa, coalesce(i.subtotal, o.total / 1.16) as subtotal
           from public.ordenes_compra o join emp e on e.id = o.empresa_id left join public.v_oc_importes i on i.orden_compra_id = o.id
          where o.fecha_creacion between p_desde and p_hoy and o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'),
  req as (select r.*, e.codigo as empresa from public.requisiciones r join emp e on e.id = r.empresa_id),
  ex as (select x.*, e.codigo as empresa from public.existencias x join emp e on e.id = x.empresa_id),
  mi as (select m.*, e.codigo as empresa from public.movimientos_inventario m join emp e on e.id = m.empresa_id),
  he as (select h.*, e.codigo as empresa from public.herramientas h join emp e on e.id = h.empresa_id where coalesce(h.estado, '') <> 'baja')
  select jsonb_build_object(
    'indicadores', jsonb_build_object(
      'oc_periodo', (select count(*) from oc),
      'oc_periodo_monto', (select round(coalesce(sum(subtotal), 0), 2) from oc),
      'os_periodo', (select count(*) from oc where tipo = 'OS'),
      'oc_backoffice', (select count(*) from oc where fuente = 'api'),
      'oc_acumulado', (select count(*) from oc where fuente in ('acumulado', 'requisicion', 'excel')),
      'proveedores_periodo', (select count(distinct public.fn_proveedor_clave(proveedor)) from oc),
      'oc_por_autorizar', (select count(*) from oc where autorizada_en is null and coalesce(estatus_backoffice, '') in ('', 'Pendiente de Autorización')),
      'requisiciones_periodo', (select count(*) from req where fecha between p_desde and p_hoy),
      'requisiciones_sin_resolver', (select count(*) from req where estado = 'enviada' and coalesce(etapa, 'solicitada') = 'solicitada'),
      'requisiciones_en_camino', (select count(*) from req where estado = 'enviada' and etapa in ('en_bodega', 'en_transito')),
      'productos', (select count(distinct producto_id) from ex),
      'con_existencia', (select count(*) from ex where existencia > 0),
      'existencias_negativas', (select count(*) from ex where existencia < 0),
      'valor_inventario', (select round(coalesce(sum(valor), 0), 2) from ex where existencia > 0),
      'entradas_periodo', (select count(*) from mi where tipo = 'entrada' and fecha between p_desde and p_hoy),
      'salidas_periodo', (select count(*) from mi where tipo = 'salida' and fecha between p_desde and p_hoy),
      'empresas_sin_captura_7d', (select count(*) from emp e where exists (select 1 from ex where ex.empresa_id = e.id) and not exists (select 1 from mi where mi.empresa_id = e.id and mi.created_at >= p_hoy - 7)),
      'herramientas', (select count(*) from he),
      'herramientas_asignadas', (select count(*) from he where estado = 'asignada'),
      'herramientas_vencidas', (select count(*) from he where estado = 'asignada' and devolver_el is not null and devolver_el < p_hoy),
      'herramientas_extraviadas', (select count(*) from he where estado = 'extraviada'),
      'herramientas_reparacion', (select count(*) from he where estado = 'reparacion')
    ),
    'secciones', jsonb_build_object(
      'oc_por_empresa', (select coalesce(jsonb_agg(x order by (x ->> 'monto')::numeric desc), '[]') from (select jsonb_build_object('empresa', empresa, 'n', count(*), 'monto', round(sum(subtotal), 2), 'servicios', count(*) filter (where tipo = 'OS')) x from oc group by empresa) z),
      'top_proveedores', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('proveedor', min(proveedor), 'n', count(*), 'monto', round(sum(subtotal), 2), 'empresas', string_agg(distinct empresa, ', ')) x from oc group by public.fn_proveedor_clave(proveedor) order by sum(subtotal) desc limit 10) z),
      'inventario_por_empresa', (select coalesce(jsonb_agg(x order by (x ->> 'valor')::numeric desc), '[]') from (
                                   select jsonb_build_object('empresa', e.codigo, 'productos', (select count(distinct producto_id) from ex where ex.empresa_id = e.id), 'negativos', (select count(*) from ex where ex.empresa_id = e.id and existencia < 0),
                                                             'valor', (select round(coalesce(sum(valor), 0), 2) from ex where ex.empresa_id = e.id and existencia > 0),
                                                             'movimientos_periodo', (select count(*) from mi where mi.empresa_id = e.id and fecha between p_desde and p_hoy),
                                                             'ultima_captura', (select max((created_at at time zone 'America/Mexico_City')::date) from mi where mi.empresa_id = e.id)) x
                                     from emp e where exists (select 1 from ex where ex.empresa_id = e.id)) z),
      'herramienta_vencida', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('folio', folio, 'nombre', nombre, 'responsable', responsable_nombre, 'empresa', empresa, 'devolver_el', devolver_el, 'dias', p_hoy - devolver_el) x from he where estado = 'asignada' and devolver_el < p_hoy order by devolver_el limit 10) z)
    )
  )
$$;

-- ── Mantenimiento (BBVA) ────────────────────────────────────────────────
create or replace function public.fn_reporte_area_mantenimiento(p_grupo uuid, p_desde date, p_hoy date)
returns jsonb language sql stable security definer set search_path = public as $$
  -- El control de Christian trae a todos los folios vivos como 'Terminado'
  -- (estatus_operativo) y casi nunca llena fecha_finalizacion ni
  -- fecha_primera_atencion: lo que avanza es la etapa administrativa
  -- (Preparar fichero → Esperar autorización → Fichero realizado) y el cobro.
  -- "En trámite" = no cancelado y sin fichero realizado. Finalizado = fecha
  -- de finalización o, si no la hay, aceptación del cliente.
  with f as (
    select *, (coalesce(estatus_operativo, '') ilike 'cancel%' or coalesce(etapa_seguimiento, '') ilike 'cancel%') as cancelado,
           (not (coalesce(estatus_operativo, '') ilike 'cancel%' or coalesce(etapa_seguimiento, '') ilike 'cancel%')
            and coalesce(etapa_seguimiento, '') not ilike 'fichero realizado%') as abierto,
           coalesce(fecha_finalizacion, fecha_aceptacion_cliente) as fin,
           coalesce(monto_a_cobrar, 0) - coalesce(monto_cobrado, 0) as saldo_calc
      from public.bbva_folios_control
  ),
  emp as (select id, codigo from public.empresas where grupo_id = p_grupo and activo),
  oc as (select o.*, e.codigo as empresa, coalesce(i.subtotal, o.total / 1.16) as subtotal
           from public.ordenes_compra o join emp e on e.id = o.empresa_id left join public.v_oc_importes i on i.orden_compra_id = o.id
          where o.proyecto ilike 'BBVA%' and o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'),
  mo as (select (r.datos ->> 'Monto')::numeric as monto, (r.datos ->> 'Fecha_fin')::date as fin, r.datos ->> 'Nombre' as nombre
           from public.nomina_externa_renglones r where r.origen = 'mano_obra' and r.datos ->> 'Proyecto' ilike 'BBVA%')
  select jsonb_build_object(
    'indicadores', jsonb_build_object(
      'folios_total', (select count(*) from f),
      'folios_abiertos', (select count(*) from f where abierto),
      'esperando_autorizacion', (select count(*) from f where abierto and coalesce(etapa_seguimiento, '') ilike 'esperar%'),
      'viejos_30', (select count(*) from f where abierto and fecha_recepcion < p_hoy - 30),
      'recibidos_periodo', (select count(*) from f where fecha_recepcion between p_desde and p_hoy),
      'finalizados_periodo', (select count(*) from f where fin between p_desde and p_hoy),
      'cancelados', (select count(*) from f where cancelado),
      'monto_a_cobrar', (select round(coalesce(sum(monto_a_cobrar), 0), 2) from f where not cancelado),
      'monto_cobrado', (select round(coalesce(sum(monto_cobrado), 0), 2) from f where not cancelado),
      'saldo_por_cobrar', (select round(coalesce(sum(saldo_por_cobrar), 0), 2) from f where not cancelado),
      'saldo_calculado', (select round(coalesce(sum(saldo_calc), 0), 2) from f where not cancelado and saldo_calc > 0),
      'sin_cobro', (select count(*) from f where not cancelado and coalesce(monto_a_cobrar, 0) > 0 and coalesce(monto_cobrado, 0) = 0),
      'sin_cobro_monto', (select round(coalesce(sum(monto_a_cobrar), 0), 2) from f where not cancelado and coalesce(monto_a_cobrar, 0) > 0 and coalesce(monto_cobrado, 0) = 0),
      'finalizados_sin_pedido', (select count(*) from f where not cancelado and coalesce(btrim(pedido), '') = ''),
      'finalizados_sin_factura', (select count(*) from f where not cancelado and coalesce(btrim(factura), '') = ''),
      'gasto_oc_periodo', (select round(coalesce(sum(subtotal), 0), 2) from oc where fecha_creacion between p_desde and p_hoy),
      'oc_periodo', (select count(*) from oc where fecha_creacion between p_desde and p_hoy),
      'mano_obra_periodo', (select round(coalesce(sum(monto), 0), 2) from mo where fin between p_desde and p_hoy),
      'personas_equipo', (select count(distinct nombre) from mo where fin between p_desde and p_hoy)
    ),
    'secciones', jsonb_build_object(
      'por_etapa', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('etapa', coalesce(etapa_seguimiento, 'Sin etapa'), 'n', count(*), 'monto', round(coalesce(sum(monto_a_cobrar), 0), 2), 'sin_cobro', count(*) filter (where coalesce(monto_a_cobrar, 0) > 0 and coalesce(monto_cobrado, 0) = 0)) x from f where not cancelado group by etapa_seguimiento order by count(*) desc) z),
      'por_supervisor', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('supervisor', coalesce(supervisor, 'Sin supervisor'), 'folios', count(*) filter (where not cancelado), 'abiertos', count(*) filter (where abierto), 'finalizados_periodo', count(*) filter (where fin between p_desde and p_hoy), 'monto', round(coalesce(sum(monto_a_cobrar) filter (where not cancelado), 0), 2), 'sin_cobro', round(coalesce(sum(monto_a_cobrar) filter (where not cancelado and coalesce(monto_cobrado, 0) = 0), 0), 2)) x from f group by supervisor order by count(*) filter (where not cancelado) desc limit 10) z),
      'gasto_por_cliente', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('cliente', coalesce(nullif(btrim(gasto_cliente), ''), 'BBVA (cliente de la obra)'), 'n', count(*), 'monto', round(sum(subtotal), 2)) x from oc where fecha_creacion between p_desde and p_hoy group by coalesce(nullif(btrim(gasto_cliente), ''), 'BBVA (cliente de la obra)') order by sum(subtotal) desc) z),
      'folios_viejos', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('folio', folio, 'sucursal', sucursal, 'recepcion', fecha_recepcion, 'dias', p_hoy - fecha_recepcion, 'etapa', etapa_seguimiento, 'supervisor', supervisor, 'monto', monto_a_cobrar) x from f where abierto order by fecha_recepcion nulls last limit 10) z),
      'folios_sin_cobro', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('folio', folio, 'sucursal', sucursal, 'aceptacion', fecha_aceptacion_cliente, 'etapa', etapa_seguimiento, 'pedido', nullif(btrim(pedido), ''), 'factura', nullif(btrim(factura), ''), 'monto', monto_a_cobrar) x from f where not cancelado and coalesce(monto_a_cobrar, 0) > 0 and coalesce(monto_cobrado, 0) = 0 order by monto_a_cobrar desc nulls last limit 12) z)
    )
  )
$$;

-- ── Producción (plantas) ────────────────────────────────────────────────
create or replace function public.fn_reporte_area_produccion(p_grupo uuid, p_desde date, p_hoy date)
returns jsonb language sql stable security definer set search_path = public as $$
  with emp as (select id, codigo, nombre from public.empresas where grupo_id = p_grupo and activo),
  lotes as (select o.*, e.codigo as empresa, pr.nombre as producto from public.ordenes_produccion o join emp e on e.id = o.empresa_id left join public.productos pr on pr.id = o.producto_id),
  costeo as (select c.* from public.v_costeo_orden_produccion c join emp e on e.id = c.empresa_id),
  rem as (select r.*, e.codigo as empresa from public.v_margen_remisiones_produccion r join emp e on e.id = r.empresa_id where r.fecha between p_desde and p_hoy),
  mp as (select s.*, e.codigo as empresa from public.v_stock_materia_prima s join emp e on e.id = s.empresa_id),
  pt as (select s.*, e.codigo as empresa from public.v_stock_producto_terminado s join emp e on e.id = s.empresa_id)
  select jsonb_build_object(
    'indicadores', jsonb_build_object(
      'lotes_en_proceso', (select count(*) from lotes where estado = 'en_proceso'),
      'lotes_planeados', (select count(*) from lotes where estado = 'planeada'),
      'lotes_terminados_periodo', (select count(*) from lotes where estado = 'terminada' and fecha_fin between p_desde and p_hoy),
      'piezas_periodo', (select round(coalesce(sum(cantidad_producida), 0), 2) from lotes where estado = 'terminada' and fecha_fin between p_desde and p_hoy),
      'costo_unitario_ultimo', (select costo_unitario from costeo where estado = 'terminada' order by fecha_fin desc nulls last limit 1),
      'remisiones_periodo', (select count(*) from rem),
      'venta_periodo', (select round(coalesce(sum(venta), 0), 2) from rem),
      'costo_periodo', (select round(coalesce(sum(costo), 0), 2) from rem),
      'margen_periodo', (select round(coalesce(sum(margen), 0), 2) from rem),
      'margen_pct', (select round(100 * sum(margen) / nullif(sum(venta), 0)) from rem),
      'remisiones_sin_precio', (select count(*) from rem where coalesce(sin_precio, 0) > 0),
      'por_facturar', (select count(*) from public.remisiones_produccion r join emp e on e.id = r.empresa_id where r.factura_estado = 'por_facturar'),
      'valor_materia_prima', (select round(coalesce(sum(valor_peps), 0), 2) from mp),
      'valor_producto_terminado', (select round(coalesce(sum(valor_peps), 0), 2) from pt),
      'piezas_terminadas_stock', (select round(coalesce(sum(stock_actual), 0), 2) from pt)
    ),
    'secciones', jsonb_build_object(
      'lotes', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('folio', l.folio, 'empresa', l.empresa, 'producto', l.producto, 'estado', l.estado, 'inicio', l.fecha_inicio, 'fin', l.fecha_fin, 'cantidad', coalesce(l.cantidad_producida, l.cantidad_planeada), 'costo_unitario', c.costo_unitario) x from lotes l left join costeo c on c.orden_produccion_id = l.id order by coalesce(l.fecha_fin, l.fecha_inicio, l.created_at::date) desc limit 8) z),
      'remisiones', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('folio', folio, 'empresa', empresa, 'fecha', fecha, 'cliente', contraparte, 'venta', venta, 'costo', costo, 'margen', margen) x from rem order by fecha desc limit 10) z),
      'stock_producto_terminado', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('producto', nombre, 'empresa', empresa, 'stock', stock_actual, 'unidad', unidad_medida, 'valor', valor_peps) x from pt where stock_actual <> 0 order by valor_peps desc nulls last limit 10) z),
      'stock_materia_prima', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('materia', nombre, 'empresa', empresa, 'stock', stock_actual, 'unidad', unidad_medida, 'valor', valor_peps) x from mp where stock_actual <> 0 order by valor_peps desc nulls last limit 10) z)
    )
  )
$$;

-- ── Legal y cumplimiento ────────────────────────────────────────────────
create or replace function public.fn_reporte_area_legal(p_grupo uuid, p_desde date, p_hoy date)
returns jsonb language sql stable security definer set search_path = public as $$
  with emp as (select id, codigo, nombre from public.empresas where grupo_id = p_grupo and activo),
  asun as (select a.*, e.codigo as empresa from public.legal_asuntos a join emp e on e.id = a.empresa_id where a.cerrado_en is null and coalesce(a.estatus, '') not in ('cerrado', 'cerrada', 'concluido')),
  docs as (select d.*, e.codigo as empresa from public.legal_empresa_documentos d join emp e on e.id = d.empresa_id),
  arr as (select a.*, e.codigo as empresa from public.legal_arrendamientos a join emp e on e.id = a.empresa_id where coalesce(a.estatus, '') not in ('cancelado', 'terminado')),
  cred as (select c.*, e.codigo as empresa from public.clientes_credito c join emp e on e.id = c.empresa_id),
  ult as (select max(periodo) as periodo from public.cumplimiento_pruebas where grupo_id = p_grupo and periodo ~ '^\d{4}-\d{2}$'),
  pru as (select p.*, c.clave, c.nombre from public.cumplimiento_pruebas p join public.cumplimiento_controles c on c.id = p.control_id where p.grupo_id = p_grupo and p.periodo = (select periodo from ult)),
  inc as (select i.*, e.codigo as empresa from public.cumplimiento_incidencias i join emp e on e.id = i.empresa_id where i.cerrada_en is null)
  select jsonb_build_object(
    'indicadores', jsonb_build_object(
      'asuntos_abiertos', (select count(*) from asun),
      'asuntos_fecha_vencida', (select count(*) from asun where proxima_fecha is not null and proxima_fecha < p_hoy),
      'asuntos_proximos_30', (select count(*) from asun where proxima_fecha between p_hoy and p_hoy + 30),
      'monto_en_riesgo', (select round(coalesce(sum(monto_en_riesgo), 0), 2) from asun),
      'documentos_vencidos', (select count(*) from docs where vence is not null and vence < p_hoy),
      'documentos_por_vencer_30', (select count(*) from docs where vence between p_hoy and p_hoy + 30),
      'arrendamientos_vigentes', (select count(*) from arr where fin is null or fin >= p_hoy),
      'arrendamientos_por_vencer_60', (select count(*) from arr where fin between p_hoy and p_hoy + 60),
      'arrendamientos_vencidos', (select count(*) from arr where fin < p_hoy),
      'creditos_por_autorizar', (select count(*) from cred where not coalesce(autorizado, false)),
      'creditos_autorizados', (select count(*) from cred where coalesce(autorizado, false)),
      'lineas_autorizadas', (select round(coalesce(sum(linea_credito) filter (where coalesce(autorizado, false)), 0), 2) from cred),
      'controles_probados', (select count(*) from pru),
      'controles_cumplen', (select count(*) from pru where resultado = 'cumple'),
      'controles_no_cumplen', (select count(*) from pru where resultado in ('no_cumple', 'excepciones')),
      'incidencias_abiertas', (select count(*) from inc),
      'incidencias_periodo', (select count(*) from public.cumplimiento_incidencias i join emp e on e.id = i.empresa_id where coalesce(i.detectada_el, i.created_at::date) between p_desde and p_hoy)
    ),
    'secciones', jsonb_build_object(
      'periodo_cumplimiento', (select periodo from ult),
      'asuntos', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('folio', folio, 'titulo', titulo, 'empresa', empresa, 'tipo', tipo, 'proxima_fecha', proxima_fecha, 'actuacion', proxima_actuacion, 'estatus', estatus, 'riesgo', monto_en_riesgo) x from asun order by proxima_fecha nulls last limit 10) z),
      'documentos_por_vencer', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('empresa', empresa, 'tipo', tipo, 'nombre', nombre, 'vence', vence, 'dias', vence - p_hoy) x from docs where vence is not null and vence < p_hoy + 60 order by vence limit 10) z),
      'arrendamientos', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('folio', folio, 'empresa', empresa, 'papel', papel, 'contraparte', contraparte, 'inmueble', inmueble, 'renta', renta, 'fin', fin) x from arr order by fin nulls last limit 10) z),
      'controles_no_cumplen', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('clave', clave, 'nombre', nombre, 'resultado', resultado, 'poblacion', poblacion, 'excepciones', excepciones) x from pru where resultado <> 'cumple' order by excepciones desc nulls last limit 10) z),
      'incidencias', (select coalesce(jsonb_agg(x), '[]') from (select jsonb_build_object('folio', folio, 'titulo', titulo, 'empresa', empresa, 'severidad', severidad, 'detectada', detectada_el, 'estatus', estatus) x from inc order by detectada_el desc nulls last limit 10) z)
    )
  )
$$;

-- ── La que llama la pantalla ────────────────────────────────────────────
create or replace function public.fn_reporte_area_director(p_area text, p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  hoy date := (now() at time zone 'America/Mexico_City')::date;
  desde date;
  v_grupo uuid;
  r jsonb;
begin
  if not public.auth_admin_global() then return null; end if;
  select grupo_id into v_grupo from public.profiles where id = auth.uid();
  desde := hoy - (greatest(coalesce(p_dias, 30), 7) - 1);
  r := case p_area
    when 'finanzas' then public.fn_reporte_area_finanzas(v_grupo, desde, hoy)
    when 'contabilidad' then public.fn_reporte_area_contabilidad(v_grupo, desde, hoy)
    when 'comercial' then public.fn_reporte_area_comercial(v_grupo, desde, hoy)
    when 'operacion' then public.fn_reporte_area_operacion(v_grupo, desde, hoy)
    when 'compras' then public.fn_reporte_area_compras(v_grupo, desde, hoy)
    when 'mantenimiento' then public.fn_reporte_area_mantenimiento(v_grupo, desde, hoy)
    when 'produccion' then public.fn_reporte_area_produccion(v_grupo, desde, hoy)
    when 'legal' then public.fn_reporte_area_legal(v_grupo, desde, hoy)
    else null end;
  if r is null then return null; end if;
  return r || jsonb_build_object('area', p_area, 'desde', desde, 'hasta', hoy, 'dias', hoy - desde + 1);
end;
$$;

revoke all on function public.fn_reporte_area_finanzas(uuid, date, date) from public, authenticated;
revoke all on function public.fn_reporte_area_contabilidad(uuid, date, date) from public, authenticated;
revoke all on function public.fn_reporte_area_comercial(uuid, date, date) from public, authenticated;
revoke all on function public.fn_reporte_area_operacion(uuid, date, date) from public, authenticated;
revoke all on function public.fn_reporte_area_compras(uuid, date, date) from public, authenticated;
revoke all on function public.fn_reporte_area_mantenimiento(uuid, date, date) from public, authenticated;
revoke all on function public.fn_reporte_area_produccion(uuid, date, date) from public, authenticated;
revoke all on function public.fn_reporte_area_legal(uuid, date, date) from public, authenticated;
revoke all on function public.fn_reporte_area_director(text, integer) from public;
grant execute on function public.fn_reporte_area_director(text, integer) to authenticated;
