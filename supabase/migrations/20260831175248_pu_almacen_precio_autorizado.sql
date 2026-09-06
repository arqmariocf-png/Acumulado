-- Módulo Precios Unitarios: facultad acotada de almacén.
--
-- A almacén le aparecen los materiales que ya cargó supervisión y SOLO puede
-- ponerles precio autorizado y proveedor. No agrega renglones, no borra, no
-- mueve cantidades ni rendimientos: eso es criterio de obra, no de compras.
-- La restricción va por trigger porque RLS filtra renglones, no columnas.

alter table pu_analisis_items
  add column proveedor text,
  add column precio_autorizado_por uuid references profiles(id) on delete set null,
  add column precio_autorizado_en timestamptz;

comment on column pu_analisis_items.costo_congelado is
  'Precio autorizado del renglón. Lo captura almacén durante la revisión de material (o el supervisor si trae cotización cerrada) y gana sobre el costo del catálogo.';
comment on column pu_analisis_items.proveedor is
  'Proveedor con el que almacén autorizó el precio. Va junto al costo, no en el catálogo de insumos: el mismo material se autoriza con distinto proveedor en cada obra.';
comment on column pu_analisis_items.precio_autorizado_en is
  'Sello automático del trigger cuando alguien fija el precio autorizado. No se captura desde la app.';

-- Qué renglones son "material" para efectos de la revisión de almacén: lo que
-- se surte y se cotiza, nunca la mano de obra ni un básico anidado.
create function fn_pu_item_es_de_almacen(p_item pu_analisis_items) returns boolean
language sql
stable
set search_path to 'public'
as $$
  select p_item.insumo_id is not null
     and p_item.base_calculo = 'cantidad'
     and exists (
       select 1 from public.pu_insumos i
       where i.id = p_item.insumo_id
         and i.tipo = any (array['material', 'herramienta', 'equipo']::pu_tipo_insumo[])
     )
$$;

create function restringir_edicion_almacen_pu() returns trigger
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

  if v_rol <> 'almacen' then
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

create trigger restringir_edicion_almacen_pu
  before update on pu_analisis_items
  for each row execute function restringir_edicion_almacen_pu();

-- Se reemplaza la política única FOR ALL: almacén necesita UPDATE, pero no
-- INSERT ni DELETE.
drop policy pu_analisis_items_write on pu_analisis_items;

create function auth_edita_borrador_pu(p_analisis_id uuid) returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.pu_analisis a
    where a.id = p_analisis_id
      and (
        public.auth_rol() = 'admin'
        or (a.estado = 'borrador' and (
              public.auth_es_supervisor_pu(a.proyecto_id)
              or (public.auth_puede_escribir_pu()
                  and (public.auth_ve_todas_empresas() or a.empresa_id = public.auth_empresa_id()))
           ))
      )
  )
$$;

create function auth_revisa_material_pu(p_analisis_id uuid) returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.pu_analisis a
    where a.id = p_analisis_id
      and a.estado = 'en_revision_material'
      and public.auth_rol() = 'almacen'
  )
$$;

create policy pu_analisis_items_insert on pu_analisis_items
  for insert with check (auth_edita_borrador_pu(analisis_id));

create policy pu_analisis_items_update on pu_analisis_items
  for update
  using (auth_edita_borrador_pu(analisis_id) or auth_revisa_material_pu(analisis_id))
  with check (auth_edita_borrador_pu(analisis_id) or auth_revisa_material_pu(analisis_id));

create policy pu_analisis_items_delete on pu_analisis_items
  for delete using (auth_edita_borrador_pu(analisis_id));

-- Almacén no puede cerrar su etapa dejando material sin precio ni proveedor:
-- ese es justamente el entregable de su revisión.
create or replace function validar_flujo_pu_analisis() returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_rol app_rol := auth_rol();
  v_uid uuid := (select auth.uid());
  v_es_supervisor boolean;
  v_transicion text;
  v_faltantes text;
