-- Repara el historial: fn_pu_item_es_de_almacen() se usa en las policies y en
-- las migraciones de Precios Unitarios, pero ninguna la creaba -- vivía solo en
-- el proyecto de Supabase. Sin ella, el repositorio no puede reconstruir la
-- base desde cero. El cuerpo está leído de pg_get_functiondef del proyecto
-- zdqahpzijkkcnfehbggs; en producción es un no-op.
create or replace function public.fn_pu_item_es_de_almacen(p_item public.pu_analisis_items)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_item.insumo_id is not null
     and p_item.base_calculo = 'cantidad'
     and exists (
       select 1 from public.pu_insumos i
       where i.id = p_item.insumo_id
         and i.tipo = any (array['material', 'herramienta', 'equipo']::public.pu_tipo_insumo[])
     )
$$;
