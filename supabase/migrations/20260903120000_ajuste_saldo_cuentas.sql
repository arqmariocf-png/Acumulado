-- Ajuste de saldo manual por cuenta bancaria (pestaña "Saldos"): a veces el
-- saldo que arrastra el sistema (calculado 100% de los estados de cuenta
-- cargados) no coincide con el saldo real del banco -- por ejemplo, por
-- movimientos de meses anteriores a que existiera el sistema que nunca se
-- cargaron. Caso real (3-sep-2026): Aceros cuenta BBVA 5859 y Constructora
-- cuentas BanBajío 8954 / BBVA 4940 / BBVA 9954, todas con una diferencia
-- contra el saldo real del banco.
--
-- En vez de tener que reinvestigar el origen de la diferencia cada vez que
-- se revisa el reporte, se guarda como un ajuste FIJO por cuenta (no se
-- recalcula solo, no cambia hasta que alguien lo edite a mano en Admin ->
-- Cuentas) con una nota de dónde viene -- ver reporte-saldos-diario y
-- _shared/reportes/saldos.ts, que lo muestran junto al saldo de cada cuenta.
alter table public.cuentas_bancarias
  add column ajuste_saldo numeric(14, 2) not null default 0,
  add column ajuste_nota text;

comment on column public.cuentas_bancarias.ajuste_saldo is 'Corrección manual fija que se suma al saldo calculado del sistema para llegar al saldo real del banco (puede ser negativa). Editable solo por admin en Admin -> Cuentas.';
comment on column public.cuentas_bancarias.ajuste_nota is 'De dónde viene el ajuste (ej. "comisión no capturada, jul-ago 2026") -- para no tener que reinvestigarlo cada vez que se revisa el reporte.';

-- fn_saldos_diario_cuenta ahora también expone el ajuste guardado, para que
-- el PDF de saldos lo muestre junto al saldo de cada cuenta sin que el
-- cliente tenga que hacer una consulta aparte. Cambia el RETURNS TABLE, así
-- que hay que hacer drop + create en vez de create or replace.
drop function public.fn_saldos_diario_cuenta(date);

create function public.fn_saldos_diario_cuenta(p_fecha date)
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
  ajuste_saldo numeric,
  ajuste_nota text,
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

grant execute on function public.fn_saldos_diario_cuenta(date) to authenticated;
