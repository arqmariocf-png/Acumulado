-- Alma (almacén) y Laura (dirección) emiten remisiones de salida de planta de
-- TODAS las empresas (20-nov-2026, Mario: "deja a Alma y a Laura poder hacer
-- remisiones de todas las empresas también"). Las remisiones de planta
-- (`remisiones_produccion`: Clavicón, Balken, carpintería) solo las emitía el
-- rol produccion (más admin y corporativo); las de almacén
-- (`remisiones_salida`) las dos ya podían. Aquí se abre a `almacen` y
-- `direccion`, en su alcance de empresas (las dos tienen todas las empresas):
-- emitir la remisión y sus partidas, ver las de planta, leer el catálogo de
-- productos de producción para elegir qué sale y confirmar la entrega.
-- Ya aplicada en producción como `remisiones_planta_almacen_direccion`.

alter policy remisiones_produccion_insert on public.remisiones_produccion
  with check (
    (select public.auth_rol_definer()) in ('produccion', 'admin', 'corporativo', 'almacen', 'direccion')
    and ((select public.auth_ve_todas_empresas_definer()) or empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
    and emitida_por = (select auth.uid())
  );

alter policy remisiones_produccion_select on public.remisiones_produccion
  using (
    (select public.auth_rol_definer()) in ('produccion', 'admin', 'corporativo', 'direccion', 'empresa', 'almacen')
    and ((select public.auth_ve_todas_empresas_definer()) or empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
  );

alter policy remisiones_produccion_lineas_insert on public.remisiones_produccion_lineas
  with check (
    (select public.auth_rol_definer()) in ('produccion', 'admin', 'corporativo', 'almacen', 'direccion')
    and exists (select 1 from public.remisiones_produccion r where r.id = remision_id)
  );

-- Catálogo de productos de la planta, solo lectura, para armar la remisión.
create policy productos_produccion_remision_select on public.productos_produccion for select
  using (
    (select public.auth_rol_definer()) in ('almacen', 'direccion')
    and empresa_id = any ((select public.auth_empresas_alcance())::uuid[])
  );

-- Confirmar la entrega también desde almacén.
create or replace function public.confirmar_entrega_remision_produccion(p_remision_id uuid, p_recibio_nombre text)
returns public.remisiones_produccion language plpgsql security definer set search_path = public as $$
declare
  v_rem public.remisiones_produccion;
begin
  select * into v_rem from public.remisiones_produccion where id = p_remision_id;
  if not found then
    raise exception 'Remisión no encontrada';
  end if;
  if public.auth_rol() not in ('produccion', 'admin', 'corporativo', 'direccion', 'empresa', 'responsable', 'almacen')
     or not public.empresa_en_alcance(v_rem.empresa_id) then
    raise exception 'Sin permiso para confirmar esta remisión';
  end if;
  if v_rem.estatus = 'entregada' then
    raise exception 'Esta remisión ya fue confirmada';
  end if;
  if coalesce(trim(p_recibio_nombre), '') = '' then
    raise exception 'Indica el nombre de quien recibe';
  end if;
  update public.remisiones_produccion
    set estatus = 'entregada', entregada_en = now(), entregada_por = auth.uid(), recibio_nombre = trim(p_recibio_nombre)
    where id = p_remision_id
    returning * into v_rem;
  return v_rem;
end;
$$;
