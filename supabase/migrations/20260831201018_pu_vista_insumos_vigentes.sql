-- Catálogo con su costo vigente resuelto en una sola consulta.
--
-- Sin esto la pantalla tendría que pedir el costo insumo por insumo (500
-- llamadas para 500 insumos). El costo se calcula con la MISMA función que usa
-- el motor de costeo, así que lo que ve el usuario en el catálogo y lo que
-- entra al precio unitario no pueden discrepar.
--
-- auth_empresa_id() hace que cada quien vea el precio que le aplica: el propio
-- de su empresa si existe, si no el del grupo.
create view v_pu_insumos_vigentes with (security_invoker = true) as
select
  i.id,
  i.codigo,
  i.descripcion,
  i.unidad,
  i.tipo,
  i.activo,
  fn_pu_costo_insumo(i.id, auth_empresa_id(), current_date) as costo_vigente,
  (
    select max(pr.fecha_vigencia)
    from pu_insumo_precios pr
    where pr.insumo_id = i.id
      and (pr.empresa_id is null or pr.empresa_id = auth_empresa_id())
  ) as cotizado_el
from pu_insumos i;

comment on view v_pu_insumos_vigentes is
  'Catálogo de insumos con el costo que le aplica a quien consulta. costo_vigente NULL significa que el insumo nunca se ha cotizado -- distinto de que cueste cero.';

grant select on v_pu_insumos_vigentes to authenticated;