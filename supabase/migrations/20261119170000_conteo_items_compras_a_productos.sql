-- Los 8,700 items del catálogo de compras en el conteo (19-nov-2026, Laura:
-- "en el sistema tenemos más de 4 mil ítems"). El conteo etiqueta `productos`
-- (inventario por empresa: AEP 365) y Laura cuenta con el catálogo de
-- Catálogos › Items (`compras_items`, por organización: 8,263 materiales del
-- backoffice con clave IT-####). Para que cada etiqueta lleve la clave
-- consecutiva de SU empresa (ART-<EMP>-####), el item se da de alta como
-- producto de esa empresa al momento de etiquetarlo o contarlo:
-- `fn_conteo_alta_productos_desde_items(empresa, items[])` llama
-- `fn_conteo_alta_producto` por cada uno (no duplica: por nombre normalizado)
-- y deja la liga `productos.item_id`.
-- Ya aplicada en producción como `conteo_items_compras_a_productos`.

alter table public.productos add column if not exists item_id uuid references public.compras_items (id);
create index if not exists productos_item_idx on public.productos (item_id);

create or replace function public.fn_conteo_alta_productos_desde_items(p_empresa_id uuid, p_item_ids uuid[])
returns table(item_id uuid, producto_id uuid, sku text, nombre text, unidad_medida text, codigo_barras text)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_id uuid;
begin
  if p_item_ids is null or array_length(p_item_ids, 1) is null then return; end if;
  if array_length(p_item_ids, 1) > 500 then raise exception 'Máximo 500 items por vez.'; end if;
  perform public.fn_conteo_puede_dar_alta(p_empresa_id);
  for r in
    select c.id, c.descripcion, c.unidad
      from public.compras_items c
      join public.empresas e on e.id = p_empresa_id and e.grupo_id = c.grupo_id
     where c.id = any (p_item_ids) and c.activo
     order by array_position(p_item_ids, c.id)
  loop
    v_id := public.fn_conteo_alta_producto(p_empresa_id, r.descripcion, coalesce(nullif(btrim(r.unidad), ''), 'pza'), null);
    update public.productos pr set item_id = r.id where pr.id = v_id and pr.item_id is null;
    select pr.id, coalesce(pr.clave_control, pr.sku), pr.nombre, pr.unidad_medida, pr.codigo_barras
      into producto_id, sku, nombre, unidad_medida, codigo_barras
      from public.productos pr where pr.id = v_id;
    item_id := r.id;
    return next;
  end loop;
end $$;
revoke all on function public.fn_conteo_alta_productos_desde_items(uuid, uuid[]) from public, anon;
grant execute on function public.fn_conteo_alta_productos_desde_items(uuid, uuid[]) to authenticated;
