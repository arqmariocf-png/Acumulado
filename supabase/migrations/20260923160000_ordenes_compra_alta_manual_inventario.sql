-- Laura (dirección/finanzas, 23-sep-2026) no podía dar de alta una OC que
-- todavía no llega del backoffice (pendiente de autorización): la política
-- de insert de ordenes_compra solo dejaba a corporativo/empresa/admin.
-- Quien captura inventario (almacen, direccion) puede registrar una OC
-- manual (fuente 'excel') en su empresa; la sincronización horaria la
-- completa después con los datos del API (mismo folio y tipo) y la marca
-- como 'api'.

create policy ordenes_compra_inventario_insert on public.ordenes_compra
  for insert to authenticated
  with check (
    public.auth_puede_escribir_inventario()
    and fuente = 'excel'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

-- La sincronización ahora también actualiza `fuente` a 'api' cuando la OC
-- manual ya aparece autorizada en el backoffice.
create or replace function public.sincronizar_catalogo_oc_ov()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_oc jsonb;
  v_ov jsonb;
  v_oc_procesadas int;
  v_ov_procesadas int;
  v_oc_guardadas int := 0;
  v_ov_guardadas int := 0;
  v_oc_sin_empresa jsonb;
  v_ov_sin_empresa jsonb;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '55000');

  select (content::jsonb) -> 'ordersProject'
    into v_oc
    from extensions.http_get('https://reports.grupoloma.mx/dash/api_ocs_aut');

  select (content::jsonb) -> 'ordenVentaDashModel'
    into v_ov
    from extensions.http_get('https://reports.grupoloma.mx/dash/api_ov_aut');

  v_oc := coalesce(v_oc, '[]'::jsonb);
  v_ov := coalesce(v_ov, '[]'::jsonb);
  v_oc_procesadas := jsonb_array_length(v_oc);
  v_ov_procesadas := jsonb_array_length(v_ov);

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
        e.id as empresa_id
      from jsonb_array_elements(v_oc) as f
      left join public.empresas e
        on e.activo = true
       and public.normalizar_texto_sql(e.nombre) = public.normalizar_texto_sql(f ->> 'Empresa_solicitante')
    ) sub
  ),
  insertadas as (
    insert into public.ordenes_compra (id_orden, tipo, empresa_id, proyecto, proveedor, total, fecha_creacion, fuente)
    select id_orden, tipo, empresa_id, proyecto, proveedor, total, fecha_creacion, 'api'
    from filas
    where empresa_id is not null and id_orden is not null and id_orden <> ''
    on conflict (id_orden, tipo) do update set
      empresa_id = excluded.empresa_id,
      proyecto = excluded.proyecto,
      proveedor = excluded.proveedor,
      total = excluded.total,
      fecha_creacion = excluded.fecha_creacion,
      fuente = excluded.fuente
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
    insert into public.ordenes_venta (id_ov, empresa_id, proyecto, cliente, total, fecha_ov, fuente)
    select id_ov, empresa_id, proyecto, cliente, total, fecha_ov, 'api'
    from filas
    where empresa_id is not null and id_ov is not null and id_ov <> ''
    on conflict (id_ov) do update set
      empresa_id = excluded.empresa_id,
      proyecto = excluded.proyecto,
      cliente = excluded.cliente,
      total = excluded.total,
      fecha_ov = excluded.fecha_ov
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

  return jsonb_build_object(
    'oc_procesadas', v_oc_procesadas,
    'oc_guardadas', v_oc_guardadas,
    'oc_empresas_no_encontradas', v_oc_sin_empresa,
    'ov_procesadas', v_ov_procesadas,
    'ov_guardadas', v_ov_guardadas,
    'ov_empresas_no_encontradas', v_ov_sin_empresa
  );
end;
$function$;
