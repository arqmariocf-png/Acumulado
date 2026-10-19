-- Órdenes en efectivo que quedaban como transferencia (20-oct-2026, Laura:
-- "las órdenes de efectivo las está poniendo como transferencia al momento de
-- guardarlas"). Dos causas:
--   * El editor traía "Transferencia" de fábrica en Forma de pago (se corrige
--     en la pantalla: ahora hay que elegirla).
--   * Con Forma de pago = Efectivo y Condición = Contado, la orden no contaba
--     como efectivo: "Efectivo por confirmar" y los indicadores solo miraban la
--     forma de pago si la condición estaba vacía, y programar el pago la mandaba
--     como transferencia (IA-OS-0035, IA-OC-0007).
-- Ahora la forma de pago Efectivo manda: al guardar una OC/OS con Efectivo y
-- condición vacía o contado queda condición 'efectivo', y fn_oc_programar_pago
-- programa en efectivo (sin cuenta) cualquier OC cuya forma de pago sea
-- Efectivo. Reescritas por reemplazo sobre su definición vigente.
-- Ya aplicado en producción (oc_efectivo_por_forma_pago).

do $x$
declare d text; n text;
begin
  d := pg_get_functiondef('public.fn_orden_ia_guardar(uuid,text,uuid,text,text,date,jsonb,text,text,date,text,text)'::regprocedure);
  n := replace(d, $r$    raise exception 'Condición de pago inválida: %', v_cond;
  end if;
$r$, $r$    raise exception 'Condición de pago inválida: %', v_cond;
  end if;
  -- La forma de pago Efectivo manda sobre "contado" (20-oct-2026).
  if v_tipo <> 'OV' and p_forma_pago ilike 'efectivo%' and coalesce(v_cond, 'contado') = 'contado' then
    v_cond := 'efectivo';
  end if;
$r$);
  if n = d then raise exception 'fn_orden_ia_guardar no tenía la validación de condición esperada'; end if;
  execute n;

  d := pg_get_functiondef('public.fn_oc_programar_pago'::regproc);
  n := replace(d, $r$case when p_condicion = 'efectivo' then null else p_cuenta_id end$r$,
                  $r$case when p_condicion = 'efectivo' or v_oc.tipo_pago_backoffice ilike 'efectivo%' then null else p_cuenta_id end$r$);
  n := replace(n, $r$case when p_condicion = 'efectivo' then 'efectivo' else 'transferencia' end)$r$,
                  $r$case when p_condicion = 'efectivo' or v_oc.tipo_pago_backoffice ilike 'efectivo%' then 'efectivo' else 'transferencia' end)$r$);
  if n = d or position($r$v_oc.tipo_pago_backoffice ilike 'efectivo%' then 'efectivo'$r$ in n) = 0 then
    raise exception 'fn_oc_programar_pago no tenía el método de pago esperado';
  end if;
  execute n;
end $x$;

-- Las propias ya guardadas con Efectivo + contado y sin pago programado.
update public.ordenes_compra o
   set condicion_pago = 'efectivo'
 where o.fuente = 'acumulado'
   and o.tipo_pago_backoffice ilike 'efectivo%'
   and o.condicion_pago = 'contado'
   and not exists (select 1 from public.pagos_programados p where p.orden_compra_id = o.id);
