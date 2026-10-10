-- Punto de venta ligado a existencias reales (10-oct-2026, Mario: "vincula
-- el inventario con el punto de venta para tener existencias reales").
-- Ya aplicado en producción.
--  * fn_pv_cobrar no deja vender más de lo que hay en el almacén del punto
--    de venta (el primer almacén activo de la empresa, el mismo del que sale).
--  * fn_pv_ajustar_existencia: conteo físico desde el punto de venta; registra
--    la diferencia como ajuste (entrada o salida) en ese almacén.
--  * fn_pv_almacen: qué almacén usa el punto de venta (para pintar su stock).

create or replace function public.fn_pv_cobrar(
  p_empresa uuid, p_turno uuid, p_cliente uuid, p_cliente_nombre text,
  p_lineas jsonb, p_pagos jsonb, p_requiere_factura boolean default false, p_notas text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_turno public.pv_turnos;
  v_almacen uuid;
  v_venta uuid;
  v_folio text;
  v_total numeric := 0;
  v_no_efectivo numeric := 0;
  v_efectivo numeric := 0;
  v_credito numeric := 0;
  v_cambio numeric := 0;
  v_saldo numeric;
  v_cc public.clientes_credito;
  r jsonb;
  v_p public.productos;
  v_cant numeric;
  v_precio numeric;
  v_desc numeric;
  v_costo numeric;
  v_mov uuid;
  v_orden int := 0;
begin
  perform public.fn_pv_guarda(p_empresa);
  select * into v_turno from public.pv_turnos where id = p_turno;
  if v_turno.id is null or v_turno.cerrado_en is not null or v_turno.empresa_id <> p_empresa then
    raise exception 'Abre la caja de esta empresa antes de cobrar.';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'La venta no tiene productos.'; end if;
  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then raise exception 'Falta la forma de pago.'; end if;
  if p_cliente is not null and not exists (select 1 from public.clientes where id = p_cliente and empresa_id = p_empresa) then
    raise exception 'El cliente no es de esta empresa.';
  end if;
  select id into v_almacen from public.almacenes where empresa_id = p_empresa and activo order by created_at limit 1;
  if v_almacen is null then raise exception 'La empresa no tiene almacén.'; end if;

  -- Existencias reales: no se vende lo que no hay en el almacén del punto de venta.
  declare
    s record;
  begin
    for s in
      select p.nombre, p.unidad_medida, l.cant,
             coalesce((select sum(x.existencia) from public.existencias x where x.producto_id = p.id and x.almacen_id = v_almacen), 0) as hay
        from (select (e ->> 'producto_id')::uuid pid, sum((e ->> 'cantidad')::numeric) cant
                from jsonb_array_elements(p_lineas) e group by 1) l
        join public.productos p on p.id = l.pid and p.empresa_id = p_empresa
    loop
      if s.cant > s.hay then
        raise exception 'Sin existencia suficiente de %: hay % %, se piden %.', s.nombre, s.hay, coalesce(s.unidad_medida, ''), s.cant;
      end if;
    end loop;
  end;

  -- Total de los productos.
  for r in select * from jsonb_array_elements(p_lineas) loop
    select * into v_p from public.productos where id = (r ->> 'producto_id')::uuid and empresa_id = p_empresa and activo;
    if v_p.id is null then raise exception 'Producto no encontrado en esta empresa.'; end if;
    v_cant := (r ->> 'cantidad')::numeric;
    v_precio := coalesce((r ->> 'precio')::numeric, v_p.precio_venta);
    v_desc := coalesce((r ->> 'descuento_pct')::numeric, 0);
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en %.', v_p.nombre; end if;
    if v_precio is null then raise exception '% no tiene precio de venta.', v_p.nombre; end if;
    v_total := v_total + round(v_cant * v_precio * (1 - v_desc / 100), 2);
  end loop;

  -- Pagos.
  for r in select * from jsonb_array_elements(p_pagos) loop
    if (r ->> 'monto')::numeric is null or (r ->> 'monto')::numeric <= 0 then continue; end if;
    case r ->> 'metodo'
      when 'efectivo' then v_efectivo := v_efectivo + (r ->> 'monto')::numeric;
      when 'credito' then v_credito := v_credito + (r ->> 'monto')::numeric;
      when 'tarjeta', 'transferencia' then v_no_efectivo := v_no_efectivo + (r ->> 'monto')::numeric;
      else raise exception 'Forma de pago desconocida: %', r ->> 'metodo';
    end case;
  end loop;
  if v_no_efectivo + v_credito > v_total + 0.005 then
    raise exception 'Tarjeta, transferencia y crédito no pueden pasar del total (%).', v_total;
  end if;
  if v_efectivo + v_no_efectivo + v_credito < v_total - 0.005 then
    raise exception 'Falta por pagar %.', round(v_total - (v_efectivo + v_no_efectivo + v_credito), 2);
  end if;
  v_cambio := round(greatest(v_efectivo + v_no_efectivo + v_credito - v_total, 0), 2);

  if v_credito > 0 then
    if p_cliente is null then raise exception 'La venta a crédito necesita cliente.'; end if;
    select * into v_cc from public.clientes_credito where cliente_id = p_cliente;
    if v_cc.cliente_id is null or not v_cc.autorizado then raise exception 'El cliente no tiene crédito autorizado.'; end if;
    select coalesce(saldo, 0) into v_saldo from public.v_pv_saldos_clientes where cliente_id = p_cliente;
    if coalesce(v_saldo, 0) + v_credito > coalesce(v_cc.linea_credito, 0) + 0.005 then
      raise exception 'Rebasa la línea de crédito: saldo %, línea %.', coalesce(v_saldo, 0), v_cc.linea_credito;
    end if;
  end if;

  v_folio := public.fn_siguiente_folio(p_empresa, 'PV');
  insert into public.pv_ventas (empresa_id, folio, turno_id, cliente_id, cliente_nombre, vendedor_id, vendedor_nombre,
                                estado, requiere_factura, notas)
  values (p_empresa, v_folio, p_turno, p_cliente,
          coalesce(nullif(trim(coalesce(p_cliente_nombre, '')), ''), (select razon_social from public.clientes where id = p_cliente), 'Público en general'),
          auth.uid(), public.fn_pv_nombre_usuario(),
          case when v_credito > 0 then 'credito' else 'pagada' end, coalesce(p_requiere_factura, false),
          nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_venta;

  for r in select * from jsonb_array_elements(p_lineas) loop
    select * into v_p from public.productos where id = (r ->> 'producto_id')::uuid;
    v_cant := (r ->> 'cantidad')::numeric;
    v_precio := coalesce((r ->> 'precio')::numeric, v_p.precio_venta);
    v_desc := coalesce((r ->> 'descuento_pct')::numeric, 0);
    select coalesce(x.costo_promedio, v_p.costo_referencia) into v_costo
      from public.existencias x where x.producto_id = v_p.id and x.almacen_id = v_almacen;
    insert into public.movimientos_inventario (empresa_id, almacen_id, producto_id, tipo, cantidad, costo_unitario, fecha,
                                               comentario, registrado_por, codigo_escaneado)
    values (p_empresa, v_almacen, v_p.id, 'salida', v_cant, v_costo, (now() at time zone 'America/Mexico_City')::date,
            'Venta ' || v_folio, auth.uid(), nullif(r ->> 'codigo', ''))
    returning id into v_mov;
    v_orden := v_orden + 1;
    insert into public.pv_venta_lineas (venta_id, empresa_id, producto_id, sku, descripcion, unidad, cantidad, precio_unitario,
                                        descuento_pct, iva_tasa, costo_unitario, movimiento_id, orden)
    values (v_venta, p_empresa, v_p.id, v_p.sku, v_p.nombre, v_p.unidad_medida, v_cant, v_precio, v_desc, v_p.iva_tasa,
            v_costo, v_mov, v_orden);
  end loop;

  for r in select * from jsonb_array_elements(p_pagos) loop
    if (r ->> 'monto')::numeric is null or (r ->> 'monto')::numeric <= 0 then continue; end if;
    insert into public.pv_pagos (empresa_id, venta_id, turno_id, cliente_id, metodo, monto, recibido, cambio, referencia)
    values (p_empresa, v_venta, p_turno, p_cliente, r ->> 'metodo',
            case when r ->> 'metodo' = 'efectivo' then (r ->> 'monto')::numeric - v_cambio else (r ->> 'monto')::numeric end,
            case when r ->> 'metodo' = 'efectivo' then (r ->> 'monto')::numeric end,
            case when r ->> 'metodo' = 'efectivo' then v_cambio else 0 end,
            nullif(trim(coalesce(r ->> 'referencia', '')), ''));
  end loop;

  return jsonb_build_object('id', v_venta, 'folio', v_folio, 'total', v_total, 'cambio', v_cambio);
end;
$$;


create or replace function public.fn_pv_almacen(p_empresa uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.almacenes a
   where a.empresa_id = p_empresa and a.activo
     and a.empresa_id = any (public.auth_empresas_alcance())
   order by a.created_at limit 1
$$;
grant execute on function public.fn_pv_almacen(uuid) to authenticated;

create or replace function public.fn_pv_ajustar_existencia(p_producto uuid, p_contado numeric, p_nota text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_p public.productos;
  v_almacen uuid;
  v_hay numeric;
  v_costo numeric;
  v_dif numeric;
  v_mov uuid;
begin
  select * into v_p from public.productos where id = p_producto;
  if v_p.id is null then raise exception 'Producto no encontrado.'; end if;
  perform public.fn_pv_guarda(v_p.empresa_id);
  if not public.auth_supervisa_pv() then
    raise exception 'El conteo físico lo registra almacén, corporativo o admin.' using errcode = '42501';
  end if;
  if p_contado is null or p_contado < 0 then raise exception 'Cantidad contada inválida.'; end if;
  select id into v_almacen from public.almacenes where empresa_id = v_p.empresa_id and activo order by created_at limit 1;
  if v_almacen is null then raise exception 'La empresa no tiene almacén.'; end if;
  select coalesce(sum(x.existencia), 0), max(coalesce(x.costo_promedio, x.costo_referencia))
    into v_hay, v_costo
    from public.existencias x where x.producto_id = v_p.id and x.almacen_id = v_almacen;
  v_dif := p_contado - coalesce(v_hay, 0);
  if v_dif = 0 then return null; end if;
  insert into public.movimientos_inventario (empresa_id, almacen_id, producto_id, tipo, cantidad, costo_unitario, fecha,
                                             es_ajuste, comentario, registrado_por)
  values (v_p.empresa_id, v_almacen, v_p.id, (case when v_dif > 0 then 'entrada' else 'salida' end)::public.tipo_movimiento_inventario, abs(v_dif),
          coalesce(v_costo, v_p.costo_referencia), (now() at time zone 'America/Mexico_City')::date, true,
          'Conteo físico (punto de venta): había ' || coalesce(v_hay, 0) || ', se contaron ' || p_contado
            || coalesce(' · ' || nullif(trim(p_nota), ''), ''),
          auth.uid())
  returning id into v_mov;
  return v_mov;
end;
$$;
grant execute on function public.fn_pv_ajustar_existencia(uuid, numeric, text) to authenticated;
