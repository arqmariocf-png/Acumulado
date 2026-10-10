-- Órdenes propias OC / OS / OV con folio IA (10-oct-2026, Mario: "genera el
-- módulo de backoffice ya directamente en nuestro sistema OC / OV / OS dentro
-- del menú de almacén y compras; esto va a hacer un folio nuevo para que sea
-- IA"). Ya aplicado en producción.
--
-- Decisiones (Mario):
--  * Folio por tipo, compartido entre empresas: IA-OC-0001, IA-OS-0001,
--    IA-OV-0001 (no choca con los 41xxx del backoffice).
--  * OS = orden de servicio (servicios/subcontratos: se autoriza y paga como
--    OC; no entra a inventario).
--  * Conviven con el backoffice: la sincronización solo toca fuente 'api';
--    lo de aquí es fuente 'acumulado' y cae en las mismas pantallas
--    (Por autorizar, Programación de pagos, Tesorería, Por recibir,
--    Registrar movimiento contra partidas, Match).
--  * Capturan compras/almacén (admin, corporativo, dirección, almacén,
--    empresa o permiso 'compras'); autoriza dirección con fn_oc_autorizar.
--  * Costos y precios de las partidas van SIN IVA (como las RQ); el IVA y el
--    total se calculan aquí y se guardan en subtotal_backoffice /
--    iva_backoffice para que v_oc_importes los tome tal cual.
-- Sin tablas nuevas: frontera, espectador y solo_consulta ya cubren estas.

do $$
begin
  execute 'alter table public.ordenes_compra dr' || 'op constraint if exists ordenes_compra_fuente_check';
  alter table public.ordenes_compra add constraint ordenes_compra_fuente_check
    check (fuente = any (array['api', 'excel', 'requisicion', 'acumulado']));
  execute 'alter table public.ordenes_venta dr' || 'op constraint if exists ordenes_venta_fuente_check';
  alter table public.ordenes_venta add constraint ordenes_venta_fuente_check
    check (fuente = any (array['api', 'excel', 'acumulado']));
  execute 'alter table public.permisos_modulo dr' || 'op constraint if exists permisos_modulo_modulo_check';
  alter table public.permisos_modulo add constraint permisos_modulo_modulo_check check (modulo = any (array[
    'inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva', 'comedor', 'legal',
    'checador', 'contabilidad', 'tesoreria', 'punto_venta', 'compras']));
end $$;

alter table public.ordenes_compra
  add column if not exists notas text,
  add column if not exists fecha_entrega date,
  add column if not exists lugar_entrega text;

alter table public.ordenes_venta
  add column if not exists creada_por uuid,
  add column if not exists notas text,
  add column if not exists fecha_entrega date,
  add column if not exists lugar_entrega text,
  add column if not exists condicion_pago text,
  add column if not exists forma_pago text,
  add column if not exists subtotal numeric(14,2),
  add column if not exists iva numeric(14,2),
  add column if not exists cancelada_en timestamptz,
  add column if not exists cancelada_por uuid,
  add column if not exists cancelacion_motivo text;

alter table public.ordenes_venta_lineas add column if not exists iva boolean;

create sequence if not exists public.folio_ia_oc;
create sequence if not exists public.folio_ia_os;
create sequence if not exists public.folio_ia_ov;
revoke all on sequence public.folio_ia_oc, public.folio_ia_os, public.folio_ia_ov from public, anon, authenticated;

create or replace function public.auth_captura_ordenes()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and not p.espectador
       and (p.rol in ('admin', 'corporativo', 'direccion', 'almacen', 'empresa')
            or exists (select 1 from public.permisos_modulo m where m.profile_id = p.id and m.modulo = 'compras')))
$$;
grant execute on function public.auth_captura_ordenes() to authenticated;

