-- Perfil fiscal: replica el criterio real de cálculo de ISR/IVA que usa el
-- área contable en su papel de trabajo (Excel "PAPEL DE TRABAJO QX
-- SOLUCIONES 2026"), confirmado hoja por hoja con el archivo real:
--
--   IVA -> base de flujo de EFECTIVO (cobrado), tasa 16% sobre ingresos
--          cobrados del mes, menos IVA acreditable de gastos, con saldo
--          arrastrado mes a mes (hoja "IVA", fuente hoja "COBROS").
--   ISR -> base de DEVENGADO (facturado), método de coeficiente de
--          utilidad acumulado (Art. 14 LISR): ingresos nominales
--          acumulados x coeficiente = utilidad fiscal estimada, menos
--          pérdidas fiscales, x tasa ISR, menos pagos provisionales de
--          meses anteriores (hoja "ISR", fuente hoja "FACTURACION").
--
-- Limitaciones conocidas de esta primera versión (aprobadas para arrancar,
-- pendiente de refinar con el área contable):
--   1. "Ingresos cobrados" se aproxima con los CFDI emitidos del mes (no
--      existe en `cfdi` una fecha de cobro real distinta de la fecha de
--      factura -- falta el concepto PUE/PPD). Mientras no se capture esa
--      fecha de cobro, cobrado = facturado.
--   2. "IVA acreditable" se estima extrayendo el 16% implícito del total
--      de CFDI recibidos del mes (total - total/1.16), asumiendo que todo
--      el gasto causa IVA a tasa general. No distingue gastos exentos.
--   3. Las hojas RETENCIONES y PERDIDAS FISCALES del Excel de referencia
--      traían datos de una empresa distinta (ajenos a QX 2026) y no se
--      usaron como fuente -- pérdidas fiscales se captura aquí como un
--      monto editable simple (perdidas_fiscales_inicio_anio), no como un
--      cálculo automático.

-- Parámetros que el área contable captura a mano por empresa y año fiscal:
-- el sistema NO puede inferir el coeficiente de utilidad ni la tasa ISR
-- vigente ni las pérdidas fiscales pendientes de aplicar -- son insumos
-- legales/contables, igual que en el Excel de origen.
create table public.perfil_fiscal_parametros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  anio integer not null check (anio between 2020 and 2100),
  coeficiente_utilidad numeric(8, 6) not null default 0,
  tasa_isr numeric(5, 4) not null default 0.30,
  tasa_iva numeric(5, 4) not null default 0.16,
  perdidas_fiscales_inicio_anio numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (empresa_id, anio)
);

comment on table public.perfil_fiscal_parametros is 'Insumos fiscales capturados a mano por el área contable (coeficiente de utilidad, tasa ISR vigente, pérdidas fiscales pendientes), uno por empresa y año -- fuente de v_perfil_fiscal_mensual.';

create trigger perfil_fiscal_parametros_set_updated_at
  before update on public.perfil_fiscal_parametros
  for each row
  execute function public.set_updated_at();

alter table public.perfil_fiscal_parametros enable row level security;

create policy perfil_fiscal_parametros_select on public.perfil_fiscal_parametros
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

-- Solo corporativo/admin captura los parámetros fiscales (mismo criterio que
-- reglas_clasificacion/excepciones_proveedor: son insumos legales
-- centralizados, no algo que cada empresa edite por su cuenta).
create policy perfil_fiscal_parametros_write on public.perfil_fiscal_parametros
  for all
  using (public.auth_rol() in ('corporativo', 'admin'))
  with check (public.auth_rol() in ('corporativo', 'admin'));

create index perfil_fiscal_parametros_updated_by_idx on public.perfil_fiscal_parametros (updated_by);

-- Cálculo mensual de ISR/IVA replicando las fórmulas confirmadas del Excel.
-- security_invoker = true: no evade RLS de perfil_fiscal_parametros ni de
-- cfdi -- un usuario de una sola empresa solo ve el cálculo de su empresa.
create view public.v_perfil_fiscal_mensual with (security_invoker = true) as
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
    coalesce(i.total, 0) as ingresos_nominales_mes,
    -- aproximación documentada arriba: cobrado = facturado del mes
    coalesce(i.total, 0) as ingresos_cobrados_mes,
    coalesce(g.total, 0) as gastos_mes,
    sum(coalesce(i.total, 0)) over (partition by m.empresa_id, m.anio order by m.mes) as ingresos_nominales_acumulado
  from meses m
  left join ingresos i on i.empresa_id = m.empresa_id and i.periodo = m.periodo
  left join gastos g on g.empresa_id = m.empresa_id and g.periodo = m.periodo
),
isr as (
  select
    *,
    round(ingresos_nominales_acumulado * coeficiente_utilidad, 2) as utilidad_fiscal_estimada_acumulada,
    greatest(round(ingresos_nominales_acumulado * coeficiente_utilidad, 2) - perdidas_fiscales_inicio_anio, 0) as base_gravable_isr_acumulada
  from base
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

comment on view public.v_perfil_fiscal_mensual is 'ISR (devengado, coeficiente de utilidad acumulado) e IVA (flujo de efectivo aproximado) mes a mes por empresa/año, replicando el criterio del papel de trabajo contable real. Solo devuelve meses de empresas/años que ya tienen fila en perfil_fiscal_parametros.';
