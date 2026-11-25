-- Cambiar el método de un pago programado (25-nov-2026, Mario: "crea el
-- botón para hacerlo manual", después de que dos OC de Chubb Fianzas (ERG,
-- IA-OC-0518/0519) se quedaron atoradas: Laura las programó como
-- transferencia, Delia las regresó con "debe ser en efectivo" por error y
-- ya nadie podía regresarlas a transferencia sin SQL).
--
-- fn_pago_cambiar_metodo(pago, metodo, cuenta, fecha, nota): admin,
-- dirección o corporativo en su alcance; solo pagos pendientes. Cambia el
-- método (transferencia / cheque / efectivo); con transferencia o cheque
-- deja la cuenta de cargo (de la misma empresa) y, si la OC estaba en
-- condición efectivo, la quita (y si la forma de pago capturada aquí decía
-- Efectivo la pasa a transferencia, para que salga de "Efectivo por
-- confirmar"); con efectivo quita la cuenta y pone la OC en condición
-- efectivo. Limpia cualquier marca de devolución, reprograma la fecha si se
-- pide y deja la nota en `notas`. Nunca cancela ni borra.
--
-- fn_oc_pagos_cambiar_metodo(oc, metodo, cuenta, fecha, nota): lo mismo para
-- todos los pagos pendientes de una OC (botón en Efectivo por confirmar, que
-- lista OC, no pagos); si la OC no tiene pagos pendientes solo cambia la OC,
-- que entonces vuelve a "Por autorizar y programar" para programarse como
-- transferencia.
--
-- Ya aplicado en producción (pagos_cambiar_metodo).

create or replace function public.fn_pago_cambiar_metodo(p_pago uuid, p_metodo text, p_cuenta_id uuid default null, p_fecha date default null, p_nota text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_rol text := public.auth_rol();
  v_uid uuid := auth.uid();
  v_nombre text;
  v_pago public.pagos_programados%rowtype;
  v_cuenta public.cuentas_bancarias%rowtype;
  v_oc public.ordenes_compra%rowtype;
  v_efectivo boolean := (p_metodo = 'efectivo');
  v_oc_cambiada boolean := false;
  v_texto text;
begin
  if v_rol not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo dirección, tesorería o el administrador cambian el método de un pago' using errcode = '42501';
  end if;
  if p_metodo is null or p_metodo not in ('transferencia', 'efectivo', 'cheque') then
    raise exception 'Método no válido: usa transferencia, cheque o efectivo';
  end if;

  select * into v_pago from public.pagos_programados where id = p_pago for update;
  if not found or not (v_pago.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'Pago no encontrado o de una empresa que no manejas' using errcode = '42501';
  end if;
  if v_pago.estatus <> 'pendiente' then
    raise exception 'Solo se cambia el método de un pago pendiente (este está %)', v_pago.estatus;
  end if;

  if not v_efectivo and p_cuenta_id is not null then
    select * into v_cuenta from public.cuentas_bancarias where id = p_cuenta_id;
    if not found or v_cuenta.empresa_id <> v_pago.empresa_id then
      raise exception 'La cuenta de cargo no es de la empresa del pago';
    end if;
  end if;

  select nombre into v_nombre from public.profiles where id = v_uid;

  if v_pago.orden_compra_id is not null then
    select * into v_oc from public.ordenes_compra where id = v_pago.orden_compra_id for update;
    if v_efectivo then
      if v_oc.condicion_pago is distinct from 'efectivo' then
        update public.ordenes_compra set condicion_pago = 'efectivo' where id = v_oc.id;
        v_oc_cambiada := true;
      end if;
    else
      if v_oc.condicion_pago = 'efectivo' then
        update public.ordenes_compra set condicion_pago = null where id = v_oc.id;
        v_oc_cambiada := true;
      end if;
      -- La forma de pago capturada aquí (no la del backoffice) también cuenta
      -- como efectivo en Efectivo por confirmar: se corrige para que salga.
      if v_oc.fuente <> 'api' and v_oc.tipo_pago_backoffice ilike 'efectivo%' then
        update public.ordenes_compra
           set tipo_pago_backoffice = case when p_metodo = 'cheque' then 'Cheque' else 'Transferencia electrónica de fondos' end
         where id = v_oc.id;
        v_oc_cambiada := true;
      end if;
    end if;
  end if;

  v_texto := coalesce(v_nombre, 'dirección') || ' cambió el pago a ' || p_metodo
    || case when not v_efectivo and v_cuenta.id is not null then ' desde ' || v_cuenta.banco || ' ' || v_cuenta.ultimos_4 else '' end
    || case when p_fecha is not null and p_fecha <> v_pago.fecha_programada then ', programado al ' || to_char(p_fecha, 'DD/MM/YYYY') else '' end
    || case when btrim(coalesce(p_nota, '')) <> '' then ': ' || btrim(p_nota) else '' end;

  update public.pagos_programados p
     set metodo = p_metodo,
         cuenta_id = case when v_efectivo then null else coalesce(p_cuenta_id, p.cuenta_id) end,
         fecha_programada = coalesce(p_fecha, p.fecha_programada),
         devuelto_en = null, devuelto_por = null, devuelto_por_nombre = null, devuelto_tipo = null, devuelto_motivo = null,
         notas = btrim(coalesce(p.notas, '') || ' [' || to_char(now() at time zone 'America/Mexico_City', 'DD/MM/YYYY') || ': ' || v_texto || ']'),
         updated_at = now()
   where p.id = p_pago;

  return jsonb_build_object('metodo', p_metodo, 'oc_cambiada', v_oc_cambiada, 'cuenta', case when v_cuenta.id is not null then v_cuenta.banco || ' ' || v_cuenta.ultimos_4 end);
end;
$$;
revoke all on function public.fn_pago_cambiar_metodo(uuid, text, uuid, date, text) from public, anon;
grant execute on function public.fn_pago_cambiar_metodo(uuid, text, uuid, date, text) to authenticated;

create or replace function public.fn_oc_pagos_cambiar_metodo(p_oc uuid, p_metodo text, p_cuenta_id uuid default null, p_fecha date default null, p_nota text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_rol text := public.auth_rol();
  v_oc public.ordenes_compra%rowtype;
  v_pago record;
  v_n int := 0;
  v_efectivo boolean := (p_metodo = 'efectivo');
begin
  if v_rol not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo dirección, tesorería o el administrador cambian el método de un pago' using errcode = '42501';
  end if;
  if p_metodo is null or p_metodo not in ('transferencia', 'efectivo', 'cheque') then
    raise exception 'Método no válido: usa transferencia, cheque o efectivo';
  end if;
  select * into v_oc from public.ordenes_compra where id = p_oc for update;
  if not found or not (v_oc.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'Orden no encontrada o de una empresa que no manejas' using errcode = '42501';
  end if;

  for v_pago in select id from public.pagos_programados where orden_compra_id = p_oc and estatus = 'pendiente' order by created_at loop
    perform public.fn_pago_cambiar_metodo(v_pago.id, p_metodo, p_cuenta_id, p_fecha, p_nota);
    v_n := v_n + 1;
  end loop;

  -- Sin pagos pendientes, solo la OC: así sale (o entra) de Efectivo por
  -- confirmar y se programa después con el método correcto.
  if v_n = 0 then
    if v_efectivo then
      update public.ordenes_compra set condicion_pago = 'efectivo' where id = p_oc and condicion_pago is distinct from 'efectivo';
    else
      update public.ordenes_compra set condicion_pago = null where id = p_oc and condicion_pago = 'efectivo';
      update public.ordenes_compra
         set tipo_pago_backoffice = case when p_metodo = 'cheque' then 'Cheque' else 'Transferencia electrónica de fondos' end
       where id = p_oc and fuente <> 'api' and tipo_pago_backoffice ilike 'efectivo%';
    end if;
  end if;

  return jsonb_build_object('pagos', v_n, 'metodo', p_metodo);
end;
$$;
revoke all on function public.fn_oc_pagos_cambiar_metodo(uuid, text, uuid, date, text) from public, anon;
grant execute on function public.fn_oc_pagos_cambiar_metodo(uuid, text, uuid, date, text) to authenticated;
