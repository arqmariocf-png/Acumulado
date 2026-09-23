-- Caso real 21-sep-2026 (Delia, cuenta BBVA 9954 de Constructora): el 18-sep
-- hubo un cargo de $15,000 y un abono de $15,000 el mismo día. La regla de
-- cadena (20260918100000) no puede decidir cuál va al final: cada renglón
-- "arranca" desde el saldo del otro (ciclo), ninguno queda como cierre y el
-- desempate por orden de archivo eligió el abono ($17,086.14) cuando el
-- banco cerró en $2,086.14.
--
-- Segundo criterio, aritmético: el cierre de un día tiene que ser igual al
-- cierre del día anterior + abonos - cargos de ese día. Cuando el día está
-- completo, ese renglón es único aunque los importes se repitan. Si no
-- cuadra ninguno (archivo incompleto, día anterior sin cargar), se cae a la
-- cadena y luego al orden de carga, como hasta ahora.
create or replace view public.v_movimientos_cierre with (security_invoker = true) as
with base as (
  select m.id, m.cuenta_id, m.empresa_id, m.fecha_pago, m.saldo, m.created_at, m.orden_en_archivo,
    coalesce(m.abono_total, 0) as abono, coalesce(m.cargo_total, 0) as cargo,
    round(m.saldo - coalesce(m.abono_total, 0) + coalesce(m.cargo_total, 0), 2) as saldo_antes
  from public.movimientos m
),
cadena as (
  select b.*,
    not exists (
      select 1 from base s
      where s.cuenta_id = b.cuenta_id and s.fecha_pago = b.fecha_pago and s.id <> b.id and s.saldo_antes = b.saldo
    ) as es_cierre
  from base b
),
dia as (
  select c.cuenta_id, c.fecha_pago,
    round(sum(c.abono) - sum(c.cargo), 2) as neto,
    (array_agg(c.saldo order by c.es_cierre desc, c.created_at desc, c.orden_en_archivo desc nulls last))[1] as cierre_cadena
  from cadena c
  group by c.cuenta_id, c.fecha_pago
),
dia_previo as (
  select d.cuenta_id, d.fecha_pago, d.neto,
    lag(d.cierre_cadena) over (partition by d.cuenta_id order by d.fecha_pago) as cierre_previo
  from dia d
)
select c.id, c.cuenta_id, c.empresa_id, c.fecha_pago, c.saldo, c.created_at, c.orden_en_archivo, c.es_cierre,
  (p.cierre_previo is not null and c.saldo = round(p.cierre_previo + p.neto, 2)) as cuadra_previo
from cadena c
join dia_previo p on p.cuenta_id = c.cuenta_id and p.fecha_pago = c.fecha_pago;

comment on view public.v_movimientos_cierre is 'movimientos + es_cierre (último de la cadena de saldos del día) + cuadra_previo (su saldo = cierre del día anterior + abonos - cargos del día). Prioridad para elegir el cierre: cuadra_previo, es_cierre, created_at, orden_en_archivo.';

create or replace view public.v_saldo_cierre_cuenta with (security_invoker = true) as
select distinct on (cuenta_id) cuenta_id,
  empresa_id,
  fecha_pago as fecha_ultimo_movimiento,
  saldo as saldo_cierre
from public.v_movimientos_cierre
order by cuenta_id, fecha_pago desc, cuadra_previo desc, es_cierre desc, created_at desc, orden_en_archivo desc nulls last;

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
    order by m.cuenta_id, m.fecha_pago desc, m.cuadra_previo desc, m.es_cierre desc, m.created_at desc, m.orden_en_archivo desc nulls last
  ),
  del_dia_cierre as (
    select distinct on (m.cuenta_id) m.cuenta_id, m.saldo as saldo_cierre_dia
    from public.v_movimientos_cierre m
    where m.fecha_pago = p_fecha
    order by m.cuenta_id, m.cuadra_previo desc, m.es_cierre desc, m.created_at desc, m.orden_en_archivo desc nulls last
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
