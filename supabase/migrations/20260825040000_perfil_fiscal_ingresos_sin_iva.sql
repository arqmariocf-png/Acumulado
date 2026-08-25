-- Corrección: "ingresos nominales" (base de ISR, Art. 14 LISR) y "cobrado"
-- (base de IVA) deben ser el SUBTOTAL de la factura, sin IVA. La versión
-- anterior de v_perfil_fiscal_mensual usaba directo `cfdi.total`, que
-- incluye IVA -- eso además hacía que iva_trasladado_mes se calculara
-- aplicando 16% otra vez sobre un monto que ya traía IVA (doble conteo).
--
-- `cfdi` no guarda subtotal por separado, así que se extrae dividiendo el
-- total agregado del mes entre (1 + tasa_iva) -- matemáticamente
-- equivalente a dividir cada factura antes de sumar, porque es una
-- operación lineal, siempre que todas las facturas del mes usen la misma
-- tasa general (limitación ya documentada en la migración anterior).
create or replace view public.v_perfil_fiscal_mensual with (security_invoker = true) as
with meses as (
  select
    p.empresa_id,
    p.anio,
    gs.mes,
    lpad(p.anio::text, 4, '0') || lpad(gs.mes::text, 2, '0') as periodo,
    p.coeficiente_utilidad,
    p.tasa_isr,
    p.tasa_iva,
    p.perdidas_fiscales_inicio_anio
  from public.perfil_fiscal_parametros p
  cross join generate_series(1, 12) as gs (mes)
),
ingresos as (
  select empresa_id, periodo, sum(total) as total
  from public.cfdi
  where tipo = 'emitido'
  group by empresa_id, periodo
),
gastos as (
  select empresa_id, periodo, sum(total) as total
  from public.cfdi
  where tipo = 'recibido'
  group by empresa_id, periodo
),
base as (
  select
    m.empresa_id,
    m.anio,
    m.mes,
    m.periodo,
    m.coeficiente_utilidad,
    m.tasa_isr,
    m.tasa_iva,
    m.perdidas_fiscales_inicio_anio,
    -- subtotal (sin IVA) del total facturado del mes -- base de ISR
    round(coalesce(i.total, 0) / (1 + m.tasa_iva), 2) as ingresos_nominales_mes,
    -- aproximación documentada: cobrado = facturado del mes, también en
    -- subtotal (sin IVA) -- base de IVA trasladado
    round(coalesce(i.total, 0) / (1 + m.tasa_iva), 2) as ingresos_cobrados_mes,
    coalesce(g.total, 0) as gastos_mes
  from meses m
  left join ingresos i on i.empresa_id = m.empresa_id and i.periodo = m.periodo
  left join gastos g on g.empresa_id = m.empresa_id and g.periodo = m.periodo
),
base2 as (
  select
    *,
    sum(ingresos_nominales_mes) over (partition by empresa_id, anio order by mes) as ingresos_nominales_acumulado
  from base
),
isr as (
  select
    *,
    round(ingresos_nominales_acumulado * coeficiente_utilidad, 2) as utilidad_fiscal_estimada_acumulada,
    greatest(round(ingresos_nominales_acumulado * coeficiente_utilidad, 2) - perdidas_fiscales_inicio_anio, 0) as base_gravable_isr_acumulada
  from base2
),
isr2 as (
  select
    *,
    round(base_gravable_isr_acumulada * tasa_isr, 2) as isr_causado_acumulado
  from isr
),
isr3 as (
  select
    *,
    isr_causado_acumulado - coalesce(lag(isr_causado_acumulado) over (partition by empresa_id, anio order by mes), 0) as isr_a_cargo_mes
  from isr2
),
iva as (
  select
    *,
    round(ingresos_cobrados_mes * tasa_iva, 2) as iva_trasladado_mes,
    round(gastos_mes - (gastos_mes / (1 + tasa_iva)), 2) as iva_acreditable_mes
  from isr3
)
select
  empresa_id,
  anio,
  mes,
  periodo,
  ingresos_nominales_mes,
  ingresos_nominales_acumulado,
  coeficiente_utilidad,
  utilidad_fiscal_estimada_acumulada,
  perdidas_fiscales_inicio_anio,
  base_gravable_isr_acumulada,
  tasa_isr,
  isr_causado_acumulado,
  isr_a_cargo_mes,
  ingresos_cobrados_mes,
  tasa_iva,
  iva_trasladado_mes,
  gastos_mes,
  iva_acreditable_mes,
  (iva_trasladado_mes - iva_acreditable_mes) as saldo_iva_mes,
  sum(iva_trasladado_mes - iva_acreditable_mes) over (partition by empresa_id, anio order by mes) as saldo_iva_acumulado
from iva
order by empresa_id, anio, mes;

comment on view public.v_perfil_fiscal_mensual is 'ISR (devengado, coeficiente de utilidad acumulado sobre ingresos nominales SIN IVA) e IVA (flujo de efectivo aproximado, trasladado sobre subtotal sin IVA) mes a mes por empresa/año. cfdi.total incluye IVA -- el subtotal se extrae dividiendo entre (1 + tasa_iva). Solo devuelve meses de empresas/años que ya tienen fila en perfil_fiscal_parametros.';
