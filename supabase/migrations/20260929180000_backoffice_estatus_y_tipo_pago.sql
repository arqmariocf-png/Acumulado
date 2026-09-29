-- El endpoint "de autorizadas" del backoffice (api_ocs_aut) trae en
-- realidad TODAS las OC con su `Estatus` (Pendiente de Autorización,
-- Pendiente de Pago, Pendiente Factura, Pendiente Comprobante, Completada,
-- Cancelada) y su `Tipo_pago` (Transferencia electrónica de fondos,
-- Efectivo, Tarjeta de débito/crédito). Se descubrió el 29-sep-2026 al
-- buscar "a quién pagar" para Delia. Hasta hoy todas se trataban como
-- autorizadas y sin pagar. Ahora:
--   - se guardan `estatus_backoffice` y `tipo_pago_backoffice`;
--   - `v_oc_pagos.autorizacion` para api: Pendiente de Autorización →
--     'pendiente', Cancelada → 'rechazada', el resto 'autorizada';
--   - `v_oc_pagos.pagada_backoffice`: Pendiente Factura / Pendiente
--     Comprobante / Completada = el backoffice ya la registró pagada (el
--     saldo se informa pero no se programa pago sin querer);
--   - `fn_oc_programar_pago` bloquea api pendientes/canceladas;
--   - `v_cxp_proveedores` no cuenta canceladas ni pendientes de autorización.
-- Los datos bancarios del proveedor NO vienen en el backoffice.
-- Ya aplicado en producción.

alter table public.ordenes_compra
  add column if not exists estatus_backoffice text,
  add column if not exists tipo_pago_backoffice text;
create index if not exists ordenes_compra_estatus_bo_idx on public.ordenes_compra (estatus_backoffice) where fuente = 'api';

