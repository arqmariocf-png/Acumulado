-- Las OC del backoffice "Pendiente de Autorización" se autorizan aquí
-- (Laura, 30-sep-2026: "pedí que salieran las pendientes de autorización
-- para programar pago y no me salen, por ende no puedo hacer nada").
-- Eran 40 OC por $1.64 M que no aparecían en ninguna lista y
-- fn_oc_programar_pago las rechazaba.
--
-- * fn_oc_autorizar acepta fuente 'api' solo si el backoffice dice
--   "Pendiente de Autorización": registra autorizada_en/_por aquí (no crea
--   pago; se programa después con su condición). Rechazar la deja
--   rechazada con motivo (no se borra: la sincronización la volvería a traer).
-- * v_oc_pagos.autorizacion: una api pendiente autorizada aquí cuenta como
--   autorizada; fn_oc_programar_pago igual.
-- * v_cxp_proveedores cuenta como comprometidas las autorizadas aquí.
-- La sincronización no toca autorizada_en / rechazada_en. Allá (backoffice)
-- sigue pendiente hasta que alguien la autorice en su sistema.

create or replace function public.fn_oc_autorizar(p_oc_id uuid, p_autorizar boolean, p_motivo text default null, p_fecha_pago date default null, p_cuenta_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_oc public.ordenes_compra%rowtype;
  v_pago uuid;
  r record;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then
    raise exception 'Solo dirección autoriza órdenes de compra' using errcode = '42501';
  end if;
  select * into v_oc from public.ordenes_compra where id = p_oc_id;
  if v_oc.id is null then raise exception 'Orden no encontrada'; end if;
  if v_oc.fuente = 'api' and coalesce(v_oc.estatus_backoffice, '') <> 'Pendiente de Autorización' then
    raise exception 'La orden % ya viene autorizada del backoffice (%)', v_oc.id_orden, coalesce(v_oc.estatus_backoffice, 'sin estatus');
  end if;
  if not public.empresa_en_alcance(v_oc.empresa_id) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  if v_oc.autorizada_en is not null then raise exception 'Esta orden ya fue autorizada'; end if;

  if p_autorizar then
    if v_oc.fuente = 'requisicion' then
      insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, referencia, notas, created_by, orden_compra_id)
      values (v_oc.empresa_id, p_cuenta_id, coalesce(v_oc.proveedor, 'Proveedor'),
        'OC ' || v_oc.id_orden || coalesce(' · ' || v_oc.proyecto, ''), coalesce(v_oc.total, 0),
        coalesce(p_fecha_pago, current_date + 7), v_oc.id_orden, 'Generado al autorizar la orden ' || v_oc.id_orden, v_uid, p_oc_id)
      returning id into v_pago;
    end if;
    update public.ordenes_compra set autorizada_en = now(), autorizada_por = v_uid, rechazada_en = null, rechazada_por = null, rechazo_motivo = null,
      pago_programado_id = coalesce(v_pago, pago_programado_id),
      condicion_pago = coalesce(condicion_pago, case when v_oc.tipo_pago_backoffice ilike 'efectivo%' then 'efectivo' else 'contado' end),
      condicion_por = coalesce(condicion_por, v_uid), condicion_en = coalesce(condicion_en, now())
      where id = p_oc_id;
    for r in
      select distinct req.id, req.etapa
      from public.necesidades_compra nc
      join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
      join public.requisiciones req on req.id = rl.requisicion_id
      where nc.orden_compra_id = p_oc_id
    loop
      if r.etapa = 'solicitada' then
        update public.requisiciones set etapa = 'autorizada', etapa_en = now(), etapa_por = v_uid where id = r.id;
        insert into public.requisicion_etapas (requisicion_id, etapa, etapa_anterior, actor_id, actor_nombre, nota)
        values (r.id, 'autorizada', 'solicitada', v_uid, (select nombre from public.profiles where id = v_uid), 'Orden ' || v_oc.id_orden || ' autorizada');
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'pago_programado_id', v_pago);
  elsif v_oc.fuente = 'requisicion' then
    update public.necesidades_compra
      set estado = 'pendiente', orden_compra_id = null, vinculado_por = null, vinculado_at = null,
          cotizacion_nota = concat_ws(' · ', nullif(cotizacion_nota, ''), 'Rechazada por dirección: ' || coalesce(nullif(trim(p_motivo), ''), 'sin motivo'))
      where orden_compra_id = p_oc_id;
    delete from public.pagos_programados where orden_compra_id = p_oc_id and estatus = 'pendiente';
    delete from public.ordenes_compra_lineas where orden_compra_id = p_oc_id;
    delete from public.ordenes_compra where id = p_oc_id;
    return jsonb_build_object('ok', true, 'rechazada', true);
  else
    update public.ordenes_compra set rechazada_en = now(), rechazada_por = v_uid, rechazo_motivo = nullif(trim(coalesce(p_motivo, '')), '') where id = p_oc_id;
    delete from public.pagos_programados where orden_compra_id = p_oc_id and estatus = 'pendiente';
    return jsonb_build_object('ok', true, 'rechazada', true);
  end if;
