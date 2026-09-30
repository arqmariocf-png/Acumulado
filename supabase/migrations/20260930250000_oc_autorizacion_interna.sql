-- Autorización interna sin depender del backoffice (Mario, 30-sep-2026:
-- "habilita la autorización nuestra, ya interna, para no depender de
-- backoffice; solo dale un diferenciador y que no pare el flujo").
-- * fn_oc_programar_pago: programar el pago de una OC pendiente (backoffice
--   "Pendiente de Autorización", RQ o Excel) la autoriza internamente en
--   ese mismo paso; la requisición ligada pasa a 'autorizada'.
-- * v_oc_pagos.autorizacion_origen: 'backoffice' (autorizada allá) o
--   'interna' (autorizada aquí), el diferenciador en pantalla y en la OC.

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
  -- Programar el pago de una orden pendiente la autoriza internamente
  -- (Mario, 30-sep-2026: "que no pare el flujo"; no depender del backoffice).
  if v_oc.autorizada_en is null and not (v_oc.fuente = 'api' and coalesce(v_oc.estatus_backoffice, '') <> 'Pendiente de Autorización') then
    update public.ordenes_compra set autorizada_en = now(), autorizada_por = v_uid, rechazada_en = null, rechazada_por = null, rechazo_motivo = null where id = p_oc_id;
    insert into public.requisicion_etapas (requisicion_id, etapa, etapa_anterior, actor_id, actor_nombre, nota)
      select distinct req.id, 'autorizada', 'solicitada', v_uid, (select nombre from public.profiles where id = v_uid), 'Orden ' || v_oc.id_orden || ' autorizada al programar su pago'
      from public.necesidades_compra nc
      join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
      join public.requisiciones req on req.id = rl.requisicion_id
      where nc.orden_compra_id = p_oc_id and req.etapa = 'solicitada';
    update public.requisiciones req set etapa = 'autorizada', etapa_en = now(), etapa_por = v_uid
      where req.etapa = 'solicitada' and req.id in (
        select rl.requisicion_id from public.necesidades_compra nc join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id where nc.orden_compra_id = p_oc_id);
  end if;
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
        END AS recepcion_estado,
        CASE
            WHEN (oc.rechazada_en IS NOT NULL) THEN NULL::text
            WHEN ((oc.fuente = 'api'::text) AND (COALESCE(oc.estatus_backoffice, ''::text) <> ALL (ARRAY['Pendiente de Autorización'::text, 'Cancelada'::text]))) THEN 'backoffice'::text
            WHEN (oc.autorizada_en IS NOT NULL) THEN 'interna'::text
            ELSE NULL::text
        END AS autorizacion_origen
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

