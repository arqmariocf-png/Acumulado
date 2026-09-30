-- No programar dos veces el mismo saldo (Mario, 30-sep-2026: "le picamos 3
-- veces y se cargó tres veces"; la 41074 de TUDOGAR quedó con 3 pagos de
-- $2,383.40). fn_oc_programar_pago descuenta lo ya programado (pendiente)
-- del saldo y bloquea la OC (for update) para que clics simultáneos no
-- pasen los dos. Se borraron los 2 pagos repetidos de la 41074 (pendientes,
-- sin comprobante), ya aplicado en producción.

create or replace function public.fn_oc_programar_pago(p_oc_id uuid, p_condicion text, p_monto numeric default null, p_fecha date default null, p_cuenta_id uuid default null, p_notas text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_oc public.ordenes_compra%rowtype;
  v_pagado numeric;
  v_programado numeric;
  v_saldo numeric;
  v_monto numeric;
  v_fecha date;
  v_dias int;
  v_pago uuid;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then raise exception 'Solo dirección programa pagos' using errcode = '42501'; end if;
  if p_condicion not in ('contado', 'credito', 'anticipo', 'efectivo') then raise exception 'Condición no válida: %', p_condicion; end if;
  -- for update: dos clics casi al mismo tiempo esperan en fila y el
  -- segundo ya ve el pago del primero.
  select * into v_oc from public.ordenes_compra where id = p_oc_id for update;
  if v_oc.id is null then raise exception 'Orden no encontrada'; end if;
  if not public.empresa_en_alcance(v_oc.empresa_id) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  if v_oc.rechazada_en is not null then raise exception 'La orden % está rechazada; no se programa pago', v_oc.id_orden; end if;
  if v_oc.fuente = 'api' and v_oc.estatus_backoffice = 'Cancelada' then raise exception 'La orden % está cancelada en el backoffice', v_oc.id_orden; end if;
  -- Programar el pago de una orden pendiente la autoriza internamente
  -- (Mario, 30-sep-2026: "que no pare el flujo"; no depender del backoffice).
  if v_oc.autorizada_en is null and not (v_oc.fuente = 'api' and coalesce(v_oc.estatus_backoffice, '') <> 'Pendiente de Autorización') then
    update public.ordenes_compra set autorizada_en = now(), autorizada_por = v_uid, rechazada_en = null, rechazada_por = null, rechazo_motivo = null where id = p_oc_id;
    insert into public.requisicion_etapas (requisicion_id, etapa, etapa_anterior, actor_id, actor_nombre, nota)
      select distinct req.id, 'autorizada', 'solicitada', v_uid, (select nombre from public.profiles where id = v_uid), 'Orden ' || v_oc.id_orden || ' autorizada al programar su pago'
      from public.necesidades_compra nc
      join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
      join public.requisiciones req on req.id = rl.requisicion_id
      where nc.orden_compra_id = p_oc_id and req.etapa = 'solicitada';
    update public.requisiciones req set etapa = 'autorizada', etapa_en = now(), etapa_por = v_uid
      where req.etapa = 'solicitada' and req.id in (
        select rl.requisicion_id from public.necesidades_compra nc join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id where nc.orden_compra_id = p_oc_id);
  end if;
  -- Lo ya programado (pendiente) cuenta: no se programa dos veces el mismo
  -- saldo (Mario, 30-sep-2026: "le picamos 3 veces y se cargó tres veces").
  select coalesce(sum(monto) filter (where estatus = 'pagado'), 0), coalesce(sum(monto) filter (where estatus = 'pendiente'), 0)
    into v_pagado, v_programado
    from public.pagos_programados where orden_compra_id = p_oc_id;
  v_saldo := coalesce(v_oc.total, 0) - v_pagado - v_programado;
  if v_saldo <= 0.01 and v_programado > 0 then
    raise exception 'La orden % ya tiene programado todo su saldo (%); no se vuelve a programar', v_oc.id_orden, round(v_programado, 2);
  end if;
  v_monto := coalesce(p_monto, v_saldo);
  if v_monto <= 0 then raise exception 'La orden no tiene saldo pendiente'; end if;
  if v_monto > v_saldo + 0.01 then
    raise exception 'El monto (%) rebasa lo que falta por programar de la orden % (%; ya programado %)', v_monto, v_oc.id_orden, round(v_saldo, 2), round(v_programado, 2);
  end if;
  select dias_credito into v_dias from public.proveedores_credito where clave = public.fn_proveedor_clave(v_oc.proveedor);
  v_fecha := coalesce(p_fecha, case when p_condicion = 'credito' then coalesce(v_oc.fecha_creacion, v_oc.created_at::date, current_date) + coalesce(v_dias, 30) else current_date end);
  if v_fecha < current_date then v_fecha := current_date; end if;

  update public.ordenes_compra set condicion_pago = p_condicion, condicion_por = v_uid, condicion_en = now() where id = p_oc_id;
  insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, referencia, notas, created_by, orden_compra_id, metodo)
  values (v_oc.empresa_id, case when p_condicion = 'efectivo' then null else p_cuenta_id end, coalesce(v_oc.proveedor, 'Proveedor'),
    case p_condicion when 'anticipo' then 'Anticipo OC ' when 'efectivo' then 'Efectivo OC ' else 'OC ' end || v_oc.id_orden || coalesce(' · ' || v_oc.proyecto, ''),
    round(v_monto, 2), v_fecha, v_oc.id_orden, nullif(trim(coalesce(p_notas, '')), ''), v_uid, p_oc_id,
    case when p_condicion = 'efectivo' then 'efectivo' else 'transferencia' end)
  returning id into v_pago;
  if v_oc.fuente = 'requisicion' and v_oc.pago_programado_id is null then
    update public.ordenes_compra set pago_programado_id = v_pago where id = p_oc_id;
  end if;
  return v_pago;
end;
$function$;
