-- Cuentas por pagar por empresa y OC confirmadas como pagadas aquí
-- (Mario con Laura, 6-oct-2026):
--  1. "Cemex son líneas independientes por empresa, así como los
--     vencimientos": proveedores_credito pasa de una línea por proveedor a
--     una por (empresa, proveedor). Las 4 líneas que ya había quedan en la
--     empresa donde ese proveedor tiene más compra; las demás empresas se
--     capturan aparte.
--  2. "Muchas OC falta confirmarlas de pagado, no se hizo en el backoffice;
--     tráelas aquí confirmadas para cuadrar cuentas por pagar":
--     fn_oc_confirmar_pagadas deja pagado (y confirmado) lo que falte de
--     cada OC, con una sola fecha/referencia; el comprobante se sube después
--     a todos los pagos de una vez (edge pagos-comprobante, pagoIds).
--     v_cxp_proveedores ahora cuenta lo pagado por OC (pagos de aquí +
--     OC que el backoffice ya da por pagadas) y trae el saldo por OC.
--
-- Ya aplicado en producción.

-- 1. Línea de crédito por empresa ------------------------------------------
alter table public.proveedores_credito add column if not exists empresa_id uuid references public.empresas(id);
alter table public.proveedores_credito add column if not exists id uuid not null default gen_random_uuid();

update public.proveedores_credito c set empresa_id = x.empresa_id
from (
  select distinct on (public.fn_proveedor_clave(oc.proveedor)) public.fn_proveedor_clave(oc.proveedor) as clave, oc.empresa_id
  from public.ordenes_compra oc
  where public.fn_proveedor_clave(oc.proveedor) is not null
  group by public.fn_proveedor_clave(oc.proveedor), oc.empresa_id
  order by public.fn_proveedor_clave(oc.proveedor), sum(oc.total) desc nulls last
) x
where x.clave = c.clave and c.empresa_id is null;
-- Sin ninguna OC: a la primera empresa de su organización.
update public.proveedores_credito c set empresa_id = (select e.id from public.empresas e where e.grupo_id = c.grupo_id order by e.codigo limit 1)
where c.empresa_id is null;
delete from public.proveedores_credito where empresa_id is null;

alter table public.proveedores_credito alter column empresa_id set not null;
alter table public.proveedores_credito drop constraint if exists proveedores_credito_pkey;
alter table public.proveedores_credito add primary key (id);
create unique index if not exists proveedores_credito_empresa_clave_uk on public.proveedores_credito (empresa_id, clave);

-- La organización sale de la empresa.
create or replace function public.proveedores_credito_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select e.grupo_id into new.grupo_id from public.empresas e where e.id = new.empresa_id;
  if new.grupo_id is null then select grupo_id into new.grupo_id from public.profiles where id = auth.uid(); end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

alter policy proveedores_credito_select on public.proveedores_credito
  using ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'empresa', 'almacen']::app_rol[])
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
alter policy proveedores_credito_write on public.proveedores_credito
  using ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion']::app_rol[])
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
  with check ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion']::app_rol[])
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));

