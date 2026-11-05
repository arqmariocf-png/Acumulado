-- Regresar un pago con error desde Tesorería (5-nov-2026, Mario: "Delia me
-- comenta que se agregue un botón en los pagos porque hay errores y le
-- llegan en transferencia cuando debería ser en efectivo; con esto regresa
-- el error y lo documenta").
--
-- Delia (tesorería) recibe en "Por pagar hoy" pagos que dirección programó
-- mal: la OC se paga en efectivo y le llegó como transferencia, la cuenta de
-- cargo no es, el monto no cuadra, el proveedor está mal… Hasta hoy no tenía
-- forma de regresarlo: lo dejaba pendiente y avisaba por WhatsApp.
--
-- fn_pago_regresar_error(pago, tipo, motivo): admin, dirección o corporativo
-- (tesorería) en su alcance; solo pagos pendientes. Deja el pago marcado
-- como devuelto (devuelto_en/_por/_por_nombre/_tipo/_motivo), anota el
-- motivo en las notas y avisa por push a dirección (Laura). Con tipo
-- 'efectivo' además lo pasa a método efectivo sin cuenta y pone la OC en
-- condición efectivo, así sale de Tesorería y entra a "Efectivo por
-- confirmar" (mismo camino que fn_pago_quitar_comprobante). Los demás tipos
-- (cuenta, monto, proveedor, otro) lo sacan de las listas de Tesorería hasta
-- que dirección lo corrija y lo dé por corregido con
-- fn_pago_devolucion_resolver(pago, nota), que limpia la marca y lo regresa a
-- Tesorería. El pago nunca se cancela ni se borra: la historia queda en notas.
--
-- Ya aplicado en producción (pagos_regresar_error).

alter table public.pagos_programados
  add column if not exists devuelto_en timestamptz,
  add column if not exists devuelto_por uuid references public.profiles (id),
  add column if not exists devuelto_por_nombre text,
  add column if not exists devuelto_tipo text,
  add column if not exists devuelto_motivo text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pagos_programados_devuelto_tipo_chk') then
    alter table public.pagos_programados
      add constraint pagos_programados_devuelto_tipo_chk
      check (devuelto_tipo is null or devuelto_tipo in ('efectivo', 'cuenta', 'monto', 'proveedor', 'otro'));
  end if;
end $$;

create index if not exists pagos_programados_devuelto_idx on public.pagos_programados (devuelto_en) where devuelto_en is not null;

create or replace function public.fn_pago_regresar_error(p_pago uuid, p_tipo text, p_motivo text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_rol text := public.auth_rol();
  v_uid uuid := auth.uid();
  v_nombre text;
  v_pago public.pagos_programados%rowtype;
  v_empresa text;
  v_grupo uuid;
  v_folio text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_efectivo boolean := (p_tipo = 'efectivo');
  v_oc_cambiada boolean := false;
  v_dir uuid[];
begin
  if v_rol not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo tesorería, dirección o el administrador regresan pagos' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('efectivo', 'cuenta', 'monto', 'proveedor', 'otro') then
    raise exception 'Tipo de error no válido';
  end if;
  if v_motivo = '' then
    if v_efectivo then
      v_motivo := 'La orden se paga en efectivo, no por transferencia';
    else
      raise exception 'Escribe qué está mal en el pago para que dirección lo corrija';
    end if;
  end if;

  select * into v_pago from public.pagos_programados where id = p_pago for update;
  if not found or not (v_pago.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'Pago no encontrado o de una empresa que no manejas' using errcode = '42501';
  end if;
  if v_pago.estatus <> 'pendiente' then
    raise exception 'Solo se regresa un pago pendiente (este está %)', v_pago.estatus;
  end if;
  if v_pago.devuelto_en is not null then
    raise exception 'Ese pago ya está regresado a dirección (%)', coalesce(v_pago.devuelto_motivo, '');
  end if;

  select nombre into v_nombre from public.profiles where id = v_uid;
  select e.nombre, e.grupo_id into v_empresa, v_grupo from public.empresas e where e.id = v_pago.empresa_id;

  if v_pago.orden_compra_id is not null then
    select o.id_orden into v_folio from public.ordenes_compra o where o.id = v_pago.orden_compra_id;
    if v_efectivo then
      update public.ordenes_compra o
         set condicion_pago = 'efectivo'
       where o.id = v_pago.orden_compra_id
         and o.condicion_pago is distinct from 'efectivo';
      v_oc_cambiada := found;
    end if;
  end if;

  update public.pagos_programados p
     set devuelto_en = now(), devuelto_por = v_uid, devuelto_por_nombre = v_nombre,
         devuelto_tipo = p_tipo, devuelto_motivo = v_motivo,
         metodo = case when v_efectivo then 'efectivo' else p.metodo end,
         cuenta_id = case when v_efectivo then null else p.cuenta_id end,
         notas = btrim(coalesce(p.notas, '') || ' [' || to_char(now() at time zone 'America/Mexico_City', 'DD/MM/YYYY')
                 || ': ' || coalesce(v_nombre, 'tesorería') || ' regresó el pago'
                 || case when v_efectivo then ' (debe ser en efectivo)' else '' end
                 || ': ' || v_motivo || ']'),
         updated_at = now()
   where p.id = p_pago;

  -- Aviso a dirección (si quien regresa no es dirección).
  v_dir := coalesce(public.fn_direccion_de(v_grupo), '{}'::uuid[]);
  v_dir := array(select unnest(v_dir) except select v_uid);
  if coalesce(array_length(v_dir, 1), 0) > 0 then
    perform public.fn_push_aviso(
      v_dir,
      'Pago regresado por tesorería',
      coalesce(v_nombre, 'Tesorería') || ' regresó el pago a ' || v_pago.beneficiario
        || case when v_folio is not null then ' (OC ' || v_folio || ')' else '' end
        || ' · ' || v_empresa || ' · $' || to_char(v_pago.monto, 'FM999,999,999,990.00')
        || case when v_efectivo then ' · debe ser en efectivo' else '' end
        || ': ' || v_motivo,
      case when v_efectivo then '/finanzas/efectivo' else '/finanzas/pagos#pagos-devueltos' end);
  end if;

  return jsonb_build_object('pasa_a_efectivo', v_efectivo and v_pago.metodo <> 'efectivo', 'oc_a_efectivo', v_oc_cambiada, 'avisados', coalesce(array_length(v_dir, 1), 0));
end;
$$;
revoke all on function public.fn_pago_regresar_error(uuid, text, text) from public, anon;
grant execute on function public.fn_pago_regresar_error(uuid, text, text) to authenticated;

-- Dirección corrigió el pago (cuenta, monto, proveedor…) y lo regresa a
-- Tesorería: se limpia la marca y queda la nota.
create or replace function public.fn_pago_devolucion_resolver(p_pago uuid, p_nota text)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_rol text := public.auth_rol();
  v_nombre text;
  v_pago public.pagos_programados%rowtype;
begin
  if v_rol not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo dirección, tesorería o el administrador cierran una devolución' using errcode = '42501';
  end if;
  select * into v_pago from public.pagos_programados where id = p_pago for update;
  if not found or not (v_pago.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'Pago no encontrado o de una empresa que no manejas' using errcode = '42501';
  end if;
  if v_pago.devuelto_en is null then
    raise exception 'Ese pago no está regresado';
  end if;
  select nombre into v_nombre from public.profiles where id = auth.uid();
  update public.pagos_programados p
     set devuelto_en = null, devuelto_por = null, devuelto_por_nombre = null, devuelto_tipo = null, devuelto_motivo = null,
         notas = btrim(coalesce(p.notas, '') || ' [' || to_char(now() at time zone 'America/Mexico_City', 'DD/MM/YYYY')
                 || ': ' || coalesce(v_nombre, 'dirección') || ' corrigió el pago'
                 || case when btrim(coalesce(p_nota, '')) <> '' then ': ' || btrim(p_nota) else '' end || ']'),
         updated_at = now()
   where p.id = p_pago;
end;
$$;
revoke all on function public.fn_pago_devolucion_resolver(uuid, text) from public, anon;
grant execute on function public.fn_pago_devolucion_resolver(uuid, text) to authenticated;

-- La vista lleva la devolución (al final, para no mover columnas).
create or replace view public.v_pagos_programados with (security_invoker = true) as
 SELECT p.id, p.empresa_id, p.cuenta_id, p.beneficiario, p.concepto, p.monto, p.fecha_programada, p.estatus, p.pagado_en, p.referencia, p.notas,
    p.created_by, p.created_at, p.updated_at, p.orden_compra_id, p.metodo, p.comprobante_path, p.comprobante_nombre, p.comprobante_en, p.comprobante_por,
    e.nombre AS empresa_nombre, oc.id_orden, oc.proyecto AS oc_proyecto, fn_proveedor_clave(p.beneficiario) AS clave,
    db.beneficiario AS beneficiario_bancario, db.banco AS banco_proveedor, db.clabe, db.cuenta AS cuenta_proveedor, db.rfc AS rfc_proveedor, db.correo AS correo_proveedor,
    oc.tipo_pago_backoffice, oc.estatus_backoffice, oc.condicion_pago, imp.subtotal AS oc_subtotal, imp.iva AS oc_iva, imp.total AS oc_total,
    p.tipo, p.destino_empresa_id, p.destino_cuenta_id,
    p.devuelto_en, p.devuelto_por, p.devuelto_por_nombre, p.devuelto_tipo, p.devuelto_motivo
   FROM pagos_programados p
     JOIN empresas e ON e.id = p.empresa_id
     LEFT JOIN ordenes_compra oc ON oc.id = p.orden_compra_id
     LEFT JOIN v_oc_importes imp ON imp.orden_compra_id = p.orden_compra_id
     LEFT JOIN proveedores_datos_bancarios db ON db.clave = fn_proveedor_clave(p.beneficiario);
grant select on public.v_pagos_programados to authenticated;
