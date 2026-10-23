-- Cuentas por cobrar: ligar órdenes de venta al cobro (23-oct-2026, Mario:
-- "en cuentas por cobrar, al registrar cobro de la empresa, despliega el
-- listado de OV pendientes de pago para seleccionarlas únicamente y
-- vincularlas"). Una OV que se elige al registrar un cobro se vuelve un
-- documento de la cartera (`cxc_documentos.orden_venta_id`, tipo 'otro', folio
-- "OV <id_ov>") y el cobro se aplica a ese documento: la OV queda vinculada al
-- cobro y, si fue parcial, sigue saliendo como pendiente con su saldo.
-- `fn_cxc_ov_pendientes` = OV no canceladas de la empresa con saldo (total −
-- cobrado aquí); la clave del cliente se toma del RFC con que se le factura
-- (CFDI emitidos con el mismo nombre) o de la ficha de cxc_clientes.
--
-- Ya aplicado en producción (cxc_ordenes_venta).

alter table public.cxc_documentos add column if not exists orden_venta_id uuid references public.ordenes_venta (id);
create unique index if not exists cxc_documentos_ov_unica on public.cxc_documentos (orden_venta_id) where cancelado_en is null;

create or replace function public.fn_cxc_ov_pendientes(p_empresa uuid default null)
returns table (
  id uuid, id_ov text, empresa_id uuid, empresa text, cliente text, cliente_clave text, cliente_rfc text,
  fecha_ov date, total numeric, cobrado numeric, saldo numeric, proyecto text, fuente text, condicion_pago text,
  documento_id uuid, dias_credito int
) language sql stable security definer set search_path = public as $$
  with emp as (
    select e.id, e.codigo from public.empresas e
     where e.id = any (public.auth_empresas_alcance()) and (p_empresa is null or e.id = p_empresa)
       and public.auth_ve_cxc()
  ),
  ov as (
    select o.*, public.fn_proveedor_clave(o.cliente) k, e.codigo
      from public.ordenes_venta o join emp e on e.id = o.empresa_id
     where o.cancelada_en is null and coalesce(o.total, 0) > 0.5
  ),
  rfc as (
    select distinct on (c.empresa_id, public.fn_proveedor_clave(c.contraparte))
           c.empresa_id, public.fn_proveedor_clave(c.contraparte) k, upper(c.rfc) rfc
      from public.cfdi c join emp e on e.id = c.empresa_id
     where c.tipo = 'emitido' and c.contraparte is not null and c.rfc is not null
     order by c.empresa_id, public.fn_proveedor_clave(c.contraparte), c.fecha desc
  ),
  cli as (
    select cc.clave, cc.rfc, cc.dias_credito, public.fn_proveedor_clave(cc.nombre) k
      from public.cxc_clientes cc where cc.grupo_id = public.auth_grupo_id()
  ),
  docs as (
    select d.orden_venta_id, d.id documento_id, coalesce(sum(a.monto), 0) cobrado
      from public.cxc_documentos d
      left join public.cxc_aplicaciones a on a.documento_id = d.id
      left join public.cxc_cobros cb on cb.id = a.cobro_id and cb.cancelado_en is null
     where d.orden_venta_id is not null and d.cancelado_en is null
     group by d.orden_venta_id, d.id
  )
  select ov.id, ov.id_ov, ov.empresa_id, ov.codigo, ov.cliente,
         coalesce(r.rfc, cli.rfc, cli.clave, 'N:' || ov.k) cliente_clave, coalesce(r.rfc, cli.rfc) cliente_rfc,
         ov.fecha_ov, round(ov.total, 2), round(coalesce(d.cobrado, 0), 2), round(ov.total - coalesce(d.cobrado, 0), 2),
         ov.proyecto, ov.fuente, ov.condicion_pago, d.documento_id, coalesce(cli.dias_credito, 30)
    from ov
    left join rfc r on r.empresa_id = ov.empresa_id and r.k = ov.k
    left join cli on cli.k = ov.k
    left join docs d on d.orden_venta_id = ov.id
   where ov.total - coalesce(d.cobrado, 0) > 0.5
   order by ov.fecha_ov desc, ov.id_ov desc
$$;
revoke all on function public.fn_cxc_ov_pendientes(uuid) from public, anon;
grant execute on function public.fn_cxc_ov_pendientes(uuid) to authenticated;

-- Registrar cobro: acepta aplicaciones {origen: 'ov', id: <orden_venta.id>, monto}.
create or replace function public.fn_cxc_registrar_cobro(p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_empresa uuid := nullif(p->>'empresa_id', '')::uuid;
  v_clave text := nullif(btrim(coalesce(p->>'cliente_clave', '')), '');
  v_monto numeric := round(nullif(p->>'monto', '')::numeric, 2);
  v_tipo text := coalesce(nullif(p->>'tipo', ''), 'deposito');
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, (now() at time zone 'America/Mexico_City')::date);
  v_cuenta uuid := nullif(p->>'cuenta_id', '')::uuid;
  v_mov uuid := nullif(p->>'movimiento_id', '')::uuid;
  v_cartera jsonb;
  v_doc jsonb;
  v_apl jsonb := '[]'::jsonb;
  r record;
  ovp record;
  v_suma numeric := 0;
  v_id uuid;
  v_doc_id uuid;
  v_nombre text;
  v_folios text[];
  v_ovs text[];
  m public.movimientos%rowtype;
begin
  if not public.auth_opera_cxc() then
    raise exception 'Solo dirección, corporativo o el administrador registran cobros' using errcode = '42501';
  end if;
  if v_empresa is null or not (v_empresa = any (public.auth_empresas_alcance())) then
    raise exception 'Elige una empresa que manejes' using errcode = '42501';
  end if;
  if v_clave is null then raise exception 'Elige el cliente'; end if;
  if v_monto is null or v_monto <= 0 then raise exception 'Captura el monto cobrado'; end if;
  if v_tipo not in ('deposito', 'ajuste') then raise exception 'Tipo de cobro inválido'; end if;
  if v_tipo = 'ajuste' and nullif(btrim(coalesce(p->>'notas', '')), '') is null then
    raise exception 'Un ajuste lleva el motivo en la nota';
  end if;
  if v_cuenta is not null and not exists (select 1 from public.cuentas_bancarias cb where cb.id = v_cuenta and cb.empresa_id = v_empresa) then
    raise exception 'La cuenta no es de esa empresa';
  end if;
  if v_mov is not null then
    select * into m from public.movimientos where id = v_mov for update;
    if not found or m.empresa_id <> v_empresa or coalesce(m.abono_total, 0) <= 0 then
      raise exception 'El depósito elegido no es un abono de esa empresa';
    end if;
    if exists (select 1 from public.cxc_cobros cb where cb.movimiento_id = v_mov and cb.cancelado_en is null) then
      raise exception 'Ese depósito ya está registrado como cobro';
    end if;
  end if;

  -- Órdenes de venta elegidas: cada una se vuelve (o ya es) un documento de la
  -- cartera ligado a la OV, y la aplicación sigue como documento manual.
  for r in
    select a->>'id' id, sum(round((a->>'monto')::numeric, 2)) monto
      from jsonb_array_elements(coalesce(p->'aplicaciones', '[]'::jsonb)) a
     where a->>'origen' = 'ov'
     group by 1
  loop
    if r.monto is null or r.monto <= 0 then continue; end if;
    select * into ovp from public.fn_cxc_ov_pendientes(v_empresa) o where o.id = r.id::uuid;
    if not found then raise exception 'Una de las órdenes de venta ya no está pendiente de pago; vuelve a cargar la pantalla'; end if;
    if r.monto > ovp.saldo + 0.01 then
      raise exception 'Se aplica más del saldo de la OV % ($%)', ovp.id_ov, ovp.saldo;
    end if;
    v_doc_id := ovp.documento_id;
    if v_doc_id is null then
      insert into public.cxc_documentos (empresa_id, tipo, folio, cliente_clave, cliente_nombre, cliente_rfc, obra, fecha, vence, total,
                                         orden_venta_id, concepto, created_by)
      values (v_empresa, 'otro', 'OV ' || ovp.id_ov, ovp.cliente_clave, ovp.cliente, ovp.cliente_rfc, ovp.proyecto,
              coalesce(ovp.fecha_ov, v_fecha), coalesce(ovp.fecha_ov, v_fecha) + ovp.dias_credito, ovp.total,
              ovp.id, 'Orden de venta ligada al registrar el cobro', auth.uid())
      returning id into v_doc_id;
    end if;
    v_suma := v_suma + r.monto;
    v_apl := v_apl || jsonb_build_object('origen', 'manual', 'id', v_doc_id, 'monto', r.monto);
    v_ovs := array_append(v_ovs, 'OV ' || ovp.id_ov);
  end loop;

  v_cartera := public.fn_cxc_cartera() -> 'documentos';
  for r in
    select a->>'origen' origen, a->>'id' id, sum(round((a->>'monto')::numeric, 2)) monto
      from jsonb_array_elements(coalesce(p->'aplicaciones', '[]'::jsonb)) a
     where a->>'origen' in ('cfdi', 'manual')
     group by 1, 2
  loop
    if r.monto is null or r.monto <= 0 then continue; end if;
    v_doc := null;
    select d into v_doc from jsonb_array_elements(v_cartera) d where d->>'id' = r.id and d->>'origen' = r.origen;
    if v_doc is null then raise exception 'Uno de los documentos ya no está por cobrar; vuelve a cargar la pantalla'; end if;
    if (v_doc->>'empresa_id')::uuid <> v_empresa or v_doc->>'cliente_clave' <> v_clave then
      raise exception 'El documento % no es de ese cliente en esa empresa', v_doc->>'folio';
    end if;
    if r.monto > (v_doc->>'saldo')::numeric + 0.01 then
      raise exception 'Se aplica más del saldo de % ($%)', v_doc->>'folio', v_doc->>'saldo';
    end if;
    v_suma := v_suma + r.monto;
    v_apl := v_apl || jsonb_build_object('origen', r.origen, 'id', r.id, 'monto', r.monto);
  end loop;
  if v_suma > v_monto + 0.01 then
    raise exception 'Lo aplicado ($%) pasa del monto del cobro ($%)', v_suma, v_monto;
  end if;

  select nombre into v_nombre from public.profiles where id = auth.uid();
  insert into public.cxc_cobros (empresa_id, cliente_clave, cliente_nombre, tipo, fecha, monto, cuenta_id, referencia,
                                 movimiento_id, notas, created_by, created_by_nombre)
  values (v_empresa, v_clave, coalesce(nullif(btrim(coalesce(p->>'cliente_nombre', '')), ''), v_clave), v_tipo, v_fecha, v_monto,
          v_cuenta, nullif(btrim(coalesce(p->>'referencia', '')), ''), v_mov,
          nullif(btrim(concat_ws(' · ', nullif(btrim(coalesce(p->>'notas', '')), ''),
                                 case when v_ovs is not null then 'Liga: ' || array_to_string(v_ovs, ', ') end)), ''),
          auth.uid(), v_nombre)
  returning id into v_id;

  insert into public.cxc_aplicaciones (cobro_id, empresa_id, cfdi_id, documento_id, monto)
  select v_id, v_empresa,
         case when a.origen = 'cfdi' then a.id::uuid end,
         case when a.origen = 'manual' then a.id::uuid end,
         a.monto
    from (select x->>'origen' origen, x->>'id' id, sum((x->>'monto')::numeric) monto
            from jsonb_array_elements(v_apl) x group by 1, 2) a
   where a.monto > 0;

  -- El depósito del banco queda conciliado con las facturas (o las OV) que cubre.
  if v_mov is not null and m.estado_clasificacion is distinct from 'resuelto' then
    select array_agg(distinct upper(c.folio)) into v_folios
      from public.cxc_aplicaciones a
      left join public.cxc_documentos d on d.id = a.documento_id
      join public.cfdi c on c.id = coalesce(a.cfdi_id, d.cfdi_id)
     where a.cobro_id = v_id;
    update public.movimientos mv
       set estado_clasificacion = 'resuelto',
           factura = case when coalesce(array_length(v_folios, 1), 0) > 0 and coalesce(mv.factura, '') !~ '^FM?- '
                          then 'FM- ' || array_to_string(v_folios, ', ') else mv.factura end,
           referencia_numero = coalesce(mv.referencia_numero, case when v_ovs is not null then array_to_string(v_ovs, ', ') end),
           nombre_razon_social = coalesce(mv.nombre_razon_social, p->>'cliente_nombre'),
           observacion = 'Cobro de ' || coalesce(p->>'cliente_nombre', v_clave) || ' registrado en cuentas por cobrar por ' || coalesce(v_nombre, 'usuario')
                         || case when v_ovs is not null then ' · ' || array_to_string(v_ovs, ', ') else '' end,
           updated_by = auth.uid(), updated_at = now()
     where mv.id = v_mov;
  end if;
  return v_id;
end;
$$;