-- 2. Cuentas por pagar por empresa y proveedor ------------------------------
-- Vista nueva (v_cxp_empresa): en producción el DROP de la anterior se
-- quedaba colgado; la anterior se deja de usar y se borra después.
create or replace view public.v_cxp_empresa with (security_invoker = true) as
with oc as (
  select o.empresa_id,
         public.fn_proveedor_clave(o.proveedor) as clave,
         min(o.proveedor) as nombre,
         count(*) as n_oc,
         sum(o.total) as comprometido,
         max(o.fecha_creacion) as ultima_oc,
         -- Pagado por OC: lo registrado aquí, o la OC completa si el
         -- backoffice ya la da por pagada (Pendiente Factura / Comprobante /
         -- Completada). Nunca más que el total de la OC.
         sum(least(coalesce(o.total, 0),
                   case when o.fuente = 'api' and o.estatus_backoffice in ('Pendiente Factura', 'Pendiente Comprobante', 'Completada')
                        then coalesce(o.total, 0) else coalesce(pg.pagado, 0) end)) as pagado_oc,
         count(*) filter (where not (o.fuente = 'api' and coalesce(o.estatus_backoffice, '') in ('Pendiente Factura', 'Pendiente Comprobante', 'Completada'))
                            and coalesce(pg.pagado, 0) < coalesce(o.total, 0) - 0.01) as n_oc_por_pagar
  from public.ordenes_compra o
  left join lateral (
    select sum(p.monto) filter (where p.estatus = 'pagado') as pagado
    from public.pagos_programados p where p.orden_compra_id = o.id
  ) pg on true
  where public.fn_proveedor_clave(o.proveedor) is not null
    and public.fn_proveedor_clave(o.proveedor) <> 'TOTAL'
    and o.rechazada_en is null
    and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
    and (coalesce(o.estatus_backoffice, '') <> 'Pendiente de Autorización' or o.autorizada_en is not null)
  group by o.empresa_id, public.fn_proveedor_clave(o.proveedor)
), fac as (
  select c.empresa_id,
         public.fn_proveedor_clave(c.contraparte) as clave,
         min(c.contraparte) as nombre,
         count(*) filter (where not coalesce(c.es_complemento_pago, false)) as n_facturas,
         sum(c.total) filter (where not coalesce(c.es_complemento_pago, false)) as facturado,
         sum(c.total) filter (where coalesce(c.es_complemento_pago, false)) as pagado_complementos,
         max(c.fecha) filter (where not coalesce(c.es_complemento_pago, false)) as ultima_factura
  from public.cfdi c
  where c.tipo = 'recibido' and public.fn_proveedor_clave(c.contraparte) is not null
  group by c.empresa_id, public.fn_proveedor_clave(c.contraparte)
), pag as (
  select m.empresa_id,
         public.fn_proveedor_clave(m.nombre_razon_social) as clave,
         sum(m.cargo_total) as pagado_bancos,
         max(m.fecha_pago) as ultimo_pago
  from public.movimientos m
  where m.cargo_total > 0 and public.fn_proveedor_clave(m.nombre_razon_social) is not null
  group by m.empresa_id, public.fn_proveedor_clave(m.nombre_razon_social)
), base as (
  select coalesce(oc.empresa_id, fac.empresa_id) as empresa_id,
         coalesce(oc.clave, fac.clave) as clave,
         coalesce(fac.nombre, oc.nombre) as nombre,
         coalesce(oc.n_oc, 0) as n_oc,
         coalesce(oc.comprometido, 0) as comprometido,
         coalesce(oc.pagado_oc, 0) as pagado_oc,
         coalesce(oc.n_oc_por_pagar, 0) as n_oc_por_pagar,
         coalesce(fac.n_facturas, 0) as n_facturas,
         coalesce(fac.facturado, 0) as facturado,
         coalesce(fac.pagado_complementos, 0) + coalesce(pag.pagado_bancos, 0) as pagado_detectado,
         oc.ultima_oc, fac.ultima_factura, pag.ultimo_pago
  from oc
  full join fac on fac.clave = oc.clave and fac.empresa_id = oc.empresa_id
  left join pag on pag.clave = coalesce(oc.clave, fac.clave) and pag.empresa_id = coalesce(oc.empresa_id, fac.empresa_id)
), calc as (
  select b.*,
         -- Lo pagado por OC y lo detectado en banco/complementos suelen ser el
         -- mismo dinero: se toma el mayor, no la suma.
         greatest(b.pagado_oc, b.pagado_detectado) as pagado,
         greatest(b.comprometido - b.pagado_oc, 0) as saldo_oc
  from base b
)
select c.empresa_id,
       c.clave,
       coalesce(cr.nombre, c.nombre) as proveedor,
       c.n_oc,
       c.comprometido,
       c.n_facturas,
       c.facturado,
       c.pagado,
       greatest(c.facturado - c.pagado, 0) as por_pagar,
       greatest(c.comprometido - c.facturado, 0) as sin_facturar,
       cr.linea_credito,
       cr.dias_credito,
       cr.notas,
       cr.vencimiento,
       -- Lo que se debe para la línea: lo facturado sin pagar o el saldo de
       -- las OC, lo que sea mayor (hay OC que se deben antes de facturarse).
       greatest(c.facturado - c.pagado, c.saldo_oc, 0) as deuda,
       case when cr.linea_credito is null then null
            else cr.linea_credito - greatest(c.facturado - c.pagado, c.saldo_oc, 0) end as disponible,
       c.ultima_oc,
       c.ultima_factura,
       c.ultimo_pago,
       array[c.empresa_id] as empresas,
       c.pagado_oc,
       c.saldo_oc,
       c.n_oc_por_pagar,
       c.pagado_detectado
from calc c
left join public.proveedores_credito cr on cr.clave = c.clave and cr.empresa_id = c.empresa_id;

