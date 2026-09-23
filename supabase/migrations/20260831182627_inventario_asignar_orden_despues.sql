-- Excepción puntual a la inmutabilidad de movimientos_inventario (ver
-- comentario en movimientos_inventario_insert, 20260824144748_inventario_rls.sql):
-- cuando el almacén recibe/embarca algo sin saber todavía a qué orden
-- corresponde, guarda el movimiento sin vincular (orden_compra_id/
-- orden_venta_id null) y lo asigna después, en cuanto lo confirma. Esta
-- función es la ÚNICA forma de "editar" un movimiento ya guardado: solo
-- toca orden_compra_id/orden_venta_id, solo mientras siga en null (nunca
-- reemplaza un vínculo ya asignado), nunca en ajustes (no llevan orden), y
-- corre como security definer para no requerir abrir UPDATE por RLS en la
-- tabla completa. El trigger de auditoría ya existente sigue registrando el
-- cambio igual que cualquier otro UPDATE.
create or replace function public.asignar_orden_movimiento_inventario(
  p_movimiento_id uuid,
  p_orden_id uuid
)
returns public.movimientos_inventario
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mov public.movimientos_inventario;
begin
  select * into v_mov from public.movimientos_inventario where id = p_movimiento_id;
  if not found then
    raise exception 'Movimiento no encontrado';
  end if;

  if not (
    public.auth_puede_escribir_inventario()
    and (public.auth_ve_todas_empresas() or v_mov.empresa_id = public.auth_empresa_id())
  ) then
    raise exception 'Sin permiso para modificar este movimiento';
  end if;

  if v_mov.es_ajuste then
    raise exception 'Los ajustes no se vinculan a una orden';
  end if;

  if v_mov.tipo = 'entrada' then
    if v_mov.orden_compra_id is not null then
      raise exception 'Este movimiento ya está vinculado a una orden de compra';
    end if;
    if not exists (select 1 from public.ordenes_compra where id = p_orden_id and empresa_id = v_mov.empresa_id) then
      raise exception 'La orden de compra no pertenece a la empresa del movimiento';
    end if;
    update public.movimientos_inventario set orden_compra_id = p_orden_id where id = p_movimiento_id returning * into v_mov;
  else
    if v_mov.orden_venta_id is not null then
      raise exception 'Este movimiento ya está vinculado a una orden de venta';
    end if;
    if not exists (select 1 from public.ordenes_venta where id = p_orden_id and empresa_id = v_mov.empresa_id) then
      raise exception 'La orden de venta no pertenece a la empresa del movimiento';
    end if;
    update public.movimientos_inventario set orden_venta_id = p_orden_id where id = p_movimiento_id returning * into v_mov;
  end if;

  return v_mov;
end;
$$;

revoke all on function public.asignar_orden_movimiento_inventario(uuid, uuid) from public;
grant execute on function public.asignar_orden_movimiento_inventario(uuid, uuid) to authenticated;