end;
$function$;

create or replace function public.fn_oc_programar_pago(p_oc_id uuid, p_condicion text, p_monto numeric default null, p_fecha date default null, p_cuenta_id uuid default null, p_notas text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_oc public.ordenes_compra%rowtype;
  v_pagado numeric;
  v_saldo numeric;
  v_monto numeric;
  v_fecha date;
  v_dias int;
  v_pago uuid;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then raise exception 'Solo dirección programa pagos' using errcode = '42501'; end if;
  if p_condicion not in ('contado', 'credito', 'anticipo', 'efectivo') then raise exception 'Condición no válida: %', p_condicion; end if;
  select * into v_oc from public.ordenes_compra where id = p_oc_id;
  if v_oc.id is null then raise exception 'Orden no encontrada'; end if;
  if not public.empresa_en_alcance(v_oc.empresa_id) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  if v_oc.rechazada_en is not null then raise exception 'La orden % está rechazada; no se programa pago', v_oc.id_orden; end if;
  if v_oc.fuente = 'api' and v_oc.estatus_backoffice = 'Cancelada' then raise exception 'La orden % está cancelada en el backoffice', v_oc.id_orden; end if;
  if v_oc.fuente = 'api' and v_oc.estatus_backoffice = 'Pendiente de Autorización' and v_oc.autorizada_en is null then
    raise exception 'La orden % está pendiente de autorización; autorízala primero en "Por autorizar"', v_oc.id_orden;
  end if;
  if v_oc.fuente <> 'api' and v_oc.autorizada_en is null then raise exception 'La orden % está pendiente de autorización; autorízala primero', v_oc.id_orden; end if;
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_programados where orden_compra_id = p_oc_id and estatus = 'pagado';
  v_saldo := coalesce(v_oc.total, 0) - v_pagado;
  v_monto := coalesce(p_monto, v_saldo);
  if v_monto <= 0 then raise exception 'La orden no tiene saldo pendiente'; end if;
  if v_monto > v_saldo + 0.01 then raise exception 'El monto (%) rebasa el saldo pendiente de la orden (%)', v_monto, v_saldo; end if;
  select dias_credito into v_dias from public.proveedores_credito where clave = public.fn_proveedor_clave(v_oc.proveedor);
  v_fecha := coalesce(p_fecha, case when p_condicion = 'credito' then coalesce(v_oc.fecha_creacion, v_oc.created_at::date, current_date) + coalesce(v_dias, 30) else current_date end);
  if v_fecha < current_date then v_fecha := current_date; end if;

  update public.ordenes_compra set condicion_pago = p_condicion, condicion_por = v_uid, condicion_en = now() where id = p_oc_id;
  insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, referencia, notas, created_by, orden_compra_id, metodo)
  values (v_oc.empresa_id, case when p_condicion = 'efectivo' then null else p_cuenta_id end, coalesce(v_oc.proveedor, 'Proveedor'),
    case p_condicion when 'anticipo' then 'Anticipo OC ' when 'efectivo' then 'Efectivo OC ' else 'OC ' end || v_oc.id_orden || coalesce(' · ' || v_oc.proyecto, ''),
    round(v_monto, 2), v_fecha, v_oc.id_orden, nullif(trim(coalesce(p_notas, '')), ''), v_uid, p_oc_id,
    case when p_condicion = 'efectivo' then 'efectivo' else 'transferencia' end)
  returning id into v_pago;
  if v_oc.fuente = 'requisicion' and v_oc.pago_programado_id is null then
    update public.ordenes_compra set pago_programado_id = v_pago where id = p_oc_id;
  end if;
  return v_pago;
end;
$function$;