create or replace function public.sincronizar_catalogo_oc_ov()
returns jsonb language plpgsql security definer set search_path = public, extensions as $function$
declare
  v_oc jsonb;
  v_ov jsonb;
  v_oc_det jsonb;
  v_ov_det jsonb;
  v_oc_procesadas int;
  v_ov_procesadas int;
  v_oc_guardadas int := 0;
  v_ov_guardadas int := 0;
  v_oc_lineas int := 0;
  v_ov_lineas int := 0;
  v_oc_sin_empresa jsonb;
  v_ov_sin_empresa jsonb;
  v_error_det text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '115000');
  -- El connect timeout por defecto es 1 s y el backoffice a veces tarda más
  -- en aceptar la conexión ("Failed to connect … after 1001 ms").
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '20000');

  -- 1. Descargas (lo lento) ANTES de tocar cualquier tabla.
  select (content::jsonb) -> 'ordersProject' into v_oc from extensions.http_get('https://reports.grupoloma.mx/dash/api_ocs_aut');
  select (content::jsonb) -> 'ordenVentaDashModel' into v_ov from extensions.http_get('https://reports.grupoloma.mx/dash/api_ov_aut');
  begin
    select (content::jsonb) -> 'ordersProject' into v_oc_det from extensions.http_get('https://reports.grupoloma.mx/dash/api_ocs_det_aut');
    select (content::jsonb) -> 'ordenVentaDashModel' into v_ov_det from extensions.http_get('https://reports.grupoloma.mx/dash/api_ov_det_aut');
  exception when others then
    v_error_det := 'partidas: ' || sqlerrm;
  end;

  v_oc := coalesce(v_oc, '[]'::jsonb);
  v_ov := coalesce(v_ov, '[]'::jsonb);
  v_oc_det := coalesce(v_oc_det, '[]'::jsonb);
  v_ov_det := coalesce(v_ov_det, '[]'::jsonb);
  v_oc_procesadas := jsonb_array_length(v_oc);
  v_ov_procesadas := jsonb_array_length(v_ov);

  -- 2. Escrituras: solo lo que cambió.
  with filas as (
    select distinct on (id_orden, tipo) *
    from (
      select
        trim(f ->> 'Id_Orden') as id_orden,
        case when public.normalizar_texto_sql(f ->> 'Tipo_orden') = 'SERVICIO' then 'OS' else 'OC' end as tipo,
        nullif(trim(f ->> 'Proyecto'), '') as proyecto,
        nullif(trim(f ->> 'Proveedor'), '') as proveedor,
        nullif(f ->> 'TOTAL', '')::numeric as total,
        nullif(f ->> 'Creado', '')::date as fecha_creacion,
        nullif(trim(f ->> 'Estatus'), '') as estatus_backoffice,
        nullif(trim(f ->> 'Tipo_pago'), '') as tipo_pago_backoffice,
        e.id as empresa_id
      from jsonb_array_elements(v_oc) as f
      left join public.empresas e
        on e.activo = true
       and public.normalizar_texto_sql(e.nombre) = public.normalizar_texto_sql(f ->> 'Empresa_solicitante')
    ) sub
  ),
  insertadas as (
    insert into public.ordenes_compra as oc (id_orden, tipo, empresa_id, proyecto, proveedor, total, fecha_creacion, fuente, estatus_backoffice, tipo_pago_backoffice)
    select id_orden, tipo, empresa_id, proyecto, proveedor, total, fecha_creacion, 'api', estatus_backoffice, tipo_pago_backoffice
    from filas
    where empresa_id is not null and id_orden is not null and id_orden <> ''
    on conflict (id_orden, tipo) do update set
      empresa_id = excluded.empresa_id,
      proyecto = excluded.proyecto,
      proveedor = excluded.proveedor,
      total = excluded.total,
      fecha_creacion = excluded.fecha_creacion,
      fuente = excluded.fuente,
      estatus_backoffice = excluded.estatus_backoffice,
      tipo_pago_backoffice = excluded.tipo_pago_backoffice
    where (oc.empresa_id, oc.proyecto, oc.proveedor, oc.total, oc.fecha_creacion, oc.fuente, oc.estatus_backoffice, oc.tipo_pago_backoffice)
          is distinct from (excluded.empresa_id, excluded.proyecto, excluded.proveedor, excluded.total, excluded.fecha_creacion, excluded.fuente, excluded.estatus_backoffice, excluded.tipo_pago_backoffice)
    returning 1
  )
  select count(*) into v_oc_guardadas from insertadas;

  select coalesce(jsonb_agg(distinct f ->> 'Empresa_solicitante'), '[]'::jsonb)
    into v_oc_sin_empresa
    from jsonb_array_elements(v_oc) as f
    where not exists (
      select 1 from public.empresas e
      where e.activo = true and public.normalizar_texto_sql(e.nombre) = public.normalizar_texto_sql(f ->> 'Empresa_solicitante')
    );

  with filas as (
    select distinct on (id_ov) *
    from (
      select
        trim(coalesce(nullif(f ->> 'Folio_orden_venta', ''), f ->> 'Id_cotizacion')) as id_ov,
        nullif(trim(f ->> 'Project'), '') as proyecto,
        nullif(trim(concat_ws(' ', f ->> 'Cliente_nombre', f ->> 'Cliente_apellido')), '') as cliente,
        nullif(f ->> 'OV_Subtotal', '')::numeric as total,
        nullif(f ->> 'FechaOV', '')::date as fecha_ov,
        e.id as empresa_id
      from jsonb_array_elements(v_ov) as f
      left join public.empresas e
        on e.activo = true
       and public.normalizar_texto_sql(e.nombre) = public.normalizar_texto_sql(f ->> 'empresa')
    ) sub
  ),
  insertadas as (
    insert into public.ordenes_venta as ov (id_ov, empresa_id, proyecto, cliente, total, fecha_ov, fuente)
    select id_ov, empresa_id, proyecto, cliente, total, fecha_ov, 'api'
    from filas
    where empresa_id is not null and id_ov is not null and id_ov <> ''
    on conflict (id_ov) do update set
      empresa_id = excluded.empresa_id,
      proyecto = excluded.proyecto,
      cliente = excluded.cliente,
      total = excluded.total,
      fecha_ov = excluded.fecha_ov
    where (ov.empresa_id, ov.proyecto, ov.cliente, ov.total, ov.fecha_ov)
          is distinct from (excluded.empresa_id, excluded.proyecto, excluded.cliente, excluded.total, excluded.fecha_ov)
    returning 1
  )
  select count(*) into v_ov_guardadas from insertadas;

  select coalesce(jsonb_agg(distinct f ->> 'empresa'), '[]'::jsonb)
    into v_ov_sin_empresa
    from jsonb_array_elements(v_ov) as f
    where not exists (
      select 1 from public.empresas e
      where e.activo = true and public.normalizar_texto_sql(e.nombre) = public.normalizar_texto_sql(f ->> 'empresa')
    );

  if v_error_det is null then
    begin
      with det as (
        select
          oc.id as orden_compra_id,
          x.ord,
          trim(x.f ->> 'Item') as item,
          nullif(trim(x.f ->> 'Unidad'), '') as unidad,
          nullif(x.f ->> 'Cantidad', '')::numeric as cantidad,
          nullif(x.f ->> 'Costo', '')::numeric as costo,
          case when x.f ->> 'IVA' in ('1', 'true') then true when x.f ->> 'IVA' in ('0', 'false') then false end as iva
        from jsonb_array_elements(v_oc_det) with ordinality as x(f, ord)
        join public.ordenes_compra oc
          on oc.id_orden = trim(x.f ->> 'Id_Orden')
         and oc.tipo = case when public.normalizar_texto_sql(x.f ->> 'Tipo_orden') = 'SERVICIO' then 'OS' else 'OC' end
        where coalesce(trim(x.f ->> 'Item'), '') <> ''
      ),
      con_clave as (
        select *,
          row_number() over (partition by orden_compra_id order by ord) as numero,
          md5(concat_ws('|', item, unidad, cantidad::text, costo::text,
            row_number() over (partition by orden_compra_id, item, unidad, cantidad, costo order by ord)::text)) as clave
        from det
      ),
      borradas as (
        delete from public.ordenes_compra_lineas l
        where l.fuente = 'api'
          and l.orden_compra_id in (select distinct orden_compra_id from con_clave)
          and not exists (select 1 from con_clave c where c.orden_compra_id = l.orden_compra_id and c.clave = l.clave)
        returning 1
      ),
      insertadas as (
        insert into public.ordenes_compra_lineas as l (orden_compra_id, clave, numero, item, unidad, cantidad, costo, iva, fuente)
        select orden_compra_id, clave, numero, item, unidad, cantidad, costo, iva, 'api'
        from con_clave
        on conflict (orden_compra_id, clave) do update set
          numero = excluded.numero,
          cantidad = excluded.cantidad,
          costo = excluded.costo,
          iva = excluded.iva
        where (l.numero, l.cantidad, l.costo, l.iva) is distinct from (excluded.numero, excluded.cantidad, excluded.costo, excluded.iva)
        returning 1
      )
      select count(*) into v_oc_lineas from insertadas;

      with det as (
        select
          ov.id as orden_venta_id,
          x.ord,
          trim(x.f ->> 'concepto') as concepto,
          nullif(trim(x.f ->> 'Unidad'), '') as unidad,
          nullif(x.f ->> 'Cantidad', '')::numeric as cantidad,
          nullif(x.f ->> 'PrecioBase', '')::numeric as precio_base,
          nullif(trim(x.f ->> 'SATcode'), '') as sat_code
        from jsonb_array_elements(v_ov_det) with ordinality as x(f, ord)
        join public.ordenes_venta ov
          on ov.id_ov = trim(coalesce(nullif(x.f ->> 'Folio_orden_venta', ''), x.f ->> 'Id_cotizacion'))
        where coalesce(trim(x.f ->> 'concepto'), '') <> ''
      ),
      con_clave as (
        select *,
          row_number() over (partition by orden_venta_id order by ord) as numero,
          md5(concat_ws('|', concepto, unidad, cantidad::text, precio_base::text,
            row_number() over (partition by orden_venta_id, concepto, unidad, cantidad, precio_base order by ord)::text)) as clave
        from det
      ),
      borradas as (
        delete from public.ordenes_venta_lineas l
        where l.fuente = 'api'
          and l.orden_venta_id in (select distinct orden_venta_id from con_clave)
          and not exists (select 1 from con_clave c where c.orden_venta_id = l.orden_venta_id and c.clave = l.clave)
        returning 1
      ),
      insertadas as (
        insert into public.ordenes_venta_lineas as l (orden_venta_id, clave, numero, concepto, unidad, cantidad, precio_base, sat_code, fuente)
        select orden_venta_id, clave, numero, concepto, unidad, cantidad, precio_base, sat_code, 'api'
        from con_clave
        on conflict (orden_venta_id, clave) do update set
          numero = excluded.numero,
          cantidad = excluded.cantidad,
          precio_base = excluded.precio_base,
          sat_code = excluded.sat_code
        where (l.numero, l.cantidad, l.precio_base, l.sat_code) is distinct from (excluded.numero, excluded.cantidad, excluded.precio_base, excluded.sat_code)
        returning 1
      )
      select count(*) into v_ov_lineas from insertadas;
    exception when others then
      v_error_det := sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'oc_procesadas', v_oc_procesadas,
    'oc_guardadas', v_oc_guardadas,
    'oc_empresas_no_encontradas', v_oc_sin_empresa,
    'ov_procesadas', v_ov_procesadas,
    'ov_guardadas', v_ov_guardadas,
    'ov_empresas_no_encontradas', v_ov_sin_empresa,
    'oc_lineas_guardadas', v_oc_lineas,
    'ov_lineas_guardadas', v_ov_lineas,
    'error_partidas', v_error_det
  );
