-- Autorización como factor de pago y vencimiento de crédito por OC (Mario,
-- 29-sep-2026): "aunque suban la OC, si no se autoriza no se va a pago".
-- - Estado de autorización de TODA OC (`v_oc_pagos.autorizacion`): las del
--   backoffice (api) llegan ya autorizadas; las de Excel y las RQ quedan
--   'pendiente' hasta que dirección las autorice (o 'rechazada').
-- - `fn_oc_autorizar` acepta también fuente 'excel' (autoriza sin crear
--   pago; el rechazo se guarda con motivo en vez de borrar la OC).
-- - `fn_oc_programar_pago` exige OC autorizada.
-- - `v_oc_pagos.vence`: fecha OC + días de crédito del proveedor, para las
--   OC a crédito y para las sin condición cuyo proveedor tiene línea
--   (`es_credito`). El `vencimiento` de proveedores_credito es de la LÍNEA,
--   no de la OC. Ya aplicado en producción.

alter table public.ordenes_compra
  add column if not exists rechazada_en timestamptz,
  add column if not exists rechazada_por uuid references public.profiles (id),
  add column if not exists rechazo_motivo text;

create or replace view public.v_oc_pagos with (security_invoker = true) as
select oc.id, oc.id_orden, oc.empresa_id, oc.proveedor, oc.proyecto, oc.total, oc.fecha_creacion, oc.fuente,
       oc.condicion_pago, oc.autorizada_en,
       coalesce(pg.pagado, 0) as pagado,
       coalesce(pg.programado, 0) as programado,
       coalesce(oc.total, 0) - coalesce(pg.pagado, 0) as saldo,
       pg.ultimo_pago, pg.proximo_pago,
       cr.clave as proveedor_clave, cr.linea_credito, cr.dias_credito, cr.vencimiento as credito_vencimiento,
       case when oc.rechazada_en is not null then 'rechazada'
            when oc.fuente = 'api' or oc.autorizada_en is not null then 'autorizada'
            else 'pendiente' end as autorizacion,
       -- Vence = fecha de la OC + días de crédito del proveedor. Aplica a las
       -- OC a crédito y a las que aún no tienen condición pero cuyo proveedor
       -- tiene línea (Laura, 29-sep-2026: la 41007 de Cruz Azul, 25-sep + 15
       -- días, debe vencer el 10-oct). Contado/anticipo: sin vencimiento.
       case when oc.condicion_pago = 'credito' or (oc.condicion_pago is null and cr.dias_credito is not null)
            then coalesce(oc.fecha_creacion, oc.created_at::date) + coalesce(cr.dias_credito, 30) end as vence,
       (oc.condicion_pago = 'credito' or (oc.condicion_pago is null and cr.dias_credito is not null)) as es_credito,
       oc.rechazo_motivo
from public.ordenes_compra oc
left join lateral (
  select sum(p.monto) filter (where p.estatus = 'pagado') as pagado,
         sum(p.monto) filter (where p.estatus = 'pendiente') as programado,
         max(p.pagado_en) filter (where p.estatus = 'pagado') as ultimo_pago,
         min(p.fecha_programada) filter (where p.estatus = 'pendiente') as proximo_pago
  from public.pagos_programados p where p.orden_compra_id = oc.id
) pg on true
left join public.proveedores_credito cr on cr.clave = public.fn_proveedor_clave(oc.proveedor);

