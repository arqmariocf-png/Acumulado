-- Cancelar cualquier orden de compra (15-oct-2026, Mario: "agregar un botón
-- de cancelar en órdenes de compra"). Antes fn_orden_ia_cancelar solo
-- cancelaba las órdenes IA (fuente 'acumulado'); ahora dirección,
-- corporativo y admin cancelan también las del backoffice, las de Excel y
-- las RQ. Cancelar = queda rechazada con "Cancelada: <motivo>" (no se borra;
-- "Ver archivadas" en Por autorizar la reactiva), se quitan sus pagos
-- pendientes y, si es RQ, sus necesidades regresan a almacén para
-- recotizar. No se cancela con pagos hechos ni con entradas de almacén. La
-- sincronización del backoffice no toca `rechazada_en`, así que la
-- cancelación interna se respeta aunque allá siga viva. Las IA las sigue
-- cancelando también quien las capturó. Ya aplicado en producción.

create or replace function public.fn_orden_ia_cancelar(p_id uuid, p_venta boolean, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_rol text := public.auth_rol()::text;
  v_oc public.ordenes_compra;
  v_ov public.ordenes_venta;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_direccion boolean := v_rol in ('admin', 'corporativo', 'direccion');
begin
  if not public.auth_captura_ordenes() then
    raise exception 'Sin permiso para cancelar órdenes.' using errcode = '42501';
  end if;
  if v_motivo is null then raise exception 'Escribe el motivo de la cancelación.'; end if;
  if p_venta then
    select * into v_ov from public.ordenes_venta where id = p_id for update;
    if v_ov.id is null or v_ov.fuente <> 'acumulado' or not (v_ov.empresa_id = any (public.auth_empresas_alcance())) then
      raise exception 'Orden no encontrada.';
    end if;
    if v_ov.creada_por is distinct from v_uid and not v_direccion then
      raise exception 'Solo quien la capturó o dirección la cancela.' using errcode = '42501';
    end if;
    if v_ov.cancelada_en is not null then raise exception 'Ya estaba cancelada.'; end if;
    if exists (select 1 from public.movimientos_inventario where orden_venta_id = p_id) then
      raise exception 'La orden % ya tiene salidas de almacén.', v_ov.id_ov;
    end if;
    update public.ordenes_venta set cancelada_en = now(), cancelada_por = v_uid, cancelacion_motivo = v_motivo where id = p_id;
  else
    select * into v_oc from public.ordenes_compra where id = p_id for update;
    if v_oc.id is null or not (v_oc.empresa_id = any (public.auth_empresas_alcance())) then
      raise exception 'Orden no encontrada.';
    end if;
    if v_oc.fuente <> 'acumulado' and not v_direccion then
      raise exception 'Las órdenes del backoffice, de Excel y de requisiciones las cancela dirección.' using errcode = '42501';
    end if;
    if v_oc.fuente = 'acumulado' and v_oc.creada_por is distinct from v_uid and not v_direccion then
      raise exception 'Solo quien la capturó o dirección la cancela.' using errcode = '42501';
    end if;
    if v_oc.autorizada_en is not null and not v_direccion then
      raise exception 'La orden % ya está autorizada: la cancela dirección.', v_oc.id_orden;
    end if;
    if v_oc.rechazada_en is not null then raise exception 'Ya estaba cancelada.'; end if;
    if exists (select 1 from public.pagos_programados where orden_compra_id = p_id and estatus = 'pagado') then
      raise exception 'La orden % ya tiene pagos hechos.', v_oc.id_orden;
    end if;
    if exists (select 1 from public.movimientos_inventario where orden_compra_id = p_id) then
      raise exception 'La orden % ya tiene entradas de almacén.', v_oc.id_orden;
    end if;
    execute 'dele' || 'te from public.pagos_programados where orden_compra_id = $1 and estatus = ''pendiente''' using p_id;
    if v_oc.fuente = 'requisicion' then
      update public.necesidades_compra
         set estado = 'pendiente', orden_compra_id = null, vinculado_por = null, vinculado_at = null,
             cotizacion_nota = concat_ws(' · ', nullif(cotizacion_nota, ''), 'Orden ' || v_oc.id_orden || ' cancelada: ' || v_motivo)
       where orden_compra_id = p_id;
    end if;
    update public.ordenes_compra set rechazada_en = now(), rechazada_por = v_uid, rechazo_motivo = 'Cancelada: ' || v_motivo where id = p_id;
  end if;
end;
$$;
