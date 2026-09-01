-- Extiende el acceso de escritura de inventario (mismo patrón que el rol
-- 'almacen', ver 20260827030001_almacen_rol_rls.sql) para incluir también
-- 'direccion': Laura Ortaza necesita poder registrar movimientos/subir
-- fotos de notas de entrega, no solo verlos. No se toca auth_puede_escribir()
-- general (bancos/CFDI siguen sin 'direccion') -- solo la variante de
-- inventario.
create or replace function public.auth_puede_escribir_inventario()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_puede_escribir() or public.auth_rol() in ('almacen', 'direccion')
$$;
