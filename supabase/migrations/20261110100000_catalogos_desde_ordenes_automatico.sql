-- Proveedores e items completos y al día (10-nov-2026, Mario: "siguen sin
-- estar los proveedores completos y materiales en tu sistema").
--
-- Lo que pasaba:
--  * De 321 proveedores que aparecen en las órdenes de compra solo 18 tenían
--    ficha en `proveedores`: en Catálogos › Proveedores y artículos salían
--    como "solo en órdenes" y no había forma de completarlos en lote. No
--    existía una importación de proveedores (solo de clientes e items).
--  * `fn_items_importar_backoffice` solo tomaba las OC del backoffice
--    (fuente 'api'); las 399 partidas de las OC/OS capturadas aquí (IA) nunca
--    entraban al catálogo (246 faltaban).
--  * Las importaciones solo corrían con el botón "Importar del backoffice"
--    (última vez 21-oct), así que lo nuevo de cada hora no se veía.
--
-- Ahora: `fn_proveedores_importar_backoffice()` (ficha por cada proveedor de
-- cualquier OC no rechazada, con el RFC que ya tengan los datos bancarios),
-- `fn_items_importar_backoffice()` toma TODAS las fuentes, y las tres
-- importaciones (proveedores, items, clientes) corren al final de la
-- sincronización horaria del backoffice.

create or replace function public.fn_proveedores_importar_backoffice()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
  v_rol text := public.auth_rol();
  v_nuevos int;
begin
  if v_usuario is not null
     and not (v_rol in ('admin', 'direccion') or public.auth_captura_ordenes()) then
    raise exception 'Solo dirección, administración o quien captura órdenes importa proveedores' using errcode = '42501';
  end if;

  with oc as (
    select e.grupo_id,
           btrim(regexp_replace(o.proveedor, '\s+', ' ', 'g')) as nombre,
           public.fn_proveedor_clave(o.proveedor) as clave,
           coalesce(o.fecha_creacion, o.created_at::date) as fecha,
           o.id_orden
      from public.ordenes_compra o
      join public.empresas e on e.id = o.empresa_id
     where o.rechazada_en is null
       and o.proveedor is not null and btrim(o.proveedor) <> ''
       and (v_usuario is null or o.empresa_id = any (public.auth_empresas_alcance()))
  ), ultimo as (
    select distinct on (grupo_id, clave) grupo_id, clave, nombre
      from oc
     where clave is not null and clave <> ''
     order by grupo_id, clave, fecha desc nulls last, id_orden desc
  ), nuevos as (
    insert into public.proveedores (grupo_id, nombre, rfc, notas, activo, created_by)
    select u.grupo_id, u.nombre,
           (select b.rfc from public.proveedores_datos_bancarios b
             where b.clave = u.clave and b.rfc is not null limit 1),
           'Importado de las órdenes de compra. Completa contacto, domicilio y datos bancarios.',
           true, v_usuario
      from ultimo u
     where not exists (
       select 1 from public.proveedores p
        where p.grupo_id = u.grupo_id and p.clave = u.clave)
    on conflict (grupo_id, clave) do nothing
    returning 1
  )
  select count(*) into v_nuevos from nuevos;

  return jsonb_build_object('nuevos', v_nuevos);
end;
$$;

revoke all on function public.fn_proveedores_importar_backoffice() from public, anon;
grant execute on function public.fn_proveedores_importar_backoffice() to authenticated;

-- Items de TODAS las órdenes (backoffice, IA, requisiciones) no rechazadas.
create or replace function public.fn_items_importar_backoffice()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
  v_rol text := public.auth_rol();
  v_nuevos int;
begin
  if v_usuario is not null
     and not (v_rol in ('admin', 'direccion') or public.auth_captura_ordenes()) then
    raise exception 'Solo dirección, administración o quien captura órdenes importa items' using errcode = '42501';
  end if;

  with lineas as (
    select e.grupo_id,
           btrim(regexp_replace(l.item, '\s+', ' ', 'g')) as descripcion,
           public.normalizar_texto_sql(l.item) as norma,
           nullif(btrim(coalesce(l.unidad, '')), '') as unidad,
           -- El backoffice manda el costo con IVA; lo capturado aquí ya va sin IVA.
           case when o.fuente = 'api' and coalesce(l.iva, true) then round(l.costo / 1.16, 2) else round(l.costo, 2) end as precio,
           coalesce(l.iva, true) as iva,
           o.tipo,
           coalesce(o.fecha_creacion, o.created_at::date) as fecha,
           o.id_orden
      from public.ordenes_compra_lineas l
      join public.ordenes_compra o on o.id = l.orden_compra_id
      join public.empresas e on e.id = o.empresa_id
     where o.rechazada_en is null
       and l.item is not null and btrim(l.item) <> ''
       and (v_usuario is null or o.empresa_id = any (public.auth_empresas_alcance()))
  ), resumen as (
    select grupo_id, norma,
           (array_agg(descripcion order by fecha desc, id_orden desc))[1] as descripcion,
           mode() within group (order by unidad) as unidad,
           (array_agg(precio order by fecha desc, id_orden desc) filter (where precio > 0))[1] as precio,
           (array_agg(iva order by fecha desc, id_orden desc))[1] as iva,
           count(*) filter (where tipo = 'OS') > count(*) / 2 as servicio
      from lineas
     where norma is not null and norma <> ''
     group by grupo_id, norma
  ), faltan as (
    select r.*,
           row_number() over (partition by r.grupo_id order by r.descripcion) as n
      from resumen r
     where not exists (
       select 1 from public.compras_items i
        where i.grupo_id = r.grupo_id and public.normalizar_texto_sql(i.descripcion) = r.norma)
  ), base as (
    select i.grupo_id, coalesce(max(substring(i.clave from '^IT-(\d+)$')::int), 0) as ultimo
      from public.compras_items i group by i.grupo_id
  ), nuevos as (
    insert into public.compras_items (grupo_id, clave, descripcion, unidad, categoria, iva, precio_referencia, notas, activo, created_by)
    select f.grupo_id,
           'IT-' || lpad((coalesce(b.ultimo, 0) + f.n)::text, 4, '0'),
           f.descripcion, f.unidad,
           case when f.servicio then 'servicio' else 'material' end,
           f.iva, f.precio, 'Importado de las órdenes de compra.', true, v_usuario
      from faltan f
      left join base b on b.grupo_id = f.grupo_id
    on conflict do nothing
    returning 1
  )
  select count(*) into v_nuevos from nuevos;

  return jsonb_build_object('nuevos', v_nuevos);
end;
$$;

-- Al final de la sincronización horaria con el backoffice (ya aplicado en
-- producción): proyectos nuevos, proveedores, items y clientes.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.alter_job(jobid, command := 'set statement_timeout = ''10min''; select public.sincronizar_catalogo_oc_ov(); select public.fn_proyectos_desde_backoffice(); select public.fn_proveedores_importar_backoffice(); select public.fn_items_importar_backoffice(); select public.fn_clientes_importar_backoffice();')
    from cron.job where jobname = 'sync-catalogo-oc-ov-horario';
  end if;
end $$;
