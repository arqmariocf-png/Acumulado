-- Compra en un solo paso y autorización de dirección (Mario, 28-sep-2026):
-- 1. Alma, desde el renglón de la requisición, captura proveedor, costo y
--    cotización y genera la OC RQ de una vez (fn_oc_desde_lineas crea la
--    necesidad de compra y la orden en la misma transacción).
-- 2. La OC RQ le llega a Laura (dirección) a su flujo: "Órdenes por
--    autorizar" en Saldos por empresa y KPI fin_oc_por_autorizar. Al
--    autorizar (fn_oc_autorizar) se programa el pago en pagos_programados y
--    la requisición pasa a etapa 'autorizada'; al rechazar, la OC se borra y
--    las necesidades regresan a 'pendiente' para recotizar.
-- Ya aplicado en producción.

alter table public.ordenes_compra
  add column if not exists creada_por uuid references public.profiles (id),
  add column if not exists autorizada_en timestamptz,
  add column if not exists autorizada_por uuid references public.profiles (id),
  add column if not exists pago_programado_id uuid references public.pagos_programados (id) on delete set null;

-- Un solo paso: por renglón, cantidad a comprar + costo unitario. Crea la
-- necesidad de compra (con la cotización) y la OC.
create or replace function public.fn_oc_desde_lineas(p_lineas jsonb, p_proveedor text, p_fecha date default current_date, p_iva boolean default true, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  l jsonb;
  v_nec uuid;
  v_necs uuid[] := '{}';
  v_para_oc jsonb := '[]'::jsonb;
  v_res jsonb;
begin
  if v_rol not in ('admin', 'corporativo', 'almacen') then
    raise exception 'Tu rol (%) no genera órdenes de compra', v_rol using errcode = '42501';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Elige al menos un renglón';
  end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    if coalesce((l->>'cantidad')::numeric, 0) <= 0 then raise exception 'La cantidad a comprar debe ser mayor a cero'; end if;
    insert into public.necesidades_compra (requisicion_linea_id, cantidad, proveedor_sugerido, resuelto_por,
      cotizacion_proveedor, cotizacion_costo_unitario, cotizacion_nota, cotizacion_en, cotizacion_por)
    values ((l->>'linea_id')::uuid, (l->>'cantidad')::numeric, trim(p_proveedor), v_uid,
      trim(p_proveedor), nullif(l->>'costo', '')::numeric, nullif(trim(coalesce(p_nota, '')), ''), now(), v_uid)
    returning id into v_nec;
    v_necs := v_necs || v_nec;
    v_para_oc := v_para_oc || jsonb_build_object('necesidad_id', v_nec, 'costo', nullif(l->>'costo', '')::numeric);
  end loop;
  v_res := public.fn_oc_desde_necesidades(v_para_oc, p_proveedor, p_fecha, p_iva);
  update public.ordenes_compra set creada_por = v_uid where id = (v_res->>'id')::uuid;
  return v_res || jsonb_build_object('necesidad_ids', to_jsonb(v_necs));
end;
$$;
grant execute on function public.fn_oc_desde_lineas(jsonb, text, date, boolean, text) to authenticated;

-- Dirección autoriza o rechaza la OC RQ.
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
  if v_oc.fuente <> 'requisicion' then raise exception 'Solo se autorizan aquí las órdenes generadas desde requisiciones'; end if;
  if not public.empresa_en_alcance(v_oc.empresa_id) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  if v_oc.autorizada_en is not null then raise exception 'Esta orden ya fue autorizada'; end if;

  if p_autorizar then
    insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, notas, created_by)
    values (v_oc.empresa_id, p_cuenta_id, coalesce(v_oc.proveedor, 'Proveedor'),
      'OC ' || v_oc.id_orden || coalesce(' · ' || v_oc.proyecto, ''), coalesce(v_oc.total, 0),
      coalesce(p_fecha_pago, current_date + 7), 'Generado al autorizar la orden ' || v_oc.id_orden, v_uid)
    returning id into v_pago;
    update public.ordenes_compra set autorizada_en = now(), autorizada_por = v_uid, pago_programado_id = v_pago where id = p_oc_id;
    -- La requisición avanza a 'autorizada' (semáforo de requerimientos).
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
  else
    -- Rechazo: la orden se borra y las necesidades vuelven a pendiente
    -- para que almacén recotice; queda el motivo en la bitácora.
    update public.necesidades_compra
      set estado = 'pendiente', orden_compra_id = null, vinculado_por = null, vinculado_at = null,
          cotizacion_nota = concat_ws(' · ', nullif(cotizacion_nota, ''), 'Rechazada por dirección: ' || coalesce(nullif(trim(p_motivo), ''), 'sin motivo'))
      where orden_compra_id = p_oc_id;
    delete from public.ordenes_compra_lineas where orden_compra_id = p_oc_id;
    delete from public.ordenes_compra where id = p_oc_id;
    return jsonb_build_object('ok', true, 'rechazada', true);
  end if;
end;
$$;
grant execute on function public.fn_oc_autorizar(uuid, boolean, text, date, uuid) to authenticated;
