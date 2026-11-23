-- "La orden de venta pueda convertirse en orden de compra inter empresas"
-- (23-nov-2026, Mario). Hasta hoy el camino era al revés: desde una OC/OS se
-- generaba la OV de quien compró más la OC de la otra empresa
-- (fn_orden_interempresa). Ahora una OV capturada aquí (Aceros le vende a
-- Constructora) genera con un clic la OC/OS de la empresa del grupo que
-- compra, con las mismas partidas y precios s/IVA, proveedor = la que vende,
-- y queda ligada en `ordenes_compra.interempresa_ov_id`. Una OV solo genera
-- UNA compra viva (si esa OC se cancela, se puede volver a generar).
-- Ya aplicado en producción como `oc_interempresa_desde_ov`.

alter table public.ordenes_compra add column if not exists interempresa_ov_id uuid references public.ordenes_venta (id);
create index if not exists ordenes_compra_interempresa_ov_idx on public.ordenes_compra (interempresa_ov_id) where interempresa_ov_id is not null;

/** La empresa del grupo a la que se le vendió, por el nombre del cliente de
 * la OV (razón social o nombre, con fn_proveedor_clave). Null si el cliente no
 * es del grupo. */
create or replace function public.fn_empresa_por_nombre(p_grupo uuid, p_nombre text)
returns uuid language sql stable security definer set search_path = public as $$
  select e.id from public.empresas e
   where e.grupo_id = p_grupo and e.activo
     and (public.fn_proveedor_clave(coalesce(e.razon_social, '')) = public.fn_proveedor_clave(p_nombre)
          or public.fn_proveedor_clave(e.nombre) = public.fn_proveedor_clave(p_nombre))
   order by e.nombre limit 1
$$;
grant execute on function public.fn_empresa_por_nombre(uuid, text) to authenticated, service_role;

create or replace function public.fn_orden_interempresa_desde_ov(
  p_ov uuid, p_empresa_compradora uuid default null, p_tipo text default 'OC',
  p_proyecto text default null, p_forma_pago text default null, p_condicion text default null, p_notas text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ov public.ordenes_venta;
  v_vende public.empresas;
  v_compra public.empresas;
  v_compra_id uuid;
  v_lineas jsonb;
  v_oc jsonb;
  v_viva text;
begin
  if not public.auth_captura_ordenes() then
    raise exception 'Sin permiso para capturar órdenes (compras, almacén o dirección).' using errcode = '42501';
  end if;
  if p_tipo not in ('OC', 'OS') then raise exception 'El tipo debe ser OC u OS.'; end if;
  select * into v_ov from public.ordenes_venta where id = p_ov for update;
  if v_ov.id is null or not (v_ov.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'No encuentro la orden de venta o no es de una empresa que manejes.' using errcode = '42501';
  end if;
  if v_ov.cancelada_en is not null then raise exception 'La orden de venta % está cancelada.', v_ov.id_ov; end if;

  select oc.id_orden into v_viva from public.ordenes_compra oc
   where oc.interempresa_ov_id = v_ov.id and oc.rechazada_en is null and coalesce(oc.estatus_backoffice, '') not ilike 'cancel%' limit 1;
  if v_viva is not null then
    raise exception 'La OV % ya generó la compra inter empresa % (cancélala si quieres volver a generarla).', v_ov.id_ov, v_viva;
  end if;

  select * into v_vende from public.empresas where id = v_ov.empresa_id;
  v_compra_id := coalesce(p_empresa_compradora, public.fn_empresa_por_nombre(v_vende.grupo_id, v_ov.cliente));
  if v_compra_id is null then
    raise exception 'El cliente "%" no es una empresa del grupo: elige cuál compra.', v_ov.cliente;
  end if;
  select * into v_compra from public.empresas where id = v_compra_id;
  if v_compra.id is null or v_compra.grupo_id is distinct from v_vende.grupo_id then
    raise exception 'Elige la empresa que compra (del mismo grupo).';
  end if;
  if v_compra.id = v_vende.id then raise exception 'La empresa que compra debe ser otra distinta de %.', v_vende.codigo; end if;
  if not (v_compra.id = any (public.auth_empresas_alcance())) then
    raise exception 'No manejas la empresa % para capturarle la compra.', v_compra.codigo using errcode = '42501';
  end if;

  -- Partidas de la OV: las propias ya van s/IVA; las del backoffice traen el precio con IVA.
  select jsonb_agg(jsonb_build_object(
           'item', l.concepto, 'unidad', l.unidad, 'cantidad', l.cantidad,
           'costo', round(case when v_ov.fuente in ('api', 'excel') and coalesce(l.iva, true) then l.precio_base / 1.16 else l.precio_base end, 2),
           'iva', coalesce(l.iva, true)) order by l.numero, l.created_at)
    into v_lineas
    from public.ordenes_venta_lineas l
   where l.orden_venta_id = v_ov.id and coalesce(l.cantidad, 0) > 0 and coalesce(btrim(l.concepto), '') <> '';
  if v_lineas is null or jsonb_array_length(v_lineas) = 0 then
    raise exception 'La OV % no tiene partidas.', v_ov.id_ov;
  end if;

  v_oc := public.fn_orden_ia_guardar(
    null, p_tipo, v_compra.id, coalesce(nullif(btrim(v_vende.razon_social), ''), v_vende.nombre),
    coalesce(nullif(btrim(p_proyecto), ''), v_ov.proyecto), null, v_lineas,
    coalesce(p_forma_pago, v_ov.forma_pago, 'Transferencia electrónica de fondos'),
    coalesce(p_condicion, case when v_ov.condicion_pago in ('contado', 'credito', 'anticipo') then v_ov.condicion_pago end, 'credito'),
    v_ov.fecha_entrega, v_ov.lugar_entrega,
    concat_ws(' · ', format('Inter empresa: compra generada desde la OV %s de %s', v_ov.id_ov, v_vende.codigo), nullif(btrim(coalesce(p_notas, '')), '')));
  update public.ordenes_compra set interempresa_ov_id = v_ov.id where id = (v_oc ->> 'id')::uuid;
  return jsonb_build_object('oc', v_oc, 'ov', v_ov.id_ov, 'compra', v_compra.codigo, 'vende', v_vende.codigo);
end $$;
grant execute on function public.fn_orden_interempresa_desde_ov(uuid, uuid, text, text, text, text, text) to authenticated;

/** Para la lista de OV: qué compra inter empresa viva tiene cada una. */
create or replace function public.fn_interempresa_ov_estado()
returns table (ov_id uuid, oc_id uuid, oc_folio text, oc_empresa_id uuid)
language sql stable security definer set search_path = public as $$
  select oc.interempresa_ov_id, oc.id, oc.id_orden, oc.empresa_id
    from public.ordenes_compra oc
   where oc.interempresa_ov_id is not null and oc.rechazada_en is null and coalesce(oc.estatus_backoffice, '') not ilike 'cancel%'
     and oc.empresa_id = any (public.auth_empresas_organizacion())
$$;
grant execute on function public.fn_interempresa_ov_estado() to authenticated;