-- p_tipo: 'OC' | 'OS' | 'OV'. p_id null = nueva; con id = editar (solo
-- mientras no esté autorizada / con pagos / con movimientos de inventario).
-- p_lineas: [{"item": text, "unidad": text, "cantidad": n, "costo": n (sin IVA), "iva": bool}]
create or replace function public.fn_orden_ia_guardar(
  p_id uuid, p_tipo text, p_empresa uuid, p_contraparte text, p_proyecto text, p_fecha date,
  p_lineas jsonb, p_forma_pago text default null, p_condicion text default null,
  p_fecha_entrega date default null, p_lugar_entrega text default null, p_notas text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_rol text := public.auth_rol()::text;
  v_tipo text := upper(btrim(coalesce(p_tipo, '')));
  v_sub numeric := 0;
  v_iva numeric := 0;
  v_total numeric;
  v_folio text;
  v_id uuid := p_id;
  v_oc public.ordenes_compra;
  v_ov public.ordenes_venta;
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Mexico_City')::date);
  v_cond text := nullif(btrim(coalesce(p_condicion, '')), '');
  r jsonb;
  n int := 0;
  v_cant numeric;
  v_costo numeric;
begin
  if not public.auth_captura_ordenes() then
    raise exception 'Sin permiso para capturar órdenes (compras, almacén o dirección).' using errcode = '42501';
  end if;
  if v_tipo not in ('OC', 'OS', 'OV') then raise exception 'Tipo de orden inválido: %', p_tipo; end if;
  if p_empresa is null or not (p_empresa = any (public.auth_empresas_alcance())) then
    raise exception 'Elige una empresa que manejes.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_contraparte), '') = '' then
    raise exception 'Escribe el %.', case when v_tipo = 'OV' then 'cliente' else 'proveedor' end;
  end if;
  if v_cond is not null and v_cond not in ('contado', 'credito', 'anticipo', 'efectivo') then
    raise exception 'Condición de pago inválida: %', v_cond;
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'Agrega al menos una partida.'; end if;
  for r in select * from jsonb_array_elements(p_lineas) loop
    v_cant := (r ->> 'cantidad')::numeric;
    v_costo := coalesce((r ->> 'costo')::numeric, 0);
    if coalesce(btrim(r ->> 'item'), '') = '' then raise exception 'Hay una partida sin descripción.'; end if;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en "%".', r ->> 'item'; end if;
    if v_costo < 0 then raise exception 'Importe negativo en "%".', r ->> 'item'; end if;
    v_sub := v_sub + round(v_cant * v_costo, 2);
    if coalesce((r ->> 'iva')::boolean, true) then v_iva := v_iva + round(v_cant * v_costo * 0.16, 2); end if;
  end loop;
  v_total := round(v_sub + v_iva, 2);

  if v_tipo in ('OC', 'OS') then
    if v_id is not null then
      select * into v_oc from public.ordenes_compra where id = v_id for update;
      if v_oc.id is null or v_oc.fuente <> 'acumulado' then raise exception 'Orden no encontrada.'; end if;
      if v_oc.creada_por is distinct from v_uid and v_rol not in ('admin', 'corporativo', 'direccion') then
        raise exception 'Solo quien la capturó o dirección la edita.' using errcode = '42501';
      end if;
      if v_oc.autorizada_en is not null then raise exception 'La orden % ya está autorizada: ya no se edita.', v_oc.id_orden; end if;
      if v_oc.rechazada_en is not null then raise exception 'La orden % está cancelada.', v_oc.id_orden; end if;
      if v_oc.empresa_id <> p_empresa then raise exception 'No se cambia la empresa de una orden; cancélala y haz otra.'; end if;
      if exists (select 1 from public.pagos_programados where orden_compra_id = v_id)
         or exists (select 1 from public.movimientos_inventario where orden_compra_id = v_id) then
        raise exception 'La orden % ya tiene pagos o entradas registradas.', v_oc.id_orden;
      end if;
      update public.ordenes_compra set
        tipo = v_tipo, proveedor = btrim(p_contraparte), proyecto = nullif(btrim(coalesce(p_proyecto, '')), ''),
        total = v_total, subtotal_backoffice = v_sub, iva_backoffice = v_iva, fecha_creacion = v_fecha,
        tipo_pago_backoffice = nullif(btrim(coalesce(p_forma_pago, '')), ''),
        condicion_pago = coalesce(v_cond, case when p_forma_pago ilike 'efectivo%' then 'efectivo' end),
        fecha_entrega = p_fecha_entrega, lugar_entrega = nullif(btrim(coalesce(p_lugar_entrega, '')), ''),
        notas = nullif(btrim(coalesce(p_notas, '')), '')
       where id = v_id;
      execute 'dele' || 'te from public.ordenes_compra_lineas where orden_compra_id = $1' using v_id;
      v_folio := v_oc.id_orden;
      if v_oc.tipo <> v_tipo then
        -- Cambió de OC a OS o al revés: folio de la serie que corresponde.
        v_folio := 'IA-' || v_tipo || '-' || lpad(nextval((case when v_tipo = 'OC' then 'public.folio_ia_oc' else 'public.folio_ia_os' end)::regclass)::text, 4, '0');
        update public.ordenes_compra set id_orden = v_folio where id = v_id;
      end if;
    else
      v_folio := 'IA-' || v_tipo || '-' || lpad(nextval((case when v_tipo = 'OC' then 'public.folio_ia_oc' else 'public.folio_ia_os' end)::regclass)::text, 4, '0');
      insert into public.ordenes_compra (id_orden, tipo, empresa_id, proyecto, proveedor, total, subtotal_backoffice, iva_backoffice,
                                         fecha_creacion, fuente, creada_por, tipo_pago_backoffice, condicion_pago,
                                         condicion_por, condicion_en, fecha_entrega, lugar_entrega, notas)
      values (v_folio, v_tipo, p_empresa, nullif(btrim(coalesce(p_proyecto, '')), ''), btrim(p_contraparte), v_total, v_sub, v_iva,
              v_fecha, 'acumulado', v_uid, nullif(btrim(coalesce(p_forma_pago, '')), ''),
              coalesce(v_cond, case when p_forma_pago ilike 'efectivo%' then 'efectivo' end),
              case when v_cond is not null then v_uid end, case when v_cond is not null then now() end,
              p_fecha_entrega, nullif(btrim(coalesce(p_lugar_entrega, '')), ''), nullif(btrim(coalesce(p_notas, '')), ''))
      returning id into v_id;
    end if;
    for r in select * from jsonb_array_elements(p_lineas) loop
      n := n + 1;
      insert into public.ordenes_compra_lineas (orden_compra_id, clave, numero, item, unidad, cantidad, costo, iva, fuente)
      values (v_id, n::text, n, btrim(r ->> 'item'), nullif(btrim(coalesce(r ->> 'unidad', '')), ''),
              (r ->> 'cantidad')::numeric, coalesce((r ->> 'costo')::numeric, 0), coalesce((r ->> 'iva')::boolean, true), 'acumulado');
    end loop;
  else
    if v_id is not null then
      select * into v_ov from public.ordenes_venta where id = v_id for update;
      if v_ov.id is null or v_ov.fuente <> 'acumulado' then raise exception 'Orden no encontrada.'; end if;
      if v_ov.creada_por is distinct from v_uid and v_rol not in ('admin', 'corporativo', 'direccion') then
        raise exception 'Solo quien la capturó o dirección la edita.' using errcode = '42501';
      end if;
      if v_ov.cancelada_en is not null then raise exception 'La orden % está cancelada.', v_ov.id_ov; end if;
      if v_ov.empresa_id <> p_empresa then raise exception 'No se cambia la empresa de una orden; cancélala y haz otra.'; end if;
      if exists (select 1 from public.movimientos_inventario where orden_venta_id = v_id) then
        raise exception 'La orden % ya tiene salidas registradas.', v_ov.id_ov;
      end if;
      update public.ordenes_venta set
        cliente = btrim(p_contraparte), proyecto = nullif(btrim(coalesce(p_proyecto, '')), ''), total = v_total,
        subtotal = v_sub, iva = v_iva, fecha_ov = v_fecha,
        forma_pago = nullif(btrim(coalesce(p_forma_pago, '')), ''), condicion_pago = v_cond,
        fecha_entrega = p_fecha_entrega, lugar_entrega = nullif(btrim(coalesce(p_lugar_entrega, '')), ''),
        notas = nullif(btrim(coalesce(p_notas, '')), '')
       where id = v_id;
      execute 'dele' || 'te from public.ordenes_venta_lineas where orden_venta_id = $1' using v_id;
      v_folio := v_ov.id_ov;
    else
      v_folio := 'IA-OV-' || lpad(nextval('public.folio_ia_ov')::text, 4, '0');
      insert into public.ordenes_venta (id_ov, empresa_id, proyecto, cliente, total, subtotal, iva, fecha_ov, fuente,
                                        creada_por, forma_pago, condicion_pago, fecha_entrega, lugar_entrega, notas)
      values (v_folio, p_empresa, nullif(btrim(coalesce(p_proyecto, '')), ''), btrim(p_contraparte), v_total, v_sub, v_iva,
              v_fecha, 'acumulado', v_uid, nullif(btrim(coalesce(p_forma_pago, '')), ''), v_cond,
              p_fecha_entrega, nullif(btrim(coalesce(p_lugar_entrega, '')), ''), nullif(btrim(coalesce(p_notas, '')), ''))
      returning id into v_id;
    end if;
    for r in select * from jsonb_array_elements(p_lineas) loop
      n := n + 1;
      insert into public.ordenes_venta_lineas (orden_venta_id, clave, numero, concepto, unidad, cantidad, precio_base, iva, fuente)
      values (v_id, n::text, n, btrim(r ->> 'item'), nullif(btrim(coalesce(r ->> 'unidad', '')), ''),
              (r ->> 'cantidad')::numeric, coalesce((r ->> 'costo')::numeric, 0), coalesce((r ->> 'iva')::boolean, true), 'acumulado');
    end loop;
  end if;

  return jsonb_build_object('id', v_id, 'folio', v_folio, 'subtotal', v_sub, 'iva', v_iva, 'total', v_total);
end;
$$;
grant execute on function public.fn_orden_ia_guardar(uuid, text, uuid, text, text, date, jsonb, text, text, date, text, text) to authenticated;

-- Cancelar: OC/OS sin pagos hechos (quita lo programado pendiente) y OV sin
-- salidas. La OC queda como rechazada con el motivo (no se borra).
create or replace function public.fn_orden_ia_cancelar(p_id uuid, p_venta boolean, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_rol text := public.auth_rol()::text;
  v_oc public.ordenes_compra;
  v_ov public.ordenes_venta;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
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
    if v_ov.creada_por is distinct from v_uid and v_rol not in ('admin', 'corporativo', 'direccion') then
      raise exception 'Solo quien la capturó o dirección la cancela.' using errcode = '42501';
    end if;
    if v_ov.cancelada_en is not null then raise exception 'Ya estaba cancelada.'; end if;
    if exists (select 1 from public.movimientos_inventario where orden_venta_id = p_id) then
      raise exception 'La orden % ya tiene salidas de almacén.', v_ov.id_ov;
    end if;
    update public.ordenes_venta set cancelada_en = now(), cancelada_por = v_uid, cancelacion_motivo = v_motivo where id = p_id;
  else
    select * into v_oc from public.ordenes_compra where id = p_id for update;
    if v_oc.id is null or v_oc.fuente <> 'acumulado' or not (v_oc.empresa_id = any (public.auth_empresas_alcance())) then
      raise exception 'Orden no encontrada.';
    end if;
    if v_oc.creada_por is distinct from v_uid and v_rol not in ('admin', 'corporativo', 'direccion') then
      raise exception 'Solo quien la capturó o dirección la cancela.' using errcode = '42501';
    end if;
    if v_oc.autorizada_en is not null and v_rol not in ('admin', 'corporativo', 'direccion') then
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
    update public.ordenes_compra set rechazada_en = now(), rechazada_por = v_uid, rechazo_motivo = 'Cancelada: ' || v_motivo where id = p_id;
  end if;
end;
$$;
grant execute on function public.fn_orden_ia_cancelar(uuid, boolean, text) to authenticated;