-- 3. v_oc_pagos: la línea de la empresa de la OC ----------------------------
create or replace view public.v_oc_pagos with (security_invoker = true) as
select oc.id,
    oc.id_orden,
    oc.empresa_id,
    oc.proveedor,
    oc.proyecto,
    oc.total,
    oc.fecha_creacion,
    oc.fuente,
    oc.condicion_pago,
    oc.autorizada_en,
    coalesce(pg.pagado, 0::numeric) as pagado,
    coalesce(pg.programado, 0::numeric) as programado,
    coalesce(oc.total, 0::numeric) - coalesce(pg.pagado, 0::numeric) as saldo,
    pg.ultimo_pago,
    pg.proximo_pago,
    cr.clave as proveedor_clave,
    cr.linea_credito,
    cr.dias_credito,
    cr.vencimiento as credito_vencimiento,
    case
        when oc.rechazada_en is not null then 'rechazada'::text
        when oc.fuente = 'api'::text and oc.estatus_backoffice = 'Cancelada'::text then 'rechazada'::text
        when oc.autorizada_en is not null then 'autorizada'::text
        when oc.fuente = 'api'::text and oc.estatus_backoffice = 'Pendiente de Autorización'::text then 'pendiente'::text
        when oc.fuente = 'api'::text then 'autorizada'::text
        else 'pendiente'::text
    end as autorizacion,
    case
        when oc.condicion_pago = 'credito'::text or (oc.condicion_pago is null and cr.dias_credito is not null) then coalesce(oc.fecha_creacion, oc.created_at::date) + coalesce(cr.dias_credito, 30)
        else null::date
    end as vence,
    (oc.condicion_pago = 'credito'::text or (oc.condicion_pago is null and cr.dias_credito is not null)) as es_credito,
    oc.rechazo_motivo,
    public.fn_proveedor_clave(oc.proveedor) as clave,
    db.beneficiario as beneficiario_bancario,
    db.banco as banco_proveedor,
    db.clabe,
    db.cuenta as cuenta_proveedor,
    oc.estatus_backoffice,
    oc.tipo_pago_backoffice,
    (oc.fuente = 'api'::text and (oc.estatus_backoffice = any (array['Pendiente Factura'::text, 'Pendiente Comprobante'::text, 'Completada'::text]))) as pagada_backoffice,
    oc.tipo,
    oc.recibida_en,
    oc.recibida_lugar,
    coalesce(rec.n_lineas, 0::bigint) as n_lineas,
    coalesce(rec.pendientes, 0::numeric) as cantidad_pendiente,
    case
        when oc.recibida_en is not null then 'recibida'::text
        when coalesce(rec.n_lineas, 0::bigint) = 0 then 'sin_partidas'::text
        when rec.n_completas = rec.n_lineas then 'recibida'::text
        when rec.n_completas > 0 or rec.n_parciales > 0 then 'parcial'::text
        else 'sin_recibir'::text
    end as recepcion_estado,
    case
        when oc.rechazada_en is not null then null::text
        when oc.fuente = 'api'::text and (coalesce(oc.estatus_backoffice, ''::text) <> all (array['Pendiente de Autorización'::text, 'Cancelada'::text])) then 'backoffice'::text
        when oc.autorizada_en is not null then 'interna'::text
        else null::text
    end as autorizacion_origen
from public.ordenes_compra oc
left join lateral (
    select sum(p.monto) filter (where p.estatus = 'pagado'::text) as pagado,
           sum(p.monto) filter (where p.estatus = 'pendiente'::text) as programado,
           max(p.pagado_en) filter (where p.estatus = 'pagado'::text) as ultimo_pago,
           min(p.fecha_programada) filter (where p.estatus = 'pendiente'::text) as proximo_pago
    from public.pagos_programados p
    where p.orden_compra_id = oc.id) pg on true
left join lateral (
    select count(*) as n_lineas,
           count(*) filter (where x.estado = 'completo'::text) as n_completas,
           count(*) filter (where x.estado = 'parcial'::text) as n_parciales,
           sum(x.pendiente) as pendientes
    from public.v_oc_recepcion x
    where x.orden_compra_id = oc.id) rec on true
left join public.proveedores_credito cr on cr.clave = public.fn_proveedor_clave(oc.proveedor) and cr.empresa_id = oc.empresa_id
left join public.proveedores_datos_bancarios db on db.clave = public.fn_proveedor_clave(oc.proveedor);

