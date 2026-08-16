-- Vistas de reporting para el dashboard (SPEC.md sección 5).
--
-- IMPORTANTE: todas llevan `security_invoker = true`. Sin esa opción, una
-- vista en Postgres se ejecuta con los permisos de su DUEÑO (aquí, el rol
-- que corre las migraciones, que también es dueño de `movimientos`) y eso
-- EVADE RLS -- cualquier usuario autenticado vería datos agregados de las
-- 8 empresas sin importar su rol/empresa asignada. Con security_invoker,
-- la vista respeta el RLS de quien la consulta, igual que si hiciera la
-- misma query directo contra la tabla base.

-- % FACTURA "ajustado" (sección 5.1): se excluyen del universo los
-- movimientos en estado pendiente_esperado -- son las excepciones ya
-- documentadas (proveedor con crédito, sección 4.4) que no deben penalizar
-- el KPI mientras están dentro de su ventana de tolerancia.
create view public.v_kpis_mensuales with (security_invoker = true) as
select
  empresa_id,
  extract(year from fecha_pago)::int as anio,
  extract(month from fecha_pago)::int as mes,
  count(*) as movimientos,
  round(100.0 * count(*) filter (where proyecto is not null) / nullif(count(*), 0), 1) as pct_proyecto,
  round(100.0 * count(*) filter (where nombre_razon_social is not null) / nullif(count(*), 0), 1) as pct_nombre,
  round(
    100.0 * count(*) filter (where factura is not null and estado_clasificacion <> 'pendiente_esperado')
    / nullif(count(*) filter (where estado_clasificacion <> 'pendiente_esperado'), 0),
    1
  ) as pct_factura_ajustado,
  coalesce(sum(cargo_total), 0) as total_cargo,
  coalesce(sum(abono_total), 0) as total_abono
from public.movimientos
group by empresa_id, extract(year from fecha_pago), extract(month from fecha_pago);

-- Vista por empresa (sección 5.2), acumulado sin desglose mensual.
create view public.v_movimientos_por_empresa with (security_invoker = true) as
select
  empresa_id,
  count(*) as movimientos,
  coalesce(sum(cargo_total), 0) as total_cargo,
  coalesce(sum(abono_total), 0) as total_abono,
  coalesce(sum(abono_total), 0) - coalesce(sum(cargo_total), 0) as neto
from public.movimientos
group by empresa_id;

-- Saldo de cierre por cuenta (sección 5.3): el saldo del movimiento más
-- reciente de cada cuenta es el saldo inicial del mes siguiente.
create view public.v_saldo_cierre_cuenta with (security_invoker = true) as
select distinct on (cuenta_id)
  cuenta_id,
  empresa_id,
  fecha_pago as fecha_ultimo_movimiento,
  saldo as saldo_cierre
from public.movimientos
order by cuenta_id, fecha_pago desc, created_at desc;

-- Concentrado de pendientes (sección 5.4): proveedores/clientes con
-- movimientos sin factura real, excluyendo las excepciones documentadas.
create view public.v_concentrado_pendientes with (security_invoker = true) as
select
  empresa_id,
  nombre_razon_social,
  count(*) as movimientos_pendientes,
  coalesce(sum(coalesce(cargo_total, 0) + coalesce(abono_total, 0)), 0) as monto_total
from public.movimientos
where estado_clasificacion = 'pendiente_revision'
  and nombre_razon_social is not null
group by empresa_id, nombre_razon_social
order by monto_total desc;
