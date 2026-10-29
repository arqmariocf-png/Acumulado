-- Hoja de pagos con el estado de cuenta del mismo día (29-oct-2026, Laura:
-- "no me actualiza los saldos en programación de pagos, aunque ya se subió
-- el estado de cuenta"). Subió el de hoy de BBVA 5859 (AEP) con un depósito
-- de $1,000,000 y la hoja seguía en $6,255.61: el saldo inicial tomaba el
-- último movimiento ANTERIOR al día. Ahora esta función devuelve el último
-- movimiento cargado hasta el día de la hoja inclusive; con eso la pantalla
-- sabe que el estado de cuenta ya llega a ese día y usa el saldo del día
-- (saldo_final de fn_saldos_diario_cuenta) sin volver a restar lo ya pagado.
-- Corre con la RLS de quien consulta (movimientos). Ya aplicado en producción.

create or replace function public.fn_saldos_fecha_cuenta(p_fecha date)
returns table (cuenta_id uuid, ultimo_movimiento date)
language sql stable set search_path = public as $$
  select m.cuenta_id, max(m.fecha_pago)
    from public.movimientos m
   where m.fecha_pago <= p_fecha
   group by m.cuenta_id
$$;
grant execute on function public.fn_saldos_fecha_cuenta(date) to authenticated;