-- 4. Detalle por proveedor, acotado a una empresa ---------------------------
-- Sobrecarga con empresa (en producción los DROP se quedaban colgados; la de
-- un argumento queda para pantallas viejas).
create or replace function public.fn_cxp_proveedor_detalle(p_clave text, p_empresa uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'ordenes', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'id_orden', o.id_orden, 'tipo', o.tipo, 'fecha', o.fecha_creacion, 'proyecto', o.proyecto, 'total', o.total, 'empresa_id', o.empresa_id, 'proveedor', o.proveedor,
                    'estatus_backoffice', o.estatus_backoffice, 'pagado', (select coalesce(sum(p.monto), 0) from public.pagos_programados p where p.orden_compra_id = o.id and p.estatus = 'pagado')) order by o.fecha_creacion desc), '[]'::jsonb)
                 from (select * from public.ordenes_compra where public.fn_proveedor_clave(proveedor) = p_clave and (p_empresa is null or empresa_id = p_empresa) order by fecha_creacion desc limit 200) o),
    'facturas', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'folio', c.folio, 'fecha', c.fecha, 'total', c.total, 'empresa_id', c.empresa_id, 'contraparte', c.contraparte, 'rfc', c.rfc, 'complemento', coalesce(c.es_complemento_pago, false)) order by c.fecha desc), '[]'::jsonb)
                  from (select * from public.cfdi where tipo = 'recibido' and public.fn_proveedor_clave(contraparte) = p_clave and (p_empresa is null or empresa_id = p_empresa) order by fecha desc limit 200) c),
    'pagos', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'fecha', m.fecha_pago, 'monto', m.cargo_total, 'empresa_id', m.empresa_id, 'nombre', m.nombre_razon_social, 'referencia', m.referencia_numero, 'factura', m.factura) order by m.fecha_pago desc), '[]'::jsonb)
               from (select * from public.movimientos where cargo_total > 0 and public.fn_proveedor_clave(nombre_razon_social) = p_clave and (p_empresa is null or empresa_id = p_empresa) order by fecha_pago desc limit 200) m)
  )
$$;
grant execute on function public.fn_cxp_proveedor_detalle(text, uuid) to authenticated;

-- 5. Programar pago: días de crédito de la línea de esa empresa ------------
create or replace function public.fn_oc_programar_pago(p_oc_id uuid, p_condicion text, p_monto numeric default null::numeric, p_fecha date default null::date, p_cuenta_id uuid default null::uuid, p_notas text default null::text)
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
  v_programado numeric;
  v_saldo numeric;
  v_monto numeric;
  v_fecha date;
  v_dias int;
  v_pago uuid;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then raise exception 'Solo dirección programa pagos' using errcode = '42501'; end if;
  if p_condicion not in ('contado', 'credito', 'anticipo', 'efectivo') then raise exception 'Condición no válida: %', p_condicion; end if;
  select * into v_oc from public.ordenes_compra where id = p_oc_id for update;
  if v_oc.id is null then raise exception 'Orden no encontrada'; end if;
  if not public.empresa_en_alcance(v_oc.empresa_id) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  if v_oc.rechazada_en is not null then raise exception 'La orden % está rechazada; no se programa pago', v_oc.id_orden; end if;
  if v_oc.fuente = 'api' and v_oc.estatus_backoffice = 'Cancelada' then raise exception 'La orden % está cancelada en el backoffice', v_oc.id_orden; end if;
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
  select coalesce(sum(monto) filter (where estatus = 'pagado'), 0), coalesce(sum(monto) filter (where estatus = 'pendiente'), 0)
    into v_pagado, v_programado
    from public.pagos_programados where orden_compra_id = p_oc_id;
  v_saldo := coalesce(v_oc.total, 0) - v_pagado - v_programado;
  if v_saldo <= 0.01 and v_programado > 0 then
    raise exception 'La orden % ya tiene programado todo su saldo (%); no se vuelve a programar', v_oc.id_orden, round(v_programado, 2);
  end if;
  v_monto := coalesce(p_monto, v_saldo);
  if v_monto <= 0 then raise exception 'La orden no tiene saldo pendiente'; end if;
  if v_monto > v_saldo + 0.01 then
    raise exception 'El monto (%) rebasa lo que falta por programar de la orden % (%; ya programado %)', v_monto, v_oc.id_orden, round(v_saldo, 2), round(v_programado, 2);
  end if;
  select dias_credito into v_dias from public.proveedores_credito where clave = public.fn_proveedor_clave(v_oc.proveedor) and empresa_id = v_oc.empresa_id;
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

