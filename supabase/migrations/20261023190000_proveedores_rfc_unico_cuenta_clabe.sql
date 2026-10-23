-- Proveedores: un solo RFC y cuenta/CLABE en la ficha (23-oct-2026, Mario:
-- "en el apartado de proveedores agrégales cuenta y CLABE interbancaria";
-- "a Delia a unos proveedores no le muestra el RFC; Laura dice que hay dos
-- campos para RFC: que sea uno solo y unificar los existentes").
--
-- Había dos RFC: `proveedores.rfc` (la ficha del catálogo, la capturan quienes
-- capturan órdenes) y `proveedores_datos_bancarios.rfc` (lo que ven Tesorería,
-- la OC impresa y v_pagos_programados). Si el RFC se capturaba en la ficha,
-- Delia no lo veía. Ahora las dos columnas se mantienen iguales por trigger
-- (en los dos sentidos, por `clave` = fn_proveedor_clave) y los existentes se
-- unificaron: la ficha toma el RFC bancario si no tenía, y toda ficha con RFC
-- deja su renglón bancario (origen 'backoffice' con nota, para que la
-- sincronización del backoffice sí pueda completarle banco/CLABE después).
-- La pantalla Proveedores y artículos ya captura banco, cuenta y CLABE en la
-- misma ficha (un solo RFC) y la lista las muestra
-- (`fn_ordenes_catalogo_captura` devuelve cuenta y clabe; RLS de quien pregunta).
--
-- Ya aplicado en producción (proveedores_rfc_unico_cuenta_clabe).

create or replace function public.proveedores_rfc_a_bancarios()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rfc is null then return null; end if;
  if tg_op = 'UPDATE' and new.rfc is not distinct from old.rfc and new.clave = old.clave then return null; end if;
  insert into public.proveedores_datos_bancarios as t (clave, nombre, rfc, grupo_id, origen, notas, updated_at, updated_by)
  values (new.clave, new.nombre, new.rfc, new.grupo_id, 'backoffice', 'RFC tomado de la ficha del proveedor (catálogo).', now(), auth.uid())
  on conflict (clave) do update set rfc = excluded.rfc, updated_at = now()
   where t.rfc is distinct from excluded.rfc;
  return null;
end;
$$;
create or replace trigger proveedores_rfc_a_bancarios after insert or update of rfc, clave on public.proveedores
  for each row execute function public.proveedores_rfc_a_bancarios();

create or replace function public.bancarios_rfc_a_proveedores()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rfc is null then return null; end if;
  if tg_op = 'UPDATE' and new.rfc is not distinct from old.rfc then return null; end if;
  update public.proveedores p
     set rfc = new.rfc, updated_at = now()
   where p.clave = new.clave and (new.grupo_id is null or p.grupo_id = new.grupo_id)
     and p.rfc is distinct from new.rfc;
  return null;
end;
$$;
create or replace trigger bancarios_rfc_a_proveedores after insert or update of rfc on public.proveedores_datos_bancarios
  for each row execute function public.bancarios_rfc_a_proveedores();

-- Unificar lo que ya existe.
update public.proveedores p
   set rfc = b.rfc, updated_at = now()
  from public.proveedores_datos_bancarios b
 where b.clave = p.clave and p.rfc is null and b.rfc is not null;

insert into public.proveedores_datos_bancarios as t (clave, nombre, rfc, grupo_id, origen, notas, updated_at)
select p.clave, p.nombre, p.rfc, p.grupo_id, 'backoffice', 'RFC tomado de la ficha del proveedor (catálogo).', now()
  from public.proveedores p
 where p.rfc is not null
on conflict (clave) do update set rfc = excluded.rfc, updated_at = now()
 where t.rfc is null;

-- El catálogo de captura trae también cuenta y CLABE (con la RLS de quien pregunta).
create or replace function public.fn_ordenes_catalogo_captura(p_venta boolean, p_empresa uuid)
returns jsonb language sql stable set search_path = public as $$
  with oc as (
    select o.proveedor as contraparte, o.empresa_id, coalesce(o.fecha_creacion, o.created_at::date) as fecha, o.fuente, o.id, o.proyecto
      from public.ordenes_compra o
     where not p_venta and o.rechazada_en is null and nullif(trim(o.proveedor), '') is not null
  ),
  ov as (
    select o.cliente as contraparte, o.empresa_id, coalesce(o.fecha_ov, o.created_at::date) as fecha, o.id, o.proyecto
      from public.ordenes_venta o
     where p_venta and o.cancelada_en is null and nullif(trim(o.cliente), '') is not null
  ),
  fichas as (
    select p.id, p.nombre, p.rfc from public.proveedores p where not p_venta and p.activo
  ),
  usos as (
    select contraparte, empresa_id, fecha, null::text as rfc, false as ficha from oc
    union all select contraparte, empresa_id, fecha, null, false from ov
    union all
    select c.razon_social, c.empresa_id, null::date, c.rfc, true from public.clientes c where p_venta and c.activo and nullif(trim(c.razon_social), '') is not null
    union all
    select f.nombre, null::uuid, null::date, f.rfc, true from fichas f
  ),
  contrapartes as (
    select (array_agg(trim(u.contraparte) order by u.ficha desc, u.fecha desc nulls last))[1] as nombre,
           (array_agg(u.rfc) filter (where u.rfc is not null))[1] as rfc,
           count(u.fecha) as veces,
           max(u.fecha) as ultima,
           bool_or(u.empresa_id = p_empresa or u.ficha) as misma_empresa,
           bool_or(u.ficha) as ficha
      from usos u
     group by public.normalizar_texto_sql(u.contraparte)
  ),
  partidas as (
    select l.item as descripcion, l.unidad, l.iva,
           case when o.fuente = 'api' and coalesce(l.iva, true) then l.costo / 1.16 else l.costo end as precio,
           o.contraparte, o.empresa_id, o.fecha, true as compra
      from public.ordenes_compra_lineas l join oc o on o.id = l.orden_compra_id
     where nullif(trim(l.item), '') is not null
    union all
    select l.concepto, l.unidad, l.iva, l.precio_base, o.contraparte, o.empresa_id, o.fecha, true
      from public.ordenes_venta_lineas l join ov o on o.id = l.orden_venta_id
     where nullif(trim(l.concepto), '') is not null
    union all
    select a.descripcion, a.unidad, a.iva, a.precio, f.nombre, null::uuid, a.updated_at::date, false
      from public.proveedor_articulos a join fichas f on f.id = a.proveedor_id
     where a.activo
    union all
    select ci.descripcion, ci.unidad, ci.iva, ci.precio_referencia, null, null::uuid, ci.updated_at::date, false
      from public.compras_items ci
     where not p_venta and ci.activo
    union all
    select p.nombre, p.unidad_medida, true,
           case when p_venta then p.precio_venta / (1 + coalesce(p.iva_tasa, 0.16)) else p.costo_referencia end,
           null, p.empresa_id, null::date, false
      from public.productos p
     where p.activo and p.empresa_id = p_empresa
  ),
  items as (
    select (array_agg(trim(x.descripcion) order by x.fecha desc nulls last))[1] as descripcion,
           (array_agg(x.unidad order by x.fecha desc nulls last) filter (where nullif(trim(x.unidad), '') is not null))[1] as unidad,
           (array_agg(round(x.precio, 2) order by x.fecha desc nulls last) filter (where x.precio > 0))[1] as precio,
           (array_agg(x.iva order by x.fecha desc nulls last) filter (where x.iva is not null))[1] as iva,
           (array_agg(trim(x.contraparte) order by x.fecha desc nulls last))[1] as contraparte,
           count(*) filter (where x.compra) as veces,
           max(x.fecha) as ultima,
           coalesce(bool_or(x.empresa_id = p_empresa), true) as misma_empresa
      from partidas x
     group by public.normalizar_texto_sql(x.descripcion), public.normalizar_texto_sql(x.contraparte)
  ),
  obras as (
    select (array_agg(trim(o.nombre) order by o.fecha desc nulls last))[1] as nombre, count(o.fecha) as veces, max(o.fecha) as ultima
      from (
        select proyecto as nombre, fecha from oc where empresa_id = p_empresa and nullif(trim(proyecto), '') is not null
        union all select proyecto, fecha from ov where empresa_id = p_empresa and nullif(trim(proyecto), '') is not null
        union all select p.nombre, null::date from public.proyectos p where p.activo and p.empresa_id = p_empresa
        union all select 'Proyecto X', null::date
      ) o
     group by public.normalizar_texto_sql(o.nombre)
  )
  select jsonb_build_object(
    'contrapartes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nombre', c.nombre, 'veces', c.veces, 'ultima', c.ultima, 'misma_empresa', coalesce(c.misma_empresa, false), 'ficha', c.ficha,
               'rfc', coalesce(c.rfc, b.rfc), 'cuenta', b.cuenta, 'clabe', b.clabe
                      ) order by c.misma_empresa desc nulls last, c.veces desc, c.nombre)
        from contrapartes c
        left join lateral (
          select x.rfc, x.cuenta, x.clabe from public.proveedores_datos_bancarios x
           where not p_venta and x.clave = public.fn_proveedor_clave(c.nombre) limit 1) b on true), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'descripcion', i.descripcion, 'unidad', i.unidad, 'precio', i.precio, 'iva', i.iva,
               'contraparte', i.contraparte, 'veces', i.veces, 'ultima', i.ultima, 'misma_empresa', i.misma_empresa
                      ) order by i.misma_empresa desc, i.veces desc, i.descripcion)
        from items i), '[]'::jsonb),
    'obras', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', b.nombre, 'veces', b.veces, 'ultima', b.ultima) order by b.ultima desc nulls last, b.nombre)
        from obras b), '[]'::jsonb)
  )
$$;
