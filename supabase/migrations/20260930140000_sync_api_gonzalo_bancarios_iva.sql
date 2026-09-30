-- Gonzalo amplió api_ocs_aut (30-sep-2026). Cada OC trae ahora SUBTOTAL,
-- IVA, RFC_Proveedor, Banco_Proveedor, Cuenta_Proveedor ("CUENTA: …, CLABE:
-- …"), Metodo_Pago ("Pago en una sola exhibición") y Forma_pago (antes
-- Tipo_pago en el encabezado; las partidas siguen con Tipo_pago).
-- Verificado con la 41054: SUBTOTAL 528.27, IVA 84.52, TOTAL 612.79, Banca
-- Mifel, CLABE 042650016007795121, RFC COVF790501Q96.
--
-- 1. ordenes_compra guarda subtotal_backoffice, iva_backoffice y
--    metodo_pago_backoffice; tipo_pago_backoffice = Forma_pago (o Tipo_pago).
-- 2. La sincronización llena proveedores_datos_bancarios (origen
--    'backoffice') con la OC más reciente de cada proveedor: CLABE solo con
--    dígito verificador, cuenta de 6-14 dígitos (nunca tarjeta); nunca pisa
--    lo capturado a mano ('captura'). Ese bloque va en su propio begin/
--    exception: si falla, la sincronización de OC sigue.
-- 3. v_oc_importes usa SUBTOTAL/IVA del backoffice cuando vienen; si no,
--    los calcula de las partidas (20260930100000).
--
-- Ya aplicado en producción.

alter table public.ordenes_compra
  add column if not exists subtotal_backoffice numeric(14,2),
  add column if not exists iva_backoffice numeric(14,2),
  add column if not exists metodo_pago_backoffice text;

create or replace view public.v_oc_importes with (security_invoker = true) as
select oc.id as orden_compra_id,
       coalesce(oc.subtotal_backoffice, coalesce(oc.total, 0) - coalesce(l.iva, 0)) as subtotal,
       coalesce(oc.iva_backoffice, l.iva, 0) as iva,
       coalesce(oc.total, 0) as total
