-- Corrige un fallo de comparación con NULL: sin sesión (service_role, Edge
-- Functions, migraciones) auth_rol() devuelve NULL, y `NULL <> 'almacen'` no
-- es TRUE sino NULL, así que la guarda no cortaba y el trigger terminaba
-- aplicándole a un proceso interno las restricciones de almacén.
--
-- `is distinct from` sí trata NULL como un valor comparable, que es lo que
-- hacía falta.
create or replace function restringir_edicion_almacen_pu() returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_rol app_rol := auth_rol();
begin
  if new.costo_congelado is distinct from old.costo_congelado
     or new.proveedor is distinct from old.proveedor then
    new.precio_autorizado_por := (select auth.uid());
    new.precio_autorizado_en := now();
  end if;

  -- Sin sesión no hay a quién restringir: los procesos internos no pasan por
  -- el circuito de autorización.
  if v_rol is distinct from 'almacen' then
    return new;
  end if;

  if not fn_pu_item_es_de_almacen(new) then
    raise exception 'Almacén solo captura precio de materiales y equipo; la mano de obra y los básicos son del supervisor';
  end if;

  if new.analisis_id is distinct from old.analisis_id
     or new.insumo_id is distinct from old.insumo_id
     or new.analisis_hijo_id is distinct from old.analisis_hijo_id
     or new.cantidad is distinct from old.cantidad
     or new.rendimiento is distinct from old.rendimiento
     or new.base_calculo is distinct from old.base_calculo
     or new.orden is distinct from old.orden then
    raise exception 'Almacén solo puede capturar el precio autorizado y el proveedor: las cantidades y rendimientos son del supervisor';
  end if;

  return new;
end;
$$;

revoke execute on function restringir_edicion_almacen_pu() from anon, authenticated;