-- Bug reportado por el área contable: v_perfil_fiscal_mensual estaba
-- sumando los complementos de pago (REP) igual que las facturas normales
-- en el cálculo de ingresos/gastos acumulados de Perfil Fiscal -- doble
-- conteo, porque el monto de un complemento de pago YA fue contado una vez
-- con la factura de ingreso original (PPD). La instrucción confirmada: la
-- base de ingresos acumulados solo debe tomar en cuenta facturas de
-- ingreso y notas de crédito, dejando los complementos de pago como
-- excepción (excluidos).
--
-- `cfdi` no distinguía hasta ahora entre un CFDI normal y un complemento de
-- pago -- ambos se guardaban igual, solo que el complemento de pago usa
-- ImpPagado como su `total` (ver _shared/ingesta/cfdi.ts). Se agrega la
-- columna que sí los distingue.
--
-- IMPORTANTE: estas filas NO se eliminan ni se excluyen del motor de
-- conciliación -- el cruce de FACTURA contra el banco (motor.ts,
-- cruzarFactura) sigue necesitando el monto del complemento de pago para
-- poder casar el pago real de una factura PPD contra el estado de cuenta.
-- La exclusión aplica SOLO a la vista de Perfil Fiscal.
alter table public.cfdi add column es_complemento_pago boolean not null default false;

comment on column public.cfdi.es_complemento_pago is
  'true si la fila viene de una hoja de complementos de pago (RecibosDePago/Pago20), identificada porque solo esas hojas traen columna ImpPagado/"Imp Pagado DR" -- ver mapearFilaCfdi en _shared/ingesta/cfdi.ts. El motor de conciliación sigue usando estas filas para el cruce de FACTURA contra el banco; v_perfil_fiscal_mensual las excluye para no contar el mismo ingreso/gasto dos veces (una vez con la factura, otra con su complemento de pago).';

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
  where tipo = 'emitido' and not es_complemento_pago
  group by empresa_id, periodo
),
gastos as (
  select empresa_id, periodo, sum(total) as total
  from public.cfdi
  where tipo = 'recibido' and not es_complemento_pago
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

comment on view public.v_perfil_fiscal_mensual is 'ISR (devengado, coeficiente de utilidad acumulado sobre ingresos nominales SIN IVA) e IVA (flujo de efectivo aproximado, trasladado sobre subtotal sin IVA) mes a mes por empresa/año. Excluye complementos de pago (es_complemento_pago) de ingresos y gastos -- ya se cuentan con la factura original, contarlos otra vez sería doble conteo. cfdi.total incluye IVA -- el subtotal se extrae dividiendo entre (1 + tasa_iva). Solo devuelve meses de empresas/años que ya tienen fila en perfil_fiscal_parametros.';
