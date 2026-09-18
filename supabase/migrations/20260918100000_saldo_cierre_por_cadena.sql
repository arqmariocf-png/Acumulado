-- Caso real 18-sep-2026 (Delia, cuenta BBVA 9954 de Constructora): el reporte
-- mostró $22,086.14 cuando el banco decía $2,086.14. Los dos movimientos del
-- 15-sep llegaron en DOS cargas distintas (el cargo de $20,000 el 17-sep y el
-- abono de $7,000 el 18-sep), y "el último movimiento del día" se resolvía
-- por created_at, así que ganó el abono aunque en el banco ocurrió antes.
--
-- El orden real de los movimientos de un día lo dice la propia cadena de
-- saldos: el renglón de cierre es el único cuyo saldo NO es el "saldo antes"
-- (saldo - abono + cargo) de ningún otro renglón de ese día. Ese criterio se
-- usa primero, y created_at + orden_en_archivo quedan solo como desempate
-- (saldos repetidos, cadenas rotas por archivos incompletos).
create or replace view public.v_movimientos_cierre with (security_invoker = true) as
with base as (
  select m.id, m.cuenta_id, m.empresa_id, m.fecha_pago, m.saldo, m.created_at, m.orden_en_archivo,
    round(m.saldo - coalesce(m.abono_total, 0) + coalesce(m.cargo_total, 0), 2) as saldo_antes
  from public.movimientos m
)
select b.id, b.cuenta_id, b.empresa_id, b.fecha_pago, b.saldo, b.created_at, b.orden_en_archivo,
  not exists (
    select 1 from base s
    where s.cuenta_id = b.cuenta_id and s.fecha_pago = b.fecha_pago and s.id <> b.id and s.saldo_antes = b.saldo
  ) as es_cierre
from base b;

comment on view public.v_movimientos_cierre is 'movimientos + es_cierre: true cuando ningún otro renglón del mismo día de la misma cuenta arranca desde este saldo, es decir, es el último de la cadena de saldos de ese día.';

create or replace view public.v_saldo_cierre_cuenta with (security_invoker = true) as
select distinct on (cuenta_id) cuenta_id,
  empresa_id,
  fecha_pago as fecha_ultimo_movimiento,
  saldo as saldo_cierre
from public.v_movimientos_cierre
order by cuenta_id, fecha_pago desc, es_cierre desc, created_at desc, orden_en_archivo desc nulls last;

create or replace function public.fn_saldos_diario_cuenta(p_fecha date)
returns table (
  cuenta_id uuid, empresa_id uuid, empresa_nombre text, banco text, ultimos_4 text, alias text,
  saldo_inicial numeric, entradas numeric, salidas numeric, saldo_final numeric,
  ajuste_saldo numeric, ajuste_nota text, tiene_movimientos boolean
)
language sql stable as $$
  with previo as (
    select distinct on (m.cuenta_id) m.cuenta_id, m.saldo as saldo_previo
    from public.v_movimientos_cierre m
    where m.fecha_pago < p_fecha
    order by m.cuenta_id, m.fecha_pago desc, m.es_cierre desc, m.created_at desc, m.orden_en_archivo desc nulls last
  ),
  del_dia_cierre as (
    select distinct on (m.cuenta_id) m.cuenta_id, m.saldo as saldo_cierre_dia
    from public.v_movimientos_cierre m
    where m.fecha_pago = p_fecha
    order by m.cuenta_id, m.es_cierre desc, m.created_at desc, m.orden_en_archivo desc nulls last
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
