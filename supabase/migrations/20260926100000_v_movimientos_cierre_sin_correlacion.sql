-- 26-sep-2026: v_movimientos_cierre calculaba es_cierre con un NOT EXISTS
-- correlacionado por movimiento (cuadrático): 0.45 s sin RLS y 4 s con RLS
-- para 2,000 movimientos; es la base de v_saldo_cierre_cuenta, del PDF de
-- saldos diarios y de los KPIs de finanzas, y disparaba "statement timeout".
-- Misma regla (un movimiento es cierre del día cuando ningún otro del mismo
-- día y cuenta arranca en su saldo), ahora como hash join. Verificado
-- fila por fila contra la fórmula anterior: 0 diferencias en 2,001
-- movimientos. Ya aplicado en producción.

create or replace view public.v_movimientos_cierre with (security_invoker = true) as
with base as (
  select m.id,
         m.cuenta_id,
         m.empresa_id,
         m.fecha_pago,
         m.saldo,
         m.created_at,
         m.orden_en_archivo,
         coalesce(m.abono_total, 0::numeric) as abono,
         coalesce(m.cargo_total, 0::numeric) as cargo,
         round(m.saldo - coalesce(m.abono_total, 0::numeric) + coalesce(m.cargo_total, 0::numeric), 2) as saldo_antes
  from public.movimientos m
),
arranques as (
  select cuenta_id, fecha_pago, saldo_antes, count(*) as n, (array_agg(id))[1] as unico_id
  from base
  group by cuenta_id, fecha_pago, saldo_antes
),
cadena as (
  select b.id,
         b.cuenta_id,
         b.empresa_id,
         b.fecha_pago,
         b.saldo,
         b.created_at,
         b.orden_en_archivo,
         b.abono,
         b.cargo,
         b.saldo_antes,
         (a.cuenta_id is null or (a.n = 1 and a.unico_id = b.id)) as es_cierre
  from base b
  left join arranques a
    on a.cuenta_id = b.cuenta_id and a.fecha_pago = b.fecha_pago and a.saldo_antes = b.saldo
),
dia as (
  select c_1.cuenta_id,
         c_1.fecha_pago,
         round(sum(c_1.abono) - sum(c_1.cargo), 2) as neto,
         (array_agg(c_1.saldo order by c_1.es_cierre desc, c_1.created_at desc, c_1.orden_en_archivo desc nulls last))[1] as cierre_cadena
  from cadena c_1
  group by c_1.cuenta_id, c_1.fecha_pago
),
dia_previo as (
  select d.cuenta_id,
         d.fecha_pago,
         d.neto,
         lag(d.cierre_cadena) over (partition by d.cuenta_id order by d.fecha_pago) as cierre_previo
  from dia d
)
select c.id,
       c.cuenta_id,
       c.empresa_id,
       c.fecha_pago,
       c.saldo,
       c.created_at,
       c.orden_en_archivo,
       c.es_cierre,
       (p.cierre_previo is not null and c.saldo = round(p.cierre_previo + p.neto, 2)) as cuadra_previo
from cadena c
join dia_previo p on p.cuenta_id = c.cuenta_id and p.fecha_pago = c.fecha_pago;