begin
  if v_rol is null then
    return new;
  end if;

  if new.estado is not distinct from old.estado then
    if new.factor_id is distinct from old.factor_id and v_rol <> 'admin' then
      raise exception 'Solo dirección general define el factor de sobrecosto (indirectos y utilidad) del análisis';
    end if;
    return new;
  end if;

  select exists (
    select 1 from proyectos p
    where p.id = new.proyecto_id and p.responsable_id = v_uid
  ) into v_es_supervisor;

  v_transicion := old.estado || '->' || new.estado;

  if new.estado = 'borrador' and old.estado <> 'borrador' then
    if not (v_rol = any (array['almacen', 'direccion', 'admin', 'corporativo']::app_rol[]) or v_es_supervisor) then
      raise exception 'Tu rol (%) no puede regresar el análisis a borrador', v_rol;
    end if;

  elsif v_transicion = 'borrador->en_revision_material' then
    if not (v_es_supervisor or v_rol = any (array['admin', 'corporativo', 'direccion']::app_rol[])) then
      raise exception 'Solo el supervisor del proyecto puede enviar su análisis a revisión de material';
    end if;
    if not exists (select 1 from pu_analisis_items i where i.analisis_id = new.id) then
      raise exception 'No puedes enviar a revisión un análisis sin renglones de mano de obra ni material';
    end if;

  elsif v_transicion = 'en_revision_material->material_confirmado' then
    if v_rol <> all (array['almacen', 'admin']::app_rol[]) then
      raise exception 'La confirmación de material le toca a almacén';
    end if;

    select string_agg(ins.descripcion, ', ')
      into v_faltantes
    from pu_analisis_items i
    join pu_insumos ins on ins.id = i.insumo_id
    where i.analisis_id = new.id
      and fn_pu_item_es_de_almacen(i)
      and (i.costo_congelado is null or i.proveedor is null);

    if v_faltantes is not null then
      raise exception 'Falta precio autorizado o proveedor en: %', v_faltantes;
    end if;

  elsif v_transicion = 'material_confirmado->autorizado' then
    if v_rol <> all (array['direccion', 'admin']::app_rol[]) then
      raise exception 'La autorización (fianzas) le toca a dirección';
    end if;

  elsif v_transicion = 'autorizado->publicado' then
    if v_rol <> 'admin' then
      raise exception 'Solo dirección general publica el precio unitario';
    end if;
    if new.factor_id is null and not new.es_auxiliar then
      raise exception 'No se puede publicar un PU sin factor de sobrecosto: falta definir indirectos y utilidad';
    end if;

  elsif v_transicion = 'publicado->obsoleto' then
    if v_rol <> all (array['admin', 'corporativo']::app_rol[]) then
      raise exception 'Solo dirección general o corporativo dan de baja un PU publicado';
    end if;

  else
    raise exception 'Transición de etapa no permitida: %', v_transicion;
  end if;

  return new;
end;
$$;

-- La bandeja de almacén: exactamente los renglones que Alma tiene que precisar.
create view v_pu_bandeja_almacen with (security_invoker = true) as
select
  i.id as item_id,
  a.id as analisis_id,
  a.codigo as analisis_codigo,
  a.concepto,
  a.unidad as analisis_unidad,
  e.codigo as empresa_codigo,
  py.nombre as proyecto_nombre,
  perfil.nombre as supervisor_nombre,
  ins.codigo as insumo_codigo,
  ins.descripcion as insumo_descripcion,
  ins.unidad as insumo_unidad,
  ins.tipo,
  i.cantidad,
  fn_pu_costo_insumo(i.insumo_id, a.empresa_id) as costo_catalogo,
  i.costo_congelado as precio_autorizado,
  i.proveedor,
  i.precio_autorizado_en,
  (i.costo_congelado is null or i.proveedor is null) as pendiente
from pu_analisis_items i
join pu_analisis a on a.id = i.analisis_id
join pu_insumos ins on ins.id = i.insumo_id
join empresas e on e.id = a.empresa_id
left join proyectos py on py.id = a.proyecto_id
left join profiles perfil on perfil.id = a.creado_por
where a.estado = 'en_revision_material'
  and fn_pu_item_es_de_almacen(i);

comment on view v_pu_bandeja_almacen is
  'Lo que ve almacén: los materiales que supervisión ya cargó, con su costo de catálogo como referencia y las dos únicas columnas que puede llenar (precio autorizado y proveedor).';

grant select on v_pu_bandeja_almacen to authenticated;