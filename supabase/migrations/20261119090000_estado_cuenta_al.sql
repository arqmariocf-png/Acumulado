-- Hasta qué fecha está al día cada cuenta (19-nov-2026, Mario: "Mallas y
-- Clavos sigue sin actualizarse el saldo en finanzas"). Delia subió seis
-- veces los estados "al 17 de noviembre" de MCC (BBVA 6381 y BanBajío 9403)
-- y ninguno traía movimientos después del 13-nov (14-15 fin de semana, 16
-- festivo): la carga guardaba 0 renglones nuevos y la fecha del saldo
-- (último movimiento) se quedaba en el 13/11, así que la hoja de pagos decía
-- "falta subir lo más reciente" y el KPI de cuentas sin movimientos la
-- marcaba, aunque el saldo era el correcto y ya estaba subido.
--   · cuentas_bancarias.estado_cuenta_al = fecha hasta la que llega el último
--     estado de cuenta cargado (la lee la ingesta del propio PDF: fin de
--     periodo, fecha de corte o de generación; si no la trae, el último
--     movimiento del archivo). estado_cuenta_subido_en = cuándo se subió.
--   · fn_cuenta_registrar_estado_cuenta (solo service_role; la llama la edge
--     ingesta-estado-cuenta v25).
--   · fn_cuentas_estado_cuenta_al(fecha): por cuenta, último movimiento y
--     "al día hasta" = el mayor entre ese y estado_cuenta_al (≤ fecha). La
--     hoja de pagos y Saldos por empresa lo usan en vez de fn_saldos_fecha_cuenta.
--   · v_saldo_cierre_cuenta.fecha_ultimo_movimiento considera también
--     estado_cuenta_al (KPI "cuentas sin movimientos recientes").

alter table public.cuentas_bancarias
  add column if not exists estado_cuenta_al date,
  add column if not exists estado_cuenta_subido_en timestamptz;

comment on column public.cuentas_bancarias.estado_cuenta_al is 'Fecha hasta la que llega el último estado de cuenta cargado (aunque no traiga movimientos nuevos); la pone la ingesta.';

create or replace function public.fn_cuenta_registrar_estado_cuenta(p_cuenta_id uuid, p_al date)
returns void language sql security definer set search_path = public as $$
  update public.cuentas_bancarias
     set estado_cuenta_al = greatest(coalesce(estado_cuenta_al, p_al), p_al),
         estado_cuenta_subido_en = now()
   where id = p_cuenta_id and p_al is not null;
$$;
revoke all on function public.fn_cuenta_registrar_estado_cuenta(uuid, date) from public, anon, authenticated;
grant execute on function public.fn_cuenta_registrar_estado_cuenta(uuid, date) to service_role;

create or replace function public.fn_cuentas_estado_cuenta_al(p_fecha date)
returns table(cuenta_id uuid, ultimo_movimiento date, estado_cuenta_al date)
language sql stable set search_path = public as $$
  select c.id,
         m.ultimo,
         greatest(m.ultimo, case when c.estado_cuenta_al <= p_fecha then c.estado_cuenta_al end)
    from public.cuentas_bancarias c
    left join lateral (
      select max(mv.fecha_pago) as ultimo from public.movimientos mv where mv.cuenta_id = c.id and mv.fecha_pago <= p_fecha
    ) m on true
   where c.activo
$$;
grant execute on function public.fn_cuentas_estado_cuenta_al(date) to authenticated;

create or replace view public.v_saldo_cierre_cuenta with (security_invoker = true) as
select distinct on (m.cuenta_id)
       m.cuenta_id,
       m.empresa_id,
       greatest(m.fecha_pago, c.estado_cuenta_al) as fecha_ultimo_movimiento,
       m.saldo as saldo_cierre
  from public.v_movimientos_cierre m
  join public.cuentas_bancarias c on c.id = m.cuenta_id
 order by m.cuenta_id, m.fecha_pago desc, m.cuadra_previo desc, m.es_cierre desc, m.created_at desc, m.orden_en_archivo desc nulls last;
