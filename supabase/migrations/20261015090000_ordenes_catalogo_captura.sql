-- Buscador de proveedores / clientes y de partidas al capturar OC, OS y OV
-- con folio IA (15-oct-2026, Mario: "pon el filtro para que busquen
-- proveedores, items, para que sea fácil su captura"). Antes el editor solo
-- sugería proveedores de la misma empresa y productos del catálogo (casi
-- ninguna empresa tiene catálogo). Ahora una sola llamada al abrir el editor
-- trae, de lo que quien captura ya puede ver (corre con su RLS):
--   - contrapartes: proveedores de todas las OC (o clientes y OV), con RFC,
--     veces usado, última fecha y si es de la misma empresa;
--   - partidas: cada concepto ya comprado (o vendido) por proveedor, con la
--     unidad y el último precio SIN IVA, más el catálogo de productos.
-- La pantalla filtra al instante sin acentos y por palabras. Ya aplicado en
-- producción.

create or replace function public.fn_ordenes_catalogo_captura(p_venta boolean, p_empresa uuid)
returns jsonb
language sql stable set search_path = public as $$
  with oc as (
    select o.proveedor as contraparte, o.empresa_id, coalesce(o.fecha_creacion, o.created_at::date) as fecha, o.fuente, o.id
      from public.ordenes_compra o
     where not p_venta and o.rechazada_en is null and nullif(trim(o.proveedor), '') is not null
  ),
  ov as (
    select o.cliente as contraparte, o.empresa_id, coalesce(o.fecha_ov, o.created_at::date) as fecha, o.id
      from public.ordenes_venta o
     where p_venta and o.cancelada_en is null and nullif(trim(o.cliente), '') is not null
  ),
  usos as (
    select contraparte, empresa_id, fecha from oc
    union all select contraparte, empresa_id, fecha from ov
    union all
    select c.razon_social, c.empresa_id, null::date from public.clientes c where p_venta and c.activo and nullif(trim(c.razon_social), '') is not null
  ),
  contrapartes as (
    select (array_agg(trim(u.contraparte) order by u.fecha desc nulls last))[1] as nombre,
           count(u.fecha) as veces,
           max(u.fecha) as ultima,
           bool_or(u.empresa_id = p_empresa) as misma_empresa
      from usos u
     group by public.normalizar_texto_sql(u.contraparte)
  ),
  partidas as (
    -- OC del backoffice: el costo ya trae IVA; las de aquí (RQ, IA, Excel) no.
    select l.item as descripcion, l.unidad, l.iva,
           case when o.fuente = 'api' and coalesce(l.iva, true) then l.costo / 1.16 else l.costo end as precio,
           o.contraparte, o.empresa_id, o.fecha
      from public.ordenes_compra_lineas l join oc o on o.id = l.orden_compra_id
     where nullif(trim(l.item), '') is not null
    union all
    select l.concepto, l.unidad, l.iva, l.precio_base, o.contraparte, o.empresa_id, o.fecha
      from public.ordenes_venta_lineas l join ov o on o.id = l.orden_venta_id
     where nullif(trim(l.concepto), '') is not null
    union all
    select p.nombre, p.unidad_medida, true,
           case when p_venta then p.precio_venta / (1 + coalesce(p.iva_tasa, 0.16)) else p.costo_referencia end,
           null, p.empresa_id, null::date
      from public.productos p
     where p.activo and p.empresa_id = p_empresa
  ),
  items as (
    select (array_agg(trim(x.descripcion) order by x.fecha desc nulls last))[1] as descripcion,
           (array_agg(x.unidad order by x.fecha desc nulls last) filter (where nullif(trim(x.unidad), '') is not null))[1] as unidad,
           (array_agg(round(x.precio, 2) order by x.fecha desc nulls last) filter (where x.precio > 0))[1] as precio,
           (array_agg(x.iva order by x.fecha desc nulls last) filter (where x.iva is not null))[1] as iva,
           (array_agg(trim(x.contraparte) order by x.fecha desc nulls last))[1] as contraparte,
           count(x.fecha) as veces,
           max(x.fecha) as ultima,
           bool_or(x.empresa_id = p_empresa) as misma_empresa
      from partidas x
     group by public.normalizar_texto_sql(x.descripcion), public.normalizar_texto_sql(x.contraparte)
  )
  select jsonb_build_object(
    'contrapartes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nombre', c.nombre, 'veces', c.veces, 'ultima', c.ultima, 'misma_empresa', coalesce(c.misma_empresa, false),
               'rfc', (select b.rfc from public.proveedores_datos_bancarios b where not p_venta and b.clave = public.fn_proveedor_clave(c.nombre) limit 1)
                      ) order by c.misma_empresa desc, c.veces desc, c.nombre)
        from contrapartes c), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'descripcion', i.descripcion, 'unidad', i.unidad, 'precio', i.precio, 'iva', i.iva,
               'contraparte', i.contraparte, 'veces', i.veces, 'ultima', i.ultima, 'misma_empresa', coalesce(i.misma_empresa, false)
                      ) order by i.misma_empresa desc, i.veces desc, i.descripcion)
        from items i), '[]'::jsonb)
  )
$$;
revoke all on function public.fn_ordenes_catalogo_captura(boolean, uuid) from public, anon;
grant execute on function public.fn_ordenes_catalogo_captura(boolean, uuid) to authenticated;
