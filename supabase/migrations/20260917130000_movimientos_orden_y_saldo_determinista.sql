-- Caso real 17-sep-2026 (Delia, cuenta Banorte 1273 de Aceros): el reporte
-- de saldos del día mostró $49,745.24 sin movimientos cuando el banco decía
-- $2,059.79 con $47,685.45 de cargos. Dos causas, una de datos (el parser de
-- Banorte tomaba la fecha de aplicación en vez de la de operación -- se
-- corrige en _shared/ingesta/pdf-estado-cuenta-banorte.ts) y una de
-- esquema, que se arregla aquí:
--
-- Los movimientos de un mismo archivo se insertan en un solo lote y quedan
-- con el MISMO created_at, así que "el último movimiento del día" (del que
-- fn_saldos_diario_cuenta y v_saldo_cierre_cuenta toman el saldo) se
-- resolvía al azar entre los renglones de ese día. Ahora cada movimiento
-- guarda su posición dentro del archivo (el orden en que el banco los
-- lista, que es el orden real de la cadena de saldos) y se usa como
-- desempate.
alter table public.movimientos add column orden_en_archivo integer;
comment on column public.movimientos.orden_en_archivo is 'Posición del movimiento dentro del archivo del que se cargó (1 = primero). Desempate para saber cuál es el último saldo de un día cuando varios renglones comparten fecha y created_at.';

create or replace view public.v_saldo_cierre_cuenta as
select distinct on (cuenta_id) cuenta_id,
  empresa_id,
  fecha_pago as fecha_ultimo_movimiento,
  saldo as saldo_cierre
from public.movimientos
order by cuenta_id, fecha_pago desc, created_at desc, orden_en_archivo desc nulls last;

create or replace function public.fn_saldos_diario_cuenta(p_fecha date)
returns table (
  cuenta_id uuid, empresa_id uuid, empresa_nombre text, banco text, ultimos_4 text, alias text,
  saldo_inicial numeric, entradas numeric, salidas numeric, saldo_final numeric,
  ajuste_saldo numeric, ajuste_nota text, tiene_movimientos boolean
)
language sql stable as $$
  with previo as (
    select distinct on (m.cuenta_id) m.cuenta_id, m.saldo as saldo_previo
    from public.movimientos m
    where m.fecha_pago < p_fecha
    order by m.cuenta_id, m.fecha_pago desc, m.created_at desc, m.orden_en_archivo desc nulls last
  ),
  del_dia_cierre as (
    select distinct on (m.cuenta_id) m.cuenta_id, m.saldo as saldo_cierre_dia
    from public.movimientos m
    where m.fecha_pago = p_fecha
    order by m.cuenta_id, m.created_at desc, m.orden_en_archivo desc nulls last
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
    c.ajuste_saldo,
    c.ajuste_nota,
    (previo.cuenta_id is not null or del_dia_cierre.cuenta_id is not null) as tiene_movimientos
  from public.cuentas_bancarias c
  join public.empresas e on e.id = c.empresa_id
  left join previo on previo.cuenta_id = c.id
  left join del_dia_cierre on del_dia_cierre.cuenta_id = c.id
  left join del_dia_totales t on t.cuenta_id = c.id
  where c.activo
  order by e.nombre, c.banco, c.ultimos_4;
$$;