end;
$function$;

drop view if exists public.v_oc_pagos;
create view public.v_oc_pagos with (security_invoker = true) as
select oc.id, oc.id_orden, oc.empresa_id, oc.proveedor, oc.proyecto, oc.total, oc.fecha_creacion, oc.fuente,
       oc.condicion_pago, oc.autorizada_en,
       coalesce(pg.pagado, 0) as pagado,
       coalesce(pg.programado, 0) as programado,
       coalesce(oc.total, 0) - coalesce(pg.pagado, 0) as saldo,
       pg.ultimo_pago, pg.proximo_pago,
       cr.clave as proveedor_clave, cr.linea_credito, cr.dias_credito, cr.vencimiento as credito_vencimiento,
       case when oc.rechazada_en is not null then 'rechazada'
            when oc.fuente = 'api' and oc.estatus_backoffice = 'Cancelada' then 'rechazada'
            when oc.fuente = 'api' and oc.estatus_backoffice = 'Pendiente de Autorización' then 'pendiente'
            when oc.fuente = 'api' or oc.autorizada_en is not null then 'autorizada'
            else 'pendiente' end as autorizacion,
       case when oc.condicion_pago = 'credito' or (oc.condicion_pago is null and cr.dias_credito is not null)
            then coalesce(oc.fecha_creacion, oc.created_at::date) + coalesce(cr.dias_credito, 30) end as vence,
       (oc.condicion_pago = 'credito' or (oc.condicion_pago is null and cr.dias_credito is not null)) as es_credito,
       oc.rechazo_motivo,
       public.fn_proveedor_clave(oc.proveedor) as clave,
       db.beneficiario as beneficiario_bancario, db.banco as banco_proveedor, db.clabe, db.cuenta as cuenta_proveedor,
       oc.estatus_backoffice, oc.tipo_pago_backoffice,
       (oc.fuente = 'api' and oc.estatus_backoffice in ('Pendiente Factura', 'Pendiente Comprobante', 'Completada')) as pagada_backoffice
