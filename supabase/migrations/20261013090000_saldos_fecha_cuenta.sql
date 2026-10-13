-- Fecha del estado de cuenta del que sale el saldo de cada cuenta (13-oct-2026,
-- Laura: "sigue sin actualizarse aunque dice ya está actualizado"). El saldo
-- inicial de la hoja de pagos es el del último movimiento cargado antes del
-- día; si el estado de cuenta no se ha subido, el saldo se ve "congelado".
-- Con esta fecha la hoja dice "estado de cuenta al dd/mm" y avisa en ámbar.
-- Corre con la RLS de quien consulta (movimientos). Ya aplicado en producción.

create or replace function public.fn_saldos_fecha_cuenta(p_fecha date)
returns table (cuenta_id uuid, ultimo_movimiento date)
language sql stable set search_path = public as $$
  select m.cuenta_id, max(m.fecha_pago)
    from public.movimientos m
   where m.fecha_pago < p_fecha
   group by m.cuenta_id
$$;
grant execute on function public.fn_saldos_fecha_cuenta(date) to authenticated;
