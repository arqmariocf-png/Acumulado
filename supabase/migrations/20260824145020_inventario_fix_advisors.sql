-- Corrige 2 hallazgos reales del linter de Supabase sobre las migraciones de
-- inventario recién aplicadas (el resto de lo que reporta get_advisors ya
-- existía antes de este módulo o es el mismo patrón que el resto del
-- proyecto -- ver PR):
--
-- 1. function_search_path_mutable: validar_empresa_movimiento_inventario no
--    fijaba search_path, a diferencia de las demás funciones del proyecto.
-- 2. auth_rls_initplan: movimientos_inventario_insert llamaba a auth.uid()
--    directo en vez de (select auth.uid()), forzando reevaluación por fila.
--    Mismo tipo de hallazgo que ya se corrigió una vez en este proyecto
--    (fix_performance_advisors), aplicado aquí a la tabla nueva.
--
-- De paso, índices en almacen_id y registrado_por que faltaban (INFO
-- "unindexed_foreign_keys").

create or replace function public.validar_empresa_movimiento_inventario()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.almacenes where id = new.almacen_id and empresa_id = new.empresa_id) then
    raise exception 'El almacén no pertenece a la empresa del movimiento';
  end if;
  if not exists (select 1 from public.productos where id = new.producto_id and empresa_id = new.empresa_id) then
    raise exception 'El producto no pertenece a la empresa del movimiento';
  end if;
  if new.orden_compra_id is not null
    and not exists (select 1 from public.ordenes_compra where id = new.orden_compra_id and empresa_id = new.empresa_id) then
    raise exception 'La orden de compra no pertenece a la empresa del movimiento';
  end if;
  if new.orden_venta_id is not null
    and not exists (select 1 from public.ordenes_venta where id = new.orden_venta_id and empresa_id = new.empresa_id) then
    raise exception 'La orden de venta no pertenece a la empresa del movimiento';
  end if;
  return new;
end;
$$;

drop policy movimientos_inventario_insert on public.movimientos_inventario;

create policy movimientos_inventario_insert on public.movimientos_inventario
  for insert
  with check (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
    and registrado_por = (select auth.uid())
  );

create index movimientos_inventario_almacen_idx on public.movimientos_inventario (almacen_id);
create index movimientos_inventario_registrado_por_idx on public.movimientos_inventario (registrado_por);
