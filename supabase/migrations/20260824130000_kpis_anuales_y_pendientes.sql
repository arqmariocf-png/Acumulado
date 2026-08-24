-- Dos vistas nuevas para el rediseño del Dashboard (sección 5): el usuario
-- pidió (a) una sola tabla de empresas con abonos/cargos/% por mes más un
-- acumulado anual -- para el acumulado anual hace falta el % real del año
-- completo, no el promedio de los % mensuales (sesgaría el número), así que
-- se agrega v_kpis_anuales con la misma fórmula de v_kpis_mensuales pero
-- agrupada solo por empresa_id + año; y (b) el estatus de carga primero de
-- forma global (ya cubierto por v_estado_carga_empresa) y luego específico
-- con la cantidad de movimientos ambiguos/duplicados/faltantes por empresa,
-- cubierto aquí por v_pendientes_por_empresa.
--
-- security_invoker = true en ambas, mismo motivo que el resto de v_* (ver
-- comentario de 20260816090012_vistas_reportes.sql): sin esto, la vista
-- corre con permisos del dueño y evade RLS.

create view public.v_kpis_anuales with (security_invoker = true) as
select
  empresa_id,
  extract(year from fecha_pago)::int as anio,
  count(*) as movimientos,
  round(
    100.0 * count(*) filter (where factura is not null and estado_clasificacion <> 'pendiente_esperado')
    / nullif(count(*) filter (where estado_clasificacion <> 'pendiente_esperado'), 0),
    1
  ) as pct_factura_ajustado,
  coalesce(sum(cargo_total), 0) as total_cargo,
  coalesce(sum(abono_total), 0) as total_abono
from public.movimientos
group by empresa_id, extract(year from fecha_pago);

-- Una fila por empresa activa (0 cuando no hay movimientos en ese estado,
-- en vez de que la empresa simplemente no aparezca) -- mismo patrón de
-- subqueries que v_estado_carga_empresa, para que el Dashboard pueda hacer
-- un solo join por empresa_id sin tener que rellenar huecos a mano.
create view public.v_pendientes_por_empresa with (security_invoker = true) as
select
  e.id as empresa_id,
  coalesce((select count(*) from public.movimientos m where m.empresa_id = e.id and m.estado_clasificacion = 'ambiguo'), 0) as ambiguos,
  coalesce((select count(*) from public.movimientos m where m.empresa_id = e.id and m.posible_duplicado = true), 0) as duplicados,
  coalesce((select count(*) from public.movimientos m where m.empresa_id = e.id and m.estado_clasificacion = 'pendiente_revision'), 0) as faltantes
from public.empresas e
where e.activo = true;

comment on view public.v_kpis_anuales is 'Igual que v_kpis_mensuales pero acumulado por año completo (no promedio de los % mensuales) -- para la columna "Acumulado anual" del Dashboard.';
comment on view public.v_pendientes_por_empresa is 'Cantidad de movimientos ambiguos, posibles duplicados y pendientes de revisión (faltantes) por empresa, para el Dashboard.';
