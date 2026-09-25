-- Partidas (ítems) de OC/OS y OV desde el backoffice (Mario, 24-sep-2026):
-- "en las OV y OC están los ítems para poder simplemente escogerlos y
-- confirmar que las cantidades llegaron o no". Los endpoints api_ocs_det_aut
-- y api_ov_det_aut traen una fila por partida (Item/concepto, Cantidad,
-- Unidad, Costo/PrecioBase). Se guardan aquí y cada movimiento de
-- inventario puede apuntar a la partida que recibe/embarca, con lo que el
-- avance se lleva por cantidad y no solo por monto.

create table public.ordenes_compra_lineas (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid not null references public.ordenes_compra(id) on delete cascade,
  -- clave determinista (item|unidad|cantidad|costo|n) para que la
  -- sincronización horaria haga upsert sin perder los movimientos que ya
  -- apuntan a la partida
  clave text not null,
  numero int not null,
  item text not null,
  unidad text,
  cantidad numeric,
  costo numeric,
  iva boolean,
  fuente text not null default 'api',
  created_at timestamptz not null default now(),
  unique (orden_compra_id, clave)
);
create index ordenes_compra_lineas_orden_idx on public.ordenes_compra_lineas (orden_compra_id, numero);

create table public.ordenes_venta_lineas (
  id uuid primary key default gen_random_uuid(),
  orden_venta_id uuid not null references public.ordenes_venta(id) on delete cascade,
  clave text not null,
  numero int not null,
  concepto text not null,
  unidad text,
  cantidad numeric,
  precio_base numeric,
  sat_code text,
  fuente text not null default 'api',
  created_at timestamptz not null default now(),
  unique (orden_venta_id, clave)
);
create index ordenes_venta_lineas_orden_idx on public.ordenes_venta_lineas (orden_venta_id, numero);

alter table public.ordenes_compra_lineas enable row level security;
alter table public.ordenes_venta_lineas enable row level security;

-- Se ven exactamente con quien ve la orden (la subconsulta pasa por las
-- políticas de ordenes_compra / ordenes_venta). Solo escribe la
-- sincronización (postgres).
create policy ordenes_compra_lineas_select on public.ordenes_compra_lineas
  for select to authenticated
  using (exists (select 1 from public.ordenes_compra oc where oc.id = orden_compra_id));
create policy ordenes_venta_lineas_select on public.ordenes_venta_lineas
  for select to authenticated
  using (exists (select 1 from public.ordenes_venta ov where ov.id = orden_venta_id));

alter table public.movimientos_inventario
  add column linea_orden_compra_id uuid references public.ordenes_compra_lineas(id) on delete set null,
  add column linea_orden_venta_id uuid references public.ordenes_venta_lineas(id) on delete set null;
create index movimientos_inventario_linea_oc_idx on public.movimientos_inventario (linea_orden_compra_id) where linea_orden_compra_id is not null;
create index movimientos_inventario_linea_ov_idx on public.movimientos_inventario (linea_orden_venta_id) where linea_orden_venta_id is not null;

create view public.v_oc_lineas_avance with (security_invoker = true) as
select
  l.id as linea_id,
  l.orden_compra_id,
  l.numero,
  l.item,
  l.unidad,
  l.cantidad,
  round(l.costo, 4) as costo,
  coalesce(sum(mi.cantidad), 0) as recibido,
  greatest(coalesce(l.cantidad, 0) - coalesce(sum(mi.cantidad), 0), 0) as pendiente,
  case
    when coalesce(sum(mi.cantidad), 0) = 0 then 'sin_recibir'
    when l.cantidad is not null and coalesce(sum(mi.cantidad), 0) >= l.cantidad then 'completo'
    else 'parcial'
  end as estado,
  max(mi.fecha) as fecha_ultima_recepcion,
  (array_agg(mi.producto_id order by mi.created_at desc) filter (where mi.producto_id is not null))[1] as producto_id
from public.ordenes_compra_lineas l
left join public.movimientos_inventario mi on mi.linea_orden_compra_id = l.id
group by l.id;

create view public.v_ov_lineas_avance with (security_invoker = true) as
select
  l.id as linea_id,
  l.orden_venta_id,
  l.numero,
  l.concepto,
  l.unidad,
  l.cantidad,
  round(l.precio_base, 4) as precio_base,
  coalesce(sum(mi.cantidad), 0) as embarcado,
  greatest(coalesce(l.cantidad, 0) - coalesce(sum(mi.cantidad), 0), 0) as pendiente,
  case
    when coalesce(sum(mi.cantidad), 0) = 0 then 'sin_embarcar'
    when l.cantidad is not null and coalesce(sum(mi.cantidad), 0) >= l.cantidad then 'completo'
    else 'parcial'
  end as estado,
  max(mi.fecha) as fecha_ultimo_embarque,
  (array_agg(mi.producto_id order by mi.created_at desc) filter (where mi.producto_id is not null))[1] as producto_id
from public.ordenes_venta_lineas l
left join public.movimientos_inventario mi on mi.linea_orden_venta_id = l.id
group by l.id;

grant select on public.v_oc_lineas_avance, public.v_ov_lineas_avance to authenticated;

-- La sincronización ahora también trae las partidas. Los endpoints _det_aut
-- tardan más (el de OC ~1 min: el backoffice arma todo el catálogo en cada
-- llamada) -- corre siempre en segundo plano (pg_cron), sin timeout.
create or replace function public.sincronizar_catalogo_oc_ov()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
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

  -- Partidas. Si el backoffice falla en estos endpoints, el catálogo de
  -- cabeceras ya quedó guardado; solo se reporta el error.
  begin
    select (content::jsonb) -> 'ordersProject'
      into v_oc_det
      from extensions.http_get('https://reports.grupoloma.mx/dash/api_ocs_det_aut');
    v_oc_det := coalesce(v_oc_det, '[]'::jsonb);

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
      insert into public.ordenes_compra_lineas (orden_compra_id, clave, numero, item, unidad, cantidad, costo, iva, fuente)
      select orden_compra_id, clave, numero, item, unidad, cantidad, costo, iva, 'api'
      from con_clave
      on conflict (orden_compra_id, clave) do update set
        numero = excluded.numero,
        cantidad = excluded.cantidad,
        costo = excluded.costo,
        iva = excluded.iva
      returning 1
    )
    select count(*) into v_oc_lineas from insertadas;

    select (content::jsonb) -> 'ordenVentaDashModel'
      into v_ov_det
      from extensions.http_get('https://reports.grupoloma.mx/dash/api_ov_det_aut');
    v_ov_det := coalesce(v_ov_det, '[]'::jsonb);

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
      insert into public.ordenes_venta_lineas (orden_venta_id, clave, numero, concepto, unidad, cantidad, precio_base, sat_code, fuente)
      select orden_venta_id, clave, numero, concepto, unidad, cantidad, precio_base, sat_code, 'api'
      from con_clave
      on conflict (orden_venta_id, clave) do update set
        numero = excluded.numero,
        cantidad = excluded.cantidad,
        precio_base = excluded.precio_base,
        sat_code = excluded.sat_code
      returning 1
    )
    select count(*) into v_ov_lineas from insertadas;
  exception when others then
    v_error_det := sqlerrm;
  end;

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
