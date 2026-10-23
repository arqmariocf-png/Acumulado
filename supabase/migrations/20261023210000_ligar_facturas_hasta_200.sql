-- Más de 20 facturas por movimiento (23-oct-2026, Allison: "me podría ayudar a
-- actualizar el sistema para que me deje seleccionar más de 20 facturas";
-- Mario: "Claro"). Un depósito de $430,000 cubría 42 facturas y
-- fn_movimiento_ligar_facturas rechazaba con "Hasta 20 facturas por
-- movimiento". El tope sube a 200 (FACTURA y observación son text, no hay
-- límite de largo). Todo lo demás igual que en 20261023090000.
--
-- Ya aplicado en producción (ligar_facturas_hasta_200).

create or replace function public.fn_movimiento_ligar_facturas(p_movimiento uuid, p_cfdis uuid[])
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_rol text := public.auth_rol();
  v_nombre text;
  v_mov public.movimientos%rowtype;
  v_tipo_cfdi text;
  v_ids uuid[];
  v_n int;
  v_encontradas int;
  v_otro_tipo int;
  v_folios text[];
  v_suma numeric;
  v_contrapartes text;
  v_factura text;
  v_otros int;
begin
  if v_rol not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo dirección, corporativo o el administrador ligan facturas a movimientos' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_cfdis, '{}'::uuid[])) x where x is not null;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then
    raise exception 'Elige al menos una factura';
  end if;
  if v_n > 200 then
    raise exception 'Hasta 200 facturas por movimiento';
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
  select count(*), count(*) filter (where c.tipo <> v_tipo_cfdi)
    into v_encontradas, v_otro_tipo
    from public.cfdi c where c.id = any (v_ids) and c.empresa_id = v_mov.empresa_id;
  if v_encontradas <> v_n then
    raise exception 'Alguna factura no existe o es de otra empresa';
  end if;
  if v_otro_tipo > 0 then
    raise exception '%', case when v_tipo_cfdi = 'recibido' then 'Un cargo se liga a facturas recibidas (de proveedor)'
                              else 'Un abono se liga a facturas emitidas (a cliente)' end;
  end if;

  select array_agg(c.folio order by c.fecha nulls last, c.folio), coalesce(sum(c.total), 0),
         string_agg(distinct c.contraparte, ' / ')
    into v_folios, v_suma, v_contrapartes
    from public.cfdi c where c.id = any (v_ids);

  v_factura := 'FM- ' || array_to_string(v_folios, ', ');
  select count(*) into v_otros from public.movimientos m
   where m.empresa_id = v_mov.empresa_id and m.id <> p_movimiento
     and m.factura ~ '^FM?- '
     and exists (select 1 from unnest(v_folios) f where position(f in m.factura) > 0);

  select nombre into v_nombre from public.profiles where id = auth.uid();
  update public.movimientos m
     set factura = v_factura,
         nombre_razon_social = coalesce(m.nombre_razon_social, v_contrapartes),
         estado_clasificacion = 'resuelto',
         posible_duplicado = false,
         observacion = case when v_n = 1 then 'Factura ' else v_n || ' facturas ' end
                       || array_to_string(v_folios, ', ')
                       || coalesce(' (' || v_contrapartes || ')', '')
                       || case when v_n > 1 then ' por ' || to_char(v_suma, 'FM$999,999,990.00') else '' end
                       || ' elegida' || case when v_n > 1 then 's' else '' end
                       || ' por ' || coalesce(v_nombre, 'usuario'),
         updated_by = auth.uid(), updated_at = now()
   where m.id = p_movimiento;

  return jsonb_build_object('factura', v_factura, 'folios', to_jsonb(v_folios), 'folio', v_folios[1],
                            'contraparte', v_contrapartes, 'total', v_suma, 'facturas', v_n,
                            'otros_movimientos', v_otros);
end;
$$;
revoke all on function public.fn_movimiento_ligar_facturas(uuid, uuid[]) from public, anon;