create or replace view public.v_oc_pagos with (security_invoker = true) as
 SELECT oc.id,
    oc.id_orden,
    oc.empresa_id,
    oc.proveedor,
    oc.proyecto,
    oc.total,
    oc.fecha_creacion,
    oc.fuente,
    oc.condicion_pago,
    oc.autorizada_en,
    COALESCE(pg.pagado, (0)::numeric) AS pagado,
    COALESCE(pg.programado, (0)::numeric) AS programado,
    (COALESCE(oc.total, (0)::numeric) - COALESCE(pg.pagado, (0)::numeric)) AS saldo,
    pg.ultimo_pago,
    pg.proximo_pago,
    cr.clave AS proveedor_clave,
    cr.linea_credito,
    cr.dias_credito,
    cr.vencimiento AS credito_vencimiento,
        CASE
            WHEN (oc.rechazada_en IS NOT NULL) THEN 'rechazada'::text
            WHEN ((oc.fuente = 'api'::text) AND (oc.estatus_backoffice = 'Cancelada'::text)) THEN 'rechazada'::text
            WHEN (oc.autorizada_en IS NOT NULL) THEN 'autorizada'::text
            WHEN ((oc.fuente = 'api'::text) AND (oc.estatus_backoffice = 'Pendiente de Autorización'::text)) THEN 'pendiente'::text
            WHEN (oc.fuente = 'api'::text) THEN 'autorizada'::text
            ELSE 'pendiente'::text
        END AS autorizacion,
        CASE
            WHEN ((oc.condicion_pago = 'credito'::text) OR ((oc.condicion_pago IS NULL) AND (cr.dias_credito IS NOT NULL))) THEN (COALESCE(oc.fecha_creacion, (oc.created_at)::date) + COALESCE(cr.dias_credito, 30))
            ELSE NULL::date
        END AS vence,
    ((oc.condicion_pago = 'credito'::text) OR ((oc.condicion_pago IS NULL) AND (cr.dias_credito IS NOT NULL))) AS es_credito,
    oc.rechazo_motivo,
    fn_proveedor_clave(oc.proveedor) AS clave,
    db.beneficiario AS beneficiario_bancario,
    db.banco AS banco_proveedor,
    db.clabe,
    db.cuenta AS cuenta_proveedor,
    oc.estatus_backoffice,
    oc.tipo_pago_backoffice,
    ((oc.fuente = 'api'::text) AND (oc.estatus_backoffice = ANY (ARRAY['Pendiente Factura'::text, 'Pendiente Comprobante'::text, 'Completada'::text]))) AS pagada_backoffice,
    oc.tipo,
    oc.recibida_en,
    oc.recibida_lugar,
    COALESCE(rec.n_lineas, (0)::bigint) AS n_lineas,
    COALESCE(rec.pendientes, (0)::numeric) AS cantidad_pendiente,
        CASE
            WHEN (oc.recibida_en IS NOT NULL) THEN 'recibida'::text
            WHEN (COALESCE(rec.n_lineas, (0)::bigint) = 0) THEN 'sin_partidas'::text
            WHEN (rec.n_completas = rec.n_lineas) THEN 'recibida'::text
            WHEN ((rec.n_completas > 0) OR (rec.n_parciales > 0)) THEN 'parcial'::text
            ELSE 'sin_recibir'::text
        END AS recepcion_estado
   FROM ((((ordenes_compra oc
     LEFT JOIN LATERAL ( SELECT sum(p.monto) FILTER (WHERE (p.estatus = 'pagado'::text)) AS pagado,
            sum(p.monto) FILTER (WHERE (p.estatus = 'pendiente'::text)) AS programado,
            max(p.pagado_en) FILTER (WHERE (p.estatus = 'pagado'::text)) AS ultimo_pago,
            min(p.fecha_programada) FILTER (WHERE (p.estatus = 'pendiente'::text)) AS proximo_pago
           FROM pagos_programados p
          WHERE (p.orden_compra_id = oc.id)) pg ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) AS n_lineas,
            count(*) FILTER (WHERE (x.estado = 'completo'::text)) AS n_completas,
            count(*) FILTER (WHERE (x.estado = 'parcial'::text)) AS n_parciales,
            sum(x.pendiente) AS pendientes
           FROM v_oc_recepcion x
          WHERE (x.orden_compra_id = oc.id)) rec ON (true))
     LEFT JOIN proveedores_credito cr ON ((cr.clave = fn_proveedor_clave(oc.proveedor))))
     LEFT JOIN proveedores_datos_bancarios db ON ((db.clave = fn_proveedor_clave(oc.proveedor))));

