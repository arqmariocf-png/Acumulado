-- Reporte de saldos diarios por cuenta (PDF "Grupo Loma -- Saldos
-- Bancarios" que tesorería genera para Delia/Jaime: entradas/salidas del
-- día y saldo por cuenta bancaria, para poder programar los pagos/compras
-- -- OS/OV -- cargados en el backoffice).
--
-- Igual que las vistas de vistas_reportes.sql: NO es SECURITY DEFINER, así
-- que corre con los permisos de quien llama y respeta RLS normalmente (un
-- rol "empresa" solo verá su propia empresa vía las policies existentes de
-- cuentas_bancarias/movimientos, no hace falta duplicar esa lógica aquí).
--
-- saldo_inicial = último saldo conocido ANTES de p_fecha (o el saldo de
-- cierre del propio día si la cuenta no tiene movimientos previos).
-- saldo_final = último saldo conocido EN o ANTES de p_fecha. Si la cuenta
-- no tiene ningún movimiento hasta esa fecha, ambos quedan en 0 y
-- tiene_movimientos = false para que el reporte pueda distinguir "cuenta en
-- cero" de "cuenta sin historial cargado todavía".
create or replace function public.fn_saldos_diario_cuenta(p_fecha date)
returns table (
  cuenta_id uuid,
  empresa_id uuid,
  empresa_nombre text,
  banco text,
  ultimos_4 text,
  alias text,
  saldo_inicial numeric,
  entradas numeric,
  salidas numeric,
  saldo_final numeric,
  tiene_movimientos boolean
)
language sql
stable
as $$
  with previo as (
    select distinct on (m.cuenta_id) m.cuenta_id, m.saldo as saldo_previo
    from public.movimientos m
    where m.fecha_pago < p_fecha
    order by m.cuenta_id, m.fecha_pago desc, m.created_at desc
  ),
  del_dia_cierre as (
    select distinct on (m.cuenta_id) m.cuenta_id, m.saldo as saldo_cierre_dia
    from public.movimientos m
    where m.fecha_pago = p_fecha
    order by m.cuenta_id, m.created_at desc
  ),
  del_dia_totales as (
    select m.cuenta_id, coalesce(sum(m.abono_total), 0) as entradas, coalesce(sum(m.cargo_total), 0) as salidas
    from public.movimientos m
    where m.fecha_pago = p_fecha
    group by m.cuenta_id
  )
  select
    c.id as cuenta_id,
    c.empresa_id,
    e.nombre as empresa_nombre,
    c.banco,
    c.ultimos_4,
    c.alias,
    coalesce(previo.saldo_previo, del_dia_cierre.saldo_cierre_dia, 0) as saldo_inicial,
    coalesce(t.entradas, 0) as entradas,
    coalesce(t.salidas, 0) as salidas,
    coalesce(del_dia_cierre.saldo_cierre_dia, previo.saldo_previo, 0) as saldo_final,
    (previo.cuenta_id is not null or del_dia_cierre.cuenta_id is not null) as tiene_movimientos
  from public.cuentas_bancarias c
  join public.empresas e on e.id = c.empresa_id
  left join previo on previo.cuenta_id = c.id
  left join del_dia_cierre on del_dia_cierre.cuenta_id = c.id
  left join del_dia_totales t on t.cuenta_id = c.id
  where c.activo
  order by e.nombre, c.banco, c.ultimos_4;
$$;

grant execute on function public.fn_saldos_diario_cuenta(date) to authenticated;
