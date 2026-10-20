-- Ligar un movimiento en revisión a su OC / OS / OV (20-oct-2026, Mario: "una
-- vez que el estatus está en revisión tendría que abrir la lista de OC/OV por
-- número para hacerlo en automático"). Los 1,708 movimientos en revisión no
-- traen referencia: el banco casi nunca dice a qué orden corresponde.
--
-- fn_movimiento_ligar_orden(movimiento, tipo, orden):
--   - Pueden admin, dirección y corporativo, en empresas de su alcance (igual
--     que "No lleva factura"); la orden tiene que ser de la misma empresa.
--   - Deja referencia_tipo/_numero (lo mismo que lee el motor), proyecto y
--     nombre de la orden si el movimiento no los traía.
--   - Busca la factura por monto como el motor (cargo → CFDI recibido, abono
--     → emitido, ±0.01); si hay varias con ese monto, se queda con la del
--     proveedor/cliente de la orden. Una sola → FACTURA "F- folio" y resuelto;
--     si no, 'pendiente_esperado' con la nota "falta factura".
--   - No toca version (el trigger la sube).
--
-- Ya aplicado en producción (movimiento_ligar_orden).

create or replace function public.fn_movimiento_ligar_orden(p_movimiento uuid, p_tipo text, p_orden uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_rol text := public.auth_rol();
  v_nombre text;
  v_mov public.movimientos%rowtype;
  v_tipo text := upper(btrim(coalesce(p_tipo, '')));
  v_numero text;
  v_proyecto text;
  v_contraparte text;
  v_monto numeric;
  v_tipo_cfdi text;
  v_folios text[];
  v_factura text;
  v_estado text;
begin
  if v_rol not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo dirección, corporativo o el administrador ligan movimientos a órdenes' using errcode = '42501';
  end if;
  select * into v_mov from public.movimientos where id = p_movimiento for update;
  if not found or not (v_mov.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'Movimiento no encontrado o de una empresa que no manejas' using errcode = '42501';
  end if;
  if v_mov.estado_clasificacion = 'resuelto' then
    raise exception 'Ese movimiento ya está conciliado';
  end if;

  if v_tipo in ('OC', 'OS') then
    select o.id_orden, o.proyecto, o.proveedor, o.tipo into v_numero, v_proyecto, v_contraparte, v_tipo
      from public.ordenes_compra o
     where o.id = p_orden and o.empresa_id = v_mov.empresa_id;
  elsif v_tipo = 'OV' then
    select o.id_ov, o.proyecto, o.cliente into v_numero, v_proyecto, v_contraparte
      from public.ordenes_venta o
     where o.id = p_orden and o.empresa_id = v_mov.empresa_id;
  else
    raise exception 'Tipo de orden inválido: %', p_tipo;
  end if;
  if v_numero is null then
    raise exception 'La orden no existe o es de otra empresa';
  end if;
  v_tipo := coalesce(nullif(upper(v_tipo), ''), 'OC');

  v_monto := coalesce(v_mov.cargo_total, v_mov.abono_total);
  v_tipo_cfdi := case when v_mov.cargo_total is not null then 'recibido' else 'emitido' end;
  if v_mov.factura is null and v_monto is not null then
    select array_agg(c.folio) into v_folios from public.cfdi c
     where c.empresa_id = v_mov.empresa_id and c.tipo = v_tipo_cfdi
       and abs(c.total - v_monto) <= 0.01;
    if coalesce(array_length(v_folios, 1), 0) > 1 then
      select array_agg(c.folio) into v_folios from public.cfdi c
       where c.empresa_id = v_mov.empresa_id and c.tipo = v_tipo_cfdi
         and abs(c.total - v_monto) <= 0.01
         and public.fn_proveedor_clave(c.contraparte) = public.fn_proveedor_clave(v_contraparte);
    end if;
    if coalesce(array_length(v_folios, 1), 0) = 1 then
      v_factura := 'F- ' || v_folios[1];
    end if;
  end if;

  select nombre into v_nombre from public.profiles where id = auth.uid();
  v_estado := case when coalesce(v_factura, v_mov.factura) is not null then 'resuelto' else 'pendiente_esperado' end;

  update public.movimientos m
     set referencia_tipo = v_tipo,
         referencia_numero = v_numero,
         proyecto = coalesce(m.proyecto, v_proyecto),
         nombre_razon_social = coalesce(m.nombre_razon_social, v_contraparte),
         factura = coalesce(m.factura, v_factura),
         estado_clasificacion = v_estado,
         posible_duplicado = false,
         observacion = 'Ligado a ' || v_tipo || ' ' || v_numero || coalesce(' (' || v_contraparte || ')', '')
                       || ' por ' || coalesce(v_nombre, 'usuario')
                       || case when v_estado = 'resuelto' then '' else '; falta factura' end,
         updated_by = auth.uid(), updated_at = now()
   where m.id = p_movimiento;

  return jsonb_build_object('tipo', v_tipo, 'numero', v_numero, 'factura', coalesce(v_factura, v_mov.factura), 'estado', v_estado);
end;
$$;
revoke all on function public.fn_movimiento_ligar_orden(uuid, text, uuid) from public, anon;
grant execute on function public.fn_movimiento_ligar_orden(uuid, text, uuid) to authenticated;