from public.ordenes_compra oc
left join lateral (
  select sum(p.monto) filter (where p.estatus = 'pagado') as pagado,
         sum(p.monto) filter (where p.estatus = 'pendiente') as programado,
         max(p.pagado_en) filter (where p.estatus = 'pagado') as ultimo_pago,
         min(p.fecha_programada) filter (where p.estatus = 'pendiente') as proximo_pago
  from public.pagos_programados p where p.orden_compra_id = oc.id
) pg on true
left join public.proveedores_credito cr on cr.clave = public.fn_proveedor_clave(oc.proveedor)
left join public.proveedores_datos_bancarios db on db.clave = public.fn_proveedor_clave(oc.proveedor);
grant select on public.v_oc_pagos to authenticated;

create or replace view public.v_cxp_proveedores with (security_invoker = true) as
with oc as (
  select public.fn_proveedor_clave(proveedor) clave, min(proveedor) nombre, count(*) n_oc, sum(total) comprometido,
         max(fecha_creacion) ultima_oc, array_agg(distinct empresa_id) empresas
  from public.ordenes_compra
  where public.fn_proveedor_clave(proveedor) is not null and public.fn_proveedor_clave(proveedor) <> 'TOTAL'
    and rechazada_en is null
    and coalesce(estatus_backoffice, '') not in ('Cancelada', 'Pendiente de Autorización')
  group by public.fn_proveedor_clave(proveedor)
),
fac as (
  select public.fn_proveedor_clave(contraparte) clave, min(contraparte) nombre,
         count(*) filter (where not coalesce(es_complemento_pago, false)) n_facturas,
         sum(total) filter (where not coalesce(es_complemento_pago, false)) facturado,
         sum(total) filter (where coalesce(es_complemento_pago, false)) pagado_complementos,
         max(fecha) filter (where not coalesce(es_complemento_pago, false)) ultima_factura,
         array_agg(distinct empresa_id) empresas
  from public.cfdi
  where tipo = 'recibido' and public.fn_proveedor_clave(contraparte) is not null
  group by public.fn_proveedor_clave(contraparte)
),
pag as (
  select public.fn_proveedor_clave(nombre_razon_social) clave, sum(cargo_total) pagado_bancos, max(fecha_pago) ultimo_pago
  from public.movimientos
  where cargo_total > 0 and public.fn_proveedor_clave(nombre_razon_social) is not null
  group by public.fn_proveedor_clave(nombre_razon_social)
)
select coalesce(oc.clave, fac.clave) clave,
       coalesce(cr.nombre, fac.nombre, oc.nombre) proveedor,
       coalesce(oc.n_oc, 0) n_oc,
       coalesce(oc.comprometido, 0) comprometido,
       coalesce(fac.n_facturas, 0) n_facturas,
       coalesce(fac.facturado, 0) facturado,
       coalesce(fac.pagado_complementos, 0) + coalesce(pag.pagado_bancos, 0) pagado,
       greatest(coalesce(fac.facturado, 0) - coalesce(fac.pagado_complementos, 0) - coalesce(pag.pagado_bancos, 0), 0) por_pagar,
       greatest(coalesce(oc.comprometido, 0) - coalesce(fac.facturado, 0), 0) sin_facturar,
       cr.linea_credito, cr.dias_credito, cr.notas, cr.vencimiento,
       case when cr.linea_credito is null then null
            else cr.linea_credito - greatest(coalesce(fac.facturado, 0) - coalesce(fac.pagado_complementos, 0) - coalesce(pag.pagado_bancos, 0), 0) end disponible,
       oc.ultima_oc, fac.ultima_factura, pag.ultimo_pago,
       (select array_agg(distinct e.e) from unnest(coalesce(oc.empresas, '{}'::uuid[]) || coalesce(fac.empresas, '{}'::uuid[])) e(e)) empresas
from oc
full join fac on fac.clave = oc.clave
left join pag on pag.clave = coalesce(oc.clave, fac.clave)
left join public.proveedores_credito cr on cr.clave = coalesce(oc.clave, fac.clave);

-- Programar pago: las OC del backoffice pendientes de autorización o
-- canceladas tampoco se pagan.
create or replace function public.fn_oc_programar_pago(p_oc_id uuid, p_condicion text, p_monto numeric default null, p_fecha date default null, p_cuenta_id uuid default null, p_notas text default null)
returns uuid language plpgsql security definer set search_path = public as $$
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
  if v_oc.fuente = 'api' and v_oc.estatus_backoffice = 'Pendiente de Autorización' then raise exception 'La orden % está pendiente de autorización en el backoffice', v_oc.id_orden; end if;
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
$$;