create or replace view public.v_cxp_proveedores with (security_invoker = true) as
 WITH oc AS (
         SELECT fn_proveedor_clave(ordenes_compra.proveedor) AS clave,
            min(ordenes_compra.proveedor) AS nombre,
            count(*) AS n_oc,
            sum(ordenes_compra.total) AS comprometido,
            max(ordenes_compra.fecha_creacion) AS ultima_oc,
            array_agg(DISTINCT ordenes_compra.empresa_id) AS empresas
           FROM ordenes_compra
          WHERE ((fn_proveedor_clave(ordenes_compra.proveedor) IS NOT NULL) AND (fn_proveedor_clave(ordenes_compra.proveedor) <> 'TOTAL'::text) AND (ordenes_compra.rechazada_en IS NULL)
            AND (COALESCE(ordenes_compra.estatus_backoffice, ''::text) <> 'Cancelada'::text)
            AND ((COALESCE(ordenes_compra.estatus_backoffice, ''::text) <> 'Pendiente de Autorización'::text) OR (ordenes_compra.autorizada_en IS NOT NULL)))
          GROUP BY (fn_proveedor_clave(ordenes_compra.proveedor))
        ), fac AS (
         SELECT fn_proveedor_clave(cfdi.contraparte) AS clave,
            min(cfdi.contraparte) AS nombre,
            count(*) FILTER (WHERE (NOT COALESCE(cfdi.es_complemento_pago, false))) AS n_facturas,
            sum(cfdi.total) FILTER (WHERE (NOT COALESCE(cfdi.es_complemento_pago, false))) AS facturado,
            sum(cfdi.total) FILTER (WHERE COALESCE(cfdi.es_complemento_pago, false)) AS pagado_complementos,
            max(cfdi.fecha) FILTER (WHERE (NOT COALESCE(cfdi.es_complemento_pago, false))) AS ultima_factura,
            array_agg(DISTINCT cfdi.empresa_id) AS empresas
           FROM cfdi
          WHERE ((cfdi.tipo = 'recibido'::text) AND (fn_proveedor_clave(cfdi.contraparte) IS NOT NULL))
          GROUP BY (fn_proveedor_clave(cfdi.contraparte))
        ), pag AS (
         SELECT fn_proveedor_clave(movimientos.nombre_razon_social) AS clave,
            sum(movimientos.cargo_total) AS pagado_bancos,
            max(movimientos.fecha_pago) AS ultimo_pago
           FROM movimientos
          WHERE ((movimientos.cargo_total > (0)::numeric) AND (fn_proveedor_clave(movimientos.nombre_razon_social) IS NOT NULL))
          GROUP BY (fn_proveedor_clave(movimientos.nombre_razon_social))
        )
 SELECT COALESCE(oc.clave, fac.clave) AS clave,
    COALESCE(cr.nombre, fac.nombre, oc.nombre) AS proveedor,
    COALESCE(oc.n_oc, (0)::bigint) AS n_oc,
    COALESCE(oc.comprometido, (0)::numeric) AS comprometido,
    COALESCE(fac.n_facturas, (0)::bigint) AS n_facturas,
    COALESCE(fac.facturado, (0)::numeric) AS facturado,
    (COALESCE(fac.pagado_complementos, (0)::numeric) + COALESCE(pag.pagado_bancos, (0)::numeric)) AS pagado,
    GREATEST(((COALESCE(fac.facturado, (0)::numeric) - COALESCE(fac.pagado_complementos, (0)::numeric)) - COALESCE(pag.pagado_bancos, (0)::numeric)), (0)::numeric) AS por_pagar,
    GREATEST((COALESCE(oc.comprometido, (0)::numeric) - COALESCE(fac.facturado, (0)::numeric)), (0)::numeric) AS sin_facturar,
    cr.linea_credito,
    cr.dias_credito,
    cr.notas,
    cr.vencimiento,
        CASE
            WHEN (cr.linea_credito IS NULL) THEN NULL::numeric
            ELSE (cr.linea_credito - GREATEST(((COALESCE(fac.facturado, (0)::numeric) - COALESCE(fac.pagado_complementos, (0)::numeric)) - COALESCE(pag.pagado_bancos, (0)::numeric)), (0)::numeric))
        END AS disponible,
    oc.ultima_oc,
    fac.ultima_factura,
    pag.ultimo_pago,
    ( SELECT array_agg(DISTINCT e.e) AS array_agg
           FROM unnest((COALESCE(oc.empresas, '{}'::uuid[]) || COALESCE(fac.empresas, '{}'::uuid[]))) e(e)) AS empresas
   FROM (((oc
     FULL JOIN fac ON ((fac.clave = oc.clave)))
     LEFT JOIN pag ON ((pag.clave = COALESCE(oc.clave, fac.clave))))
     LEFT JOIN proveedores_credito cr ON ((cr.clave = COALESCE(oc.clave, fac.clave))));
