-- Sincronización automática del catálogo OC/OS y OV contra la API del
-- backoffice (reports.grupoloma.mx), confirmada contra la respuesta real
-- (2026-08-25): a diferencia del flujo manual anterior (un archivo Excel por
-- empresa, o proxy-backoffice pidiendo un empresaId), los endpoints
-- "_aut" ya traen el catálogo de las 8 empresas en una sola llamada
-- (`api_ocs_aut` -> {"ordersProject": [...]}, `api_ov_aut` ->
-- {"ordenVentaDashModel": [...]}), cada registro con el nombre de la empresa
-- adentro (`Empresa_solicitante` en OC, `empresa` en OV) -- por eso ya no
-- hace falta pedir uno por uno.
--
-- Se implementa como función de Postgres (no edge function) porque puede
-- hacer la llamada HTTP directo con la extensión `http` -- así el mismo
-- código sirve tanto para el botón manual en Carga.tsx (vía RPC desde el
-- edge function sync-catalogo-oc-ov, con el cliente de servicio) como para
-- un futuro pg_cron sin tener que duplicar la lógica de mapeo/upsert.
--
-- security definer + grant solo a service_role: esta función escribe en
-- ordenes_compra/ordenes_venta de las 8 empresas a la vez (bypassa RLS a
-- propósito, igual que el resto de los upserts de este proyecto que ya
-- pasan por clienteServicio() después de validar el permiso en el edge
-- function que la llama) -- no debe quedar expuesta a `authenticated`.

create extension if not exists http with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Mismo criterio de normalización que normalizarTexto (motor/normalizar.ts):
-- sin acentos, sin coma/punto, espacios colapsados, mayúsculas -- para poder
-- casar "Constructora Supervisión y Consultoría LOMA" (como la manda la API)
-- contra "Constructora, Supervisión y Consultoría LOMA" (como está en
-- empresas.nombre) sin depender de que ambos textos coincidan carácter por
-- carácter.
create or replace function public.normalizar_texto_sql(valor text)
returns text
language sql
immutable
set search_path = extensions
as $$
  select upper(trim(regexp_replace(regexp_replace(extensions.unaccent(coalesce(valor, '')), '[,.]', '', 'g'), '\s+', ' ', 'g')))
$$;

create or replace function public.sincronizar_catalogo_oc_ov()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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

  -- OC/OS: Tipo_orden trae literalmente "Compra" o "Servicio" -- confirmado
  -- contra la respuesta real, no es una suposición (ver comentario del
  -- encabezado de oc-ov.ts para el resto de los campos confirmados).
  -- distinct on (aquí y en el bloque de OV más abajo): la API a veces repite
  -- el mismo registro dos veces de forma idéntica (confirmado contra datos
  -- reales: folios de OV 14914 y 14865) -- sin esto, ON CONFLICT truena con
  -- "cannot affect row a second time" porque la misma llave aparecería dos
  -- veces en el mismo INSERT.
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
      fecha_creacion = excluded.fecha_creacion
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

  -- OV: Folio_orden_venta es el folio visible (coincide con Id_cotizacion
  -- como texto en todos los registros de muestra, pero se prefiere el folio
  -- explícito); el nombre del cliente viene separado en nombre/apellido.
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
$$;

revoke all on function public.sincronizar_catalogo_oc_ov() from public;
revoke all on function public.sincronizar_catalogo_oc_ov() from anon, authenticated;
grant execute on function public.sincronizar_catalogo_oc_ov() to service_role;

comment on function public.sincronizar_catalogo_oc_ov() is 'Trae el catálogo completo de OC/OS y OV (las 8 empresas de una sola vez) desde la API del backoffice y hace upsert -- llamada por el edge function sync-catalogo-oc-ov (botón manual) y disponible para un futuro pg_cron.';
