-- Ligar un movimiento a su factura (CFDI) eligiéndola por número de factura o
-- folio fiscal (21-oct-2026, Mario: "así como pusiste un botón para elegir
-- OV/OC/OS, poner uno para elegir factura o folio fiscal"). El motor solo
-- encuentra la factura cuando hay UNA con el mismo monto; un pago parcial, uno
-- con comisión o varias facturas iguales se quedaban en revisión.
--
-- fn_movimiento_ligar_factura(movimiento, cfdi):
--   - Pueden admin, dirección y corporativo, en empresas de su alcance (igual
--     que ligar orden y "No lleva factura"); el CFDI tiene que ser de la misma
--     empresa: cargo → recibido, abono → emitido.
--   - Deja FACTURA = "FM- <folio>" (FM = elegida a mano): el motor respeta lo
--     que no empieza con "F- " ni "N/A -", así que "Reclasificar" no la borra.
--   - Queda resuelto; nombre y RFC de la contraparte si el movimiento no traía
--     nombre. Se puede cambiar mientras la factura sea F-/FM- (no las N/A).
--   - Devuelve si esa factura ya estaba ligada a otros movimientos.
--
-- Ya aplicado en producción (movimiento_ligar_factura).

create or replace function public.fn_movimiento_ligar_factura(p_movimiento uuid, p_cfdi uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_rol text := public.auth_rol();
  v_nombre text;
  v_mov public.movimientos%rowtype;
  v_cfdi public.cfdi%rowtype;
  v_tipo_cfdi text;
  v_factura text;
  v_otros int;
begin
  if v_rol not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo dirección, corporativo o el administrador ligan facturas a movimientos' using errcode = '42501';
  end if;
  select * into v_mov from public.movimientos where id = p_movimiento for update;
  if not found or not (v_mov.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'Movimiento no encontrado o de una empresa que no manejas' using errcode = '42501';
  end if;
  if v_mov.estado_clasificacion = 'resuelto'
     and not coalesce(v_mov.factura ~ '^FM?- ', false) then
    raise exception 'Ese movimiento ya está conciliado';
  end if;

  v_tipo_cfdi := case when v_mov.cargo_total is not null then 'recibido' else 'emitido' end;
  select * into v_cfdi from public.cfdi c where c.id = p_cfdi and c.empresa_id = v_mov.empresa_id;
  if not found then
    raise exception 'La factura no existe o es de otra empresa';
  end if;
  if v_cfdi.tipo <> v_tipo_cfdi then
    raise exception '%', case when v_tipo_cfdi = 'recibido' then 'Un cargo se liga a una factura recibida (de proveedor)'
                              else 'Un abono se liga a una factura emitida (a cliente)' end;
  end if;

  v_factura := 'FM- ' || v_cfdi.folio;
  select count(*) into v_otros from public.movimientos m
   where m.empresa_id = v_mov.empresa_id and m.id <> p_movimiento
     and m.factura in (v_factura, 'F- ' || v_cfdi.folio);

  select nombre into v_nombre from public.profiles where id = auth.uid();
  update public.movimientos m
     set factura = v_factura,
         nombre_razon_social = coalesce(m.nombre_razon_social, v_cfdi.contraparte),
         estado_clasificacion = 'resuelto',
         posible_duplicado = false,
         observacion = 'Factura ' || v_cfdi.folio || coalesce(' (' || v_cfdi.contraparte || ')', '')
                       || ' elegida por ' || coalesce(v_nombre, 'usuario'),
         updated_by = auth.uid(), updated_at = now()
   where m.id = p_movimiento;

  return jsonb_build_object('factura', v_factura, 'folio', v_cfdi.folio, 'contraparte', v_cfdi.contraparte,
                            'total', v_cfdi.total, 'otros_movimientos', v_otros);
end;
$$;
revoke all on function public.fn_movimiento_ligar_factura(uuid, uuid) from public, anon;
grant execute on function public.fn_movimiento_ligar_factura(uuid, uuid) to authenticated;