create or replace function public.fn_oc_autorizar(p_oc_id uuid, p_autorizar boolean, p_motivo text default null, p_fecha_pago date default null, p_cuenta_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_oc public.ordenes_compra%rowtype;
  v_pago uuid;
  r record;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then
    raise exception 'Solo dirección autoriza órdenes de compra' using errcode = '42501';
  end if;
  select * into v_oc from public.ordenes_compra where id = p_oc_id;
  if v_oc.id is null then raise exception 'Orden no encontrada'; end if;
  if v_oc.fuente = 'api' then raise exception 'Las órdenes del backoffice llegan ya autorizadas'; end if;
  if not public.empresa_en_alcance(v_oc.empresa_id) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  if v_oc.autorizada_en is not null then raise exception 'Esta orden ya fue autorizada'; end if;

  if p_autorizar then
    if v_oc.fuente = 'requisicion' then
      insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, referencia, notas, created_by, orden_compra_id)
      values (v_oc.empresa_id, p_cuenta_id, coalesce(v_oc.proveedor, 'Proveedor'),
        'OC ' || v_oc.id_orden || coalesce(' · ' || v_oc.proyecto, ''), coalesce(v_oc.total, 0),
        coalesce(p_fecha_pago, current_date + 7), v_oc.id_orden, 'Generado al autorizar la orden ' || v_oc.id_orden, v_uid, p_oc_id)
      returning id into v_pago;
    end if;
    update public.ordenes_compra set autorizada_en = now(), autorizada_por = v_uid, rechazada_en = null, rechazada_por = null, rechazo_motivo = null,
      pago_programado_id = coalesce(v_pago, pago_programado_id),
      condicion_pago = coalesce(condicion_pago, 'contado'), condicion_por = coalesce(condicion_por, v_uid), condicion_en = coalesce(condicion_en, now())
      where id = p_oc_id;
    for r in
      select distinct req.id, req.etapa
      from public.necesidades_compra nc
      join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
      join public.requisiciones req on req.id = rl.requisicion_id
      where nc.orden_compra_id = p_oc_id
    loop
      if r.etapa = 'solicitada' then
        update public.requisiciones set etapa = 'autorizada', etapa_en = now(), etapa_por = v_uid where id = r.id;
        insert into public.requisicion_etapas (requisicion_id, etapa, etapa_anterior, actor_id, actor_nombre, nota)
        values (r.id, 'autorizada', 'solicitada', v_uid, (select nombre from public.profiles where id = v_uid), 'Orden ' || v_oc.id_orden || ' autorizada');
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'pago_programado_id', v_pago);
  elsif v_oc.fuente = 'requisicion' then
    -- Rechazo de una OC RQ: se borra y las necesidades vuelven a almacén.
    update public.necesidades_compra
      set estado = 'pendiente', orden_compra_id = null, vinculado_por = null, vinculado_at = null,
          cotizacion_nota = concat_ws(' · ', nullif(cotizacion_nota, ''), 'Rechazada por dirección: ' || coalesce(nullif(trim(p_motivo), ''), 'sin motivo'))
      where orden_compra_id = p_oc_id;
    delete from public.pagos_programados where orden_compra_id = p_oc_id and estatus = 'pendiente';
    delete from public.ordenes_compra_lineas where orden_compra_id = p_oc_id;
    delete from public.ordenes_compra where id = p_oc_id;
    return jsonb_build_object('ok', true, 'rechazada', true);
  else
    -- Rechazo de una OC cargada a mano (Excel): queda registrada con motivo y no se paga.
    update public.ordenes_compra set rechazada_en = now(), rechazada_por = v_uid, rechazo_motivo = nullif(trim(coalesce(p_motivo, '')), '') where id = p_oc_id;
    delete from public.pagos_programados where orden_compra_id = p_oc_id and estatus = 'pendiente';
    return jsonb_build_object('ok', true, 'rechazada', true);
  end if;
end;
$$;

create or replace function public.fn_oc_programar_pago(p_oc_id uuid, p_condicion text, p_monto numeric default null, p_fecha date default null, p_cuenta_id uuid default null, p_notas text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_oc public.ordenes_compra%rowtype;
  v_pagado numeric;
  v_saldo numeric;
  v_monto numeric;
  v_fecha date;
  v_dias int;
  v_pago uuid;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then raise exception 'Solo dirección programa pagos' using errcode = '42501'; end if;
  if p_condicion not in ('contado', 'credito', 'anticipo') then raise exception 'Condición no válida: %', p_condicion; end if;
  select * into v_oc from public.ordenes_compra where id = p_oc_id;
  if v_oc.id is null then raise exception 'Orden no encontrada'; end if;
  if not public.empresa_en_alcance(v_oc.empresa_id) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  if v_oc.rechazada_en is not null then raise exception 'La orden % está rechazada; no se programa pago', v_oc.id_orden; end if;
  if v_oc.fuente <> 'api' and v_oc.autorizada_en is null then raise exception 'La orden % está pendiente de autorización; autorízala primero', v_oc.id_orden; end if;
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_programados where orden_compra_id = p_oc_id and estatus = 'pagado';
  v_saldo := coalesce(v_oc.total, 0) - v_pagado;
  v_monto := coalesce(p_monto, v_saldo);
  if v_monto <= 0 then raise exception 'La orden no tiene saldo pendiente'; end if;
  if v_monto > v_saldo + 0.01 then raise exception 'El monto (%) rebasa el saldo pendiente de la orden (%)', v_monto, v_saldo; end if;
  select dias_credito into v_dias from public.proveedores_credito where clave = public.fn_proveedor_clave(v_oc.proveedor);
  -- Misma base que v_oc_pagos.vence: fecha de la OC, o la de carga si no trae.
  v_fecha := coalesce(p_fecha, case when p_condicion = 'credito' then coalesce(v_oc.fecha_creacion, v_oc.created_at::date, current_date) + coalesce(v_dias, 30) else current_date end);
  if v_fecha < current_date then v_fecha := current_date; end if;

  update public.ordenes_compra set condicion_pago = p_condicion, condicion_por = v_uid, condicion_en = now() where id = p_oc_id;
  insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, referencia, notas, created_by, orden_compra_id)
  values (v_oc.empresa_id, p_cuenta_id, coalesce(v_oc.proveedor, 'Proveedor'),
    case p_condicion when 'anticipo' then 'Anticipo OC ' else 'OC ' end || v_oc.id_orden || coalesce(' · ' || v_oc.proyecto, ''),
    round(v_monto, 2), v_fecha, v_oc.id_orden, nullif(trim(coalesce(p_notas, '')), ''), v_uid, p_oc_id)
  returning id into v_pago;
  if v_oc.fuente = 'requisicion' and v_oc.pago_programado_id is null then
    update public.ordenes_compra set pago_programado_id = v_pago where id = p_oc_id;
  end if;
  return v_pago;
end;
$$;
