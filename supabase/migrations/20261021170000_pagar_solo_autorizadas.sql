-- Solo órdenes autorizadas se completan como pagadas (21-oct-2026, Laura:
-- "FLUJO COMPRAS - SERVICIOS: autorizar → programación a pago (finanzas) →
-- comprobante (tesorería) → almacén (recepción). Solo órdenes autorizadas se
-- pueden completar como pagadas").
--
-- * fn_oc_confirmar_pagadas ya no autoriza sola una OC pendiente: la rechaza
--   con el folio para que primero se autorice.
-- * Trigger pagos_programados_requiere_autorizada: con usuario, un pago ligado
--   a una OC no queda 'pagado' (alta o cambio) si la OC no está autorizada
--   (misma regla que v_oc_pagos.autorizacion: autorizada aquí, o del
--   backoffice que no esté "Pendiente de Autorización" ni cancelada; nunca
--   rechazada). Cubre la edge de comprobantes, Tesorería y cualquier update.
-- "Autorizar y programar" sigue igual: quien programa (dirección) autoriza.
-- Ya aplicado en producción (pagar_solo_autorizadas).

do $x$
declare
  d text := pg_get_functiondef('public.fn_oc_confirmar_pagadas'::regproc);
  n text;
begin
  n := replace(d,
    $v$    if v_oc.autorizada_en is null and not (v_oc.fuente = 'api' and coalesce(v_oc.estatus_backoffice, '') <> 'Pendiente de Autorización') then
      update public.ordenes_compra set autorizada_en = now(), autorizada_por = v_uid where id = v_oc.id;
    end if;$v$,
    $v$    if v_oc.autorizada_en is null and not (v_oc.fuente = 'api' and coalesce(v_oc.estatus_backoffice, '') <> 'Pendiente de Autorización') then
      raise exception 'La orden % no está autorizada: primero se autoriza y se programa a pago; solo las autorizadas se confirman como pagadas', v_oc.id_orden;
    end if;$v$);
  if n = d then
    raise exception 'fn_oc_confirmar_pagadas: no encontré el bloque de autorización automática';
  end if;
  execute n;
end $x$;

create or replace function public.pagos_programados_requiere_autorizada()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_oc public.ordenes_compra;
begin
  if auth.uid() is null or new.orden_compra_id is null or new.estatus <> 'pagado' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.estatus = 'pagado' then
    return new;
  end if;
  select * into v_oc from public.ordenes_compra where id = new.orden_compra_id;
  if v_oc.id is null then
    return new;
  end if;
  if v_oc.rechazada_en is not null or (v_oc.fuente = 'api' and v_oc.estatus_backoffice = 'Cancelada') then
    raise exception 'La orden % está rechazada o cancelada; no se puede marcar como pagada', v_oc.id_orden;
  end if;
  if v_oc.autorizada_en is null and not (v_oc.fuente = 'api' and coalesce(v_oc.estatus_backoffice, '') <> 'Pendiente de Autorización') then
    raise exception 'La orden % no está autorizada: solo las órdenes autorizadas se completan como pagadas', v_oc.id_orden;
  end if;
  return new;
end;
$$;

drop trigger if exists pagos_programados_requiere_autorizada on public.pagos_programados;
create trigger pagos_programados_requiere_autorizada before insert or update of estatus on public.pagos_programados
  for each row execute function public.pagos_programados_requiere_autorizada();
