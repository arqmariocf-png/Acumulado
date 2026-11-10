-- La condición "efectivo" se quedaba pegada al cambiar la forma de pago
-- (10-nov-2026, Laura: "sí la edité, pero no está contemplando los cambios;
-- los deja dos veces"). La IA-OS-0431 (CSC, Forza Gas $1,500) se capturó con
-- forma Efectivo (la pantalla pone condición 'efectivo' sola), Laura la editó
-- a Transferencia y la condición siguió en 'efectivo': la OS impresa decía
-- "Efectivo · Transferencia electrónica de fondos" y al programarla el pago
-- salió en efectivo (no lo ve tesorería). La pantalla solo ponía la condición,
-- nunca la quitaba, y fn_orden_ia_guardar tampoco.
--
-- Ahora, en OC/OS, si la forma de pago no es Efectivo y la condición venía
-- 'efectivo', la condición se limpia (la define dirección al programar).
-- Ya aplicado en producción (condicion_efectivo_se_quita_al_cambiar_forma).

do $x$
declare d text; n text;
begin
  d := pg_get_functiondef('public.fn_orden_ia_guardar(uuid,text,uuid,text,text,date,jsonb,text,text,date,text,text)'::regprocedure);
  n := replace(d, $r$  if v_tipo <> 'OV' and p_forma_pago ilike 'efectivo%' and coalesce(v_cond, 'contado') = 'contado' then
    v_cond := 'efectivo';
  end if;
$r$, $r$  if v_tipo <> 'OV' and p_forma_pago ilike 'efectivo%' and coalesce(v_cond, 'contado') = 'contado' then
    v_cond := 'efectivo';
  end if;
  -- Y al revés: si la forma ya no es Efectivo, la condición 'efectivo' sobra (10-nov-2026).
  if v_tipo <> 'OV' and p_forma_pago is not null and p_forma_pago not ilike 'efectivo%' and v_cond = 'efectivo' then
    v_cond := null;
  end if;
$r$);
  if n = d then raise exception 'fn_orden_ia_guardar no tenía el bloque de efectivo esperado'; end if;
  execute n;
end $x$;