-- 6. Confirmar OC como pagadas (lo que no se marcó en el backoffice) -------
-- Por cada OC: lo programado pendiente pasa a pagado en esa fecha y lo que
-- aún falte se registra como un pago ya hecho; todo queda confirmado por
-- quien lo hace. Devuelve los ids de los pagos para ligarles el
-- comprobante. Dirección, corporativo y admin; solo OC de su alcance.
create or replace function public.fn_oc_confirmar_pagadas(
  p_ocs uuid[], p_fecha date default null, p_metodo text default 'transferencia',
  p_referencia text default null, p_cuenta_id uuid default null)
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Mexico_City')::date);
  v_ref text := nullif(trim(coalesce(p_referencia, '')), '');
  v_oc public.ordenes_compra%rowtype;
  v_pagado numeric;
  v_falta numeric;
  v_ids uuid[] := '{}';
  v_tmp uuid[];
  v_id uuid;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then raise exception 'Solo dirección confirma pagos' using errcode = '42501'; end if;
  if p_metodo not in ('transferencia', 'efectivo', 'cheque') then raise exception 'Método no válido: %', p_metodo; end if;
  if coalesce(array_length(p_ocs, 1), 0) = 0 then raise exception 'Elige al menos una orden'; end if;
  if array_length(p_ocs, 1) > 200 then raise exception 'Máximo 200 órdenes a la vez'; end if;
  if v_fecha > (now() at time zone 'America/Mexico_City')::date then raise exception 'La fecha de pago no puede ser futura'; end if;

  for v_oc in select * from public.ordenes_compra where id = any (p_ocs) order by id for update loop
    if not (v_oc.empresa_id = any (public.auth_empresas_alcance())) then raise exception 'Sin acceso a la orden %', v_oc.id_orden using errcode = '42501'; end if;
    if v_oc.rechazada_en is not null or (v_oc.fuente = 'api' and v_oc.estatus_backoffice = 'Cancelada') then
      raise exception 'La orden % está rechazada o cancelada; no se confirma como pagada', v_oc.id_orden;
    end if;
    if v_oc.autorizada_en is null and not (v_oc.fuente = 'api' and coalesce(v_oc.estatus_backoffice, '') <> 'Pendiente de Autorización') then
      update public.ordenes_compra set autorizada_en = now(), autorizada_por = v_uid where id = v_oc.id;
    end if;

    -- Lo programado pendiente: se paga en esa fecha.
    with u as (
      update public.pagos_programados set estatus = 'pagado', pagado_en = v_fecha,
             referencia = coalesce(v_ref, referencia), confirmado_en = now(), confirmado_por = v_uid
      where orden_compra_id = v_oc.id and estatus = 'pendiente'
      returning id)
    select coalesce(array_agg(id), '{}') into v_tmp from u;
    v_ids := v_ids || v_tmp;
    -- Lo ya pagado sin confirmar también queda confirmado.
    with u as (
      update public.pagos_programados set confirmado_en = now(), confirmado_por = v_uid, referencia = coalesce(referencia, v_ref)
      where orden_compra_id = v_oc.id and estatus = 'pagado' and confirmado_en is null
      returning id)
    select coalesce(array_agg(id), '{}') into v_tmp from u;
    v_ids := v_ids || v_tmp;

    select coalesce(sum(monto), 0) into v_pagado from public.pagos_programados where orden_compra_id = v_oc.id and estatus = 'pagado';
    v_falta := round(coalesce(v_oc.total, 0) - v_pagado, 2);
    if v_falta > 0.01 then
      insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, estatus, pagado_en,
                                            referencia, notas, created_by, orden_compra_id, metodo, confirmado_en, confirmado_por)
      values (v_oc.empresa_id, case when p_metodo = 'efectivo' then null else p_cuenta_id end, coalesce(v_oc.proveedor, 'Proveedor'),
              'OC ' || v_oc.id_orden || coalesce(' · ' || v_oc.proyecto, ''), v_falta, v_fecha, 'pagado', v_fecha,
              coalesce(v_ref, v_oc.id_orden), 'Confirmada como pagada en Acumulado', v_uid, v_oc.id, p_metodo, now(), v_uid)
      returning id into v_id;
      v_ids := v_ids || v_id;
    end if;
    if v_oc.condicion_pago is null then
      update public.ordenes_compra set condicion_pago = case when p_metodo = 'efectivo' then 'efectivo' else 'contado' end, condicion_por = v_uid, condicion_en = now() where id = v_oc.id;
    end if;
  end loop;
  return v_ids;
end;
$$;
revoke all on function public.fn_oc_confirmar_pagadas(uuid[], date, text, text, uuid) from public, anon;
grant execute on function public.fn_oc_confirmar_pagadas(uuid[], date, text, text, uuid) to authenticated;
