-- Pendientes de Laura (21-oct-2026, WhatsApp):
--  * "en empresas falta poder adjuntar una imagen como logo para que las
--    cotizaciones y notas salgan personalizadas por empresa"
--  * "en el catálogo de clientes hay que importar los clientes de backoffice"
--  * "en items hay que importar items de backoffice"
--
-- 1. `empresas.logo`: la imagen como data URL (png, jpeg o webp; el navegador
--    la reduce antes de subirla, máx. ~300 KB). La editan quienes ya editan
--    empresas (admin y dirección). Los documentos impresos la prefieren sobre
--    /logos/<codigo>.png.
-- 2. `fn_clientes_importar_backoffice()`: da de alta en `clientes` cada
--    cliente de las OV del backoffice (fuente 'api') que no exista ya en esa
--    empresa con el mismo nombre (`fn_proveedor_clave`: sin acentos,
--    puntuación ni "SA DE CV"). La API no manda RFC ni domicilio: se completan
--    a mano.
-- 3. `fn_items_importar_backoffice()`: da de alta en `compras_items` cada
--    partida de OC/OS del backoffice que no exista ya (misma descripción sin
--    acentos/mayúsculas): unidad más usada, precio de referencia = último costo
--    s/IVA (el costo de la API trae IVA), categoría servicio si salió sobre
--    todo en OS. Claves IT-#### consecutivas.
-- Las dos: admin, dirección o quien captura órdenes (las de clientes también
-- quien cotiza), en su alcance; sin usuario (SQL / procesos) todas. Repetirlas
-- solo agrega lo nuevo.
--
-- Ya aplicado en producción (logo_empresa_e_importar_backoffice).

alter table public.empresas add column if not exists logo text;
alter table public.empresas add column if not exists logo_actualizado_en timestamptz;
alter table public.empresas drop constraint if exists empresas_logo_formato;
alter table public.empresas add constraint empresas_logo_formato
  check (logo is null or (logo ~ '^data:image/(png|jpeg|webp);base64,' and length(logo) <= 400000));

create or replace function public.fn_clientes_importar_backoffice()
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_usuario uuid := auth.uid();
  v_rol text := public.auth_rol();
  v_nuevos int;
begin
  if v_usuario is not null
     and not (v_rol in ('admin', 'direccion') or public.auth_captura_ordenes() or public.auth_opera_cotizador()) then
    raise exception 'Solo dirección, administración o quien captura órdenes importa clientes' using errcode = '42501';
  end if;

  with ov as (
    select o.empresa_id, btrim(regexp_replace(o.cliente, '\s+', ' ', 'g')) as nombre,
           public.fn_proveedor_clave(o.cliente) as clave,
           coalesce(o.fecha_ov, o.created_at::date) as fecha
      from public.ordenes_venta o
     where o.fuente = 'api' and o.cliente is not null and btrim(o.cliente) <> ''
       and (v_usuario is null or o.empresa_id = any (public.auth_empresas_alcance()))
  ), ultimo as (
    select distinct on (empresa_id, clave) empresa_id, clave, nombre
      from ov
     where clave is not null and clave <> ''
     order by empresa_id, clave, fecha desc
  ), nuevos as (
    insert into public.clientes (empresa_id, razon_social, notas, activo, created_by)
    select u.empresa_id, u.nombre, 'Importado del backoffice (órdenes de venta). Falta RFC y domicilio.', true, v_usuario
      from ultimo u
     where not exists (
       select 1 from public.clientes c
        where c.empresa_id = u.empresa_id
          and public.fn_proveedor_clave(coalesce(c.razon_social, '')) = u.clave)
    returning 1
  )
  select count(*) into v_nuevos from nuevos;

  return jsonb_build_object('nuevos', v_nuevos);
end;
$$;
revoke all on function public.fn_clientes_importar_backoffice() from public, anon;
grant execute on function public.fn_clientes_importar_backoffice() to authenticated;

create or replace function public.fn_items_importar_backoffice()
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
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
           case when coalesce(l.iva, true) then round(l.costo / 1.16, 2) else round(l.costo, 2) end as precio,
           coalesce(l.iva, true) as iva,
           o.tipo,
           coalesce(o.fecha_creacion, o.created_at::date) as fecha,
           o.id_orden
      from public.ordenes_compra_lineas l
      join public.ordenes_compra o on o.id = l.orden_compra_id
      join public.empresas e on e.id = o.empresa_id
     where o.fuente = 'api' and o.rechazada_en is null
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
           f.iva, f.precio, 'Importado del backoffice (órdenes de compra).', true, v_usuario
      from faltan f
      left join base b on b.grupo_id = f.grupo_id
    on conflict do nothing
    returning 1
  )
  select count(*) into v_nuevos from nuevos;

  return jsonb_build_object('nuevos', v_nuevos);
end;
$$;
revoke all on function public.fn_items_importar_backoffice() from public, anon;
grant execute on function public.fn_items_importar_backoffice() to authenticated;