from public.ordenes_compra oc
left join lateral (
  select round(sum(case when x.iva then x.cantidad * x.costo * case when oc.fuente = 'requisicion' then 0.16 else 0.16 / 1.16 end else 0 end), 2) as iva
  from public.ordenes_compra_lineas x where x.orden_compra_id = oc.id
) l on true;
grant select on public.v_oc_importes to authenticated;

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
  v_bancarios int := 0;
  v_oc_sin_empresa jsonb;
  v_ov_sin_empresa jsonb;
  v_error_det text;
  v_error_bancarios text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '300000');
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
        round(nullif(f ->> 'TOTAL', '')::numeric, 2) as total,
        nullif(f ->> 'Creado', '')::date as fecha_creacion,
        nullif(trim(f ->> 'Estatus'), '') as estatus_backoffice,
        nullif(trim(coalesce(f ->> 'Forma_pago', f ->> 'Tipo_pago')), '') as tipo_pago_backoffice,
        round(nullif(f ->> 'SUBTOTAL', '')::numeric, 2) as subtotal_backoffice,
        round(nullif(f ->> 'IVA', '')::numeric, 2) as iva_backoffice,
        nullif(trim(f ->> 'Metodo_Pago'), '') as metodo_pago_backoffice,
        e.id as empresa_id
      from jsonb_array_elements(v_oc) as f
      left join public.empresas e
        on e.activo = true
       and public.normalizar_texto_sql(e.nombre) = public.normalizar_texto_sql(f ->> 'Empresa_solicitante')
    ) sub
  ),
  insertadas as (
    insert into public.ordenes_compra as oc (id_orden, tipo, empresa_id, proyecto, proveedor, total, fecha_creacion, fuente,
                                             estatus_backoffice, tipo_pago_backoffice, subtotal_backoffice, iva_backoffice, metodo_pago_backoffice)
    select id_orden, tipo, empresa_id, proyecto, proveedor, total, fecha_creacion, 'api',
           estatus_backoffice, tipo_pago_backoffice, subtotal_backoffice, iva_backoffice, metodo_pago_backoffice
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
      tipo_pago_backoffice = coalesce(excluded.tipo_pago_backoffice, oc.tipo_pago_backoffice),
      subtotal_backoffice = excluded.subtotal_backoffice,
      iva_backoffice = excluded.iva_backoffice,
      metodo_pago_backoffice = excluded.metodo_pago_backoffice
    where (oc.empresa_id, oc.proyecto, oc.proveedor, oc.total, oc.fecha_creacion, oc.fuente, oc.estatus_backoffice,
           oc.tipo_pago_backoffice, oc.subtotal_backoffice, oc.iva_backoffice, oc.metodo_pago_backoffice)
          is distinct from (excluded.empresa_id, excluded.proyecto, excluded.proveedor, excluded.total, excluded.fecha_creacion, excluded.fuente, excluded.estatus_backoffice,
           coalesce(excluded.tipo_pago_backoffice, oc.tipo_pago_backoffice), excluded.subtotal_backoffice, excluded.iva_backoffice, excluded.metodo_pago_backoffice)
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

  -- Datos bancarios del proveedor (OC más reciente de cada uno).
  begin
    with prov as (
      select distinct on (public.fn_proveedor_clave(f ->> 'Proveedor'))
        public.fn_proveedor_clave(f ->> 'Proveedor') as clave,
        trim(f ->> 'Proveedor') as nombre,
        nullif(upper(trim(f ->> 'RFC_Proveedor')), '') as rfc,
        nullif(trim(f ->> 'Banco_Proveedor'), '') as banco,
        substring(f ->> 'Cuenta_Proveedor' from 'CLABE\D*(\d{18})') as clabe,
        substring(f ->> 'Cuenta_Proveedor' from 'CUENTA\D*(\d+)') as cuenta,
        e.grupo_id
      from jsonb_array_elements(v_oc) as f
      left join public.empresas e
        on e.activo = true
       and public.normalizar_texto_sql(e.nombre) = public.normalizar_texto_sql(f ->> 'Empresa_solicitante')
      where coalesce(trim(f ->> 'Cuenta_Proveedor'), '') <> '' or coalesce(trim(f ->> 'RFC_Proveedor'), '') <> ''
      order by public.fn_proveedor_clave(f ->> 'Proveedor'), f ->> 'Creado' desc
    ),
    limpios as (
      select clave, nombre, rfc, banco,
             case when clabe is not null and public.fn_clabe_valida(clabe) then clabe end as clabe,
             case when length(cuenta) between 6 and 14 then cuenta end as cuenta,
             grupo_id
      from prov
      where clave is not null and clave <> ''
    ),
    escritos as (
      insert into public.proveedores_datos_bancarios as t
        (clave, nombre, beneficiario, banco, clabe, cuenta, rfc, notas, grupo_id, origen, updated_at)
      select clave, nombre, nombre, coalesce(banco, public.fn_banco_de_clabe(clabe)), clabe, cuenta, rfc,
             'Del catálogo de proveedores del backoffice (API).', grupo_id, 'backoffice', now()
      from limpios
      where clabe is not null or cuenta is not null or rfc is not null
      on conflict (clave) do update set
        banco = coalesce(excluded.banco, t.banco),
        clabe = coalesce(excluded.clabe, t.clabe),
        cuenta = coalesce(excluded.cuenta, t.cuenta),
        rfc = coalesce(excluded.rfc, t.rfc),
        notas = excluded.notas,
        origen = 'backoffice',
        updated_at = now()
      where t.origen <> 'captura'
        and (t.banco, t.clabe, t.cuenta, t.rfc, t.origen) is distinct from
            (coalesce(excluded.banco, t.banco), coalesce(excluded.clabe, t.clabe), coalesce(excluded.cuenta, t.cuenta), coalesce(excluded.rfc, t.rfc), 'backoffice')
      returning 1
    )
    select count(*) into v_bancarios from escritos;
  exception when others then
    v_error_bancarios := sqlerrm;
  end;

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
    'proveedores_bancarios', v_bancarios,
    'error_bancarios', v_error_bancarios,
    'error_partidas', v_error_det
  );
end;
$function$;
