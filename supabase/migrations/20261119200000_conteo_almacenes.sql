-- Almacenes con nombre para dividir el conteo (19-nov-2026, Mario: "crea
-- también almacenes con nombre para poder dividirlos").
--
-- `almacenes` ya existía (uno "Almacén principal" por empresa, el que usan el
-- punto de venta y los movimientos de inventario: siempre el más viejo por
-- `created_at`). Ahora cada empresa puede tener varios con nombre (Bodega de
-- material, Zona BBVA, Herrería…): se dan de alta en la pantalla del conteo
-- (admin, corporativo, dirección, almacén y empresa en su alcance; antes solo
-- corporativo/empresa/admin), cada ítem del conteo lleva `almacen_id`, los
-- racks (`inventario_ubicaciones.almacen_id`) cuelgan de un almacén y, al
-- contar en un rack, el ítem toma el almacén del rack.
-- Ya aplicada en producción como `conteo_almacenes`.

alter table public.almacenes add column if not exists descripcion text;
alter table public.conteo_items add column if not exists almacen_id uuid references public.almacenes (id);
create index if not exists conteo_items_almacen_idx on public.conteo_items (almacen_id);
alter table public.inventario_ubicaciones add column if not exists almacen_id uuid references public.almacenes (id);
create index if not exists inventario_ubicaciones_almacen_idx on public.inventario_ubicaciones (almacen_id);

-- Quién da de alta y edita almacenes: también dirección y almacén (las policies
-- de siempre son de corporativo/empresa/admin y de quien escribe inventario).
create policy almacenes_conteo_insert on public.almacenes for insert to authenticated
  with check (
    (select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'almacen', 'empresa']::app_rol[])
    and (select public.auth_suscripcion_permite_escribir_definer())
    and ((select public.auth_admin_global_definer()) or ('inventario'::text = any ((select public.auth_modulos_habilitados())::text[])))
    and empresa_id = any ((select public.auth_empresas_alcance())::uuid[])
  );
create policy almacenes_conteo_update on public.almacenes for update to authenticated
  using (
    (select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'almacen', 'empresa']::app_rol[])
    and (select public.auth_suscripcion_permite_escribir_definer())
    and ((select public.auth_admin_global_definer()) or ('inventario'::text = any ((select public.auth_modulos_habilitados())::text[])))
    and empresa_id = any ((select public.auth_empresas_alcance())::uuid[])
  )
  with check (
    (select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'almacen', 'empresa']::app_rol[])
    and (select public.auth_suscripcion_permite_escribir_definer())
    and ((select public.auth_admin_global_definer()) or ('inventario'::text = any ((select public.auth_modulos_habilitados())::text[])))
    and empresa_id = any ((select public.auth_empresas_alcance())::uuid[])
  );

-- Los racks: el almacén tiene que ser de la misma empresa; sin bodega escrita, la bodega es el nombre del almacén.
create or replace function public.inventario_ubicaciones_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_alm_nombre text;
begin
  if not exists (select 1 from public.empresas e where e.id = new.empresa_id) then raise exception 'No existe esa empresa.'; end if;
  select e.grupo_id into new.grupo_id from public.empresas e where e.id = new.empresa_id;
  if tg_op = 'INSERT' and new.creado_por is null then new.creado_por := auth.uid(); end if;
  if new.almacen_id is not null then
    select a.nombre into v_alm_nombre from public.almacenes a where a.id = new.almacen_id and a.empresa_id = new.empresa_id;
    if v_alm_nombre is null then raise exception 'El almacén no es de esta empresa.'; end if;
    if nullif(trim(coalesce(new.bodega, '')), '') is null or trim(new.bodega) = 'Bodega' then new.bodega := v_alm_nombre; end if;
  end if;
  new.bodega := coalesce(nullif(trim(new.bodega), ''), 'Bodega');
  new.rack := trim(new.rack);
  if new.rack = '' then raise exception 'El rack necesita nombre o número.'; end if;
  if new.posicion is not null and new.nivel is null then raise exception 'Una posición necesita su nivel.'; end if;
  if new.codigo is null or trim(new.codigo) = '' or tg_op = 'UPDATE' then
    new.codigo := public.fn_ubicacion_codigo(new.bodega, new.rack, new.nivel, new.posicion);
  end if;
  return new;
end $$;

-- El ítem del conteo: el almacén tiene que ser de su empresa; si el lugar (rack) tiene almacén, el ítem lo toma.
create or replace function public.conteo_items_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_grupo uuid;
  v_estado text;
  v_lugar public.inventario_ubicaciones%rowtype;
begin
  select c.grupo_id, c.estado into v_grupo, v_estado from public.conteos_inventario c where c.id = new.conteo_id;
  if v_grupo is null then raise exception 'No existe ese conteo.'; end if;
  if tg_op = 'INSERT' and v_estado <> 'abierto' then raise exception 'Este conteo ya está cerrado: ya no se capturan ítems.'; end if;
  new.grupo_id := v_grupo;
  if not exists (select 1 from public.empresas e where e.id = new.empresa_id and e.grupo_id = v_grupo) then
    raise exception 'La empresa no es de esta organización.';
  end if;
  if tg_op = 'INSERT' then
    if new.contado_por is null then new.contado_por := auth.uid(); end if;
    if new.contado_por is null then raise exception 'No se sabe quién cuenta.'; end if;
    if new.codigo is null or trim(new.codigo) = '' then new.codigo := public.fn_siguiente_folio(new.empresa_id, 'INV'); end if;
    select p.nombre into new.contado_por_nombre from public.profiles p where p.id = new.contado_por;
  end if;
  if new.ubicacion_id is not null then
    select * into v_lugar from public.inventario_ubicaciones u where u.id = new.ubicacion_id;
    if v_lugar.id is null then raise exception 'No existe ese lugar de la bodega.'; end if;
    if v_lugar.empresa_id <> new.empresa_id then raise exception 'El lugar % es de otra empresa.', v_lugar.codigo; end if;
    new.ubicacion := v_lugar.codigo;
    if v_lugar.almacen_id is not null then new.almacen_id := v_lugar.almacen_id; end if;
  end if;
  if new.almacen_id is not null and not exists (select 1 from public.almacenes a where a.id = new.almacen_id and a.empresa_id = new.empresa_id) then
    raise exception 'El almacén no es de esta empresa.';
  end if;
  new.descripcion := trim(new.descripcion);
  new.unidad := coalesce(nullif(trim(new.unidad), ''), 'pza');
  new.ubicacion := nullif(trim(coalesce(new.ubicacion, '')), '');
  new.codigo_barras := nullif(trim(coalesce(new.codigo_barras, '')), '');
  new.updated_at := now();
  return new;
end $$;

-- Al pasar material a herramienta, las piezas extra conservan el almacén.
create or replace function public.fn_conteo_items_a_herramienta(p_ids uuid[])
returns table(item_id uuid, item_codigo text, herramienta_id uuid, folio text)
language plpgsql security definer set search_path = public as $$
declare
  r public.conteo_items%rowtype;
  v_rol public.app_rol;
  v_estado text;
  v_piezas integer;
  v_h uuid;
  v_folio text;
  v_item uuid;
  v_codigo text;
  v_nota text;
  i integer;
  v_id uuid;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  if cardinality(p_ids) > 300 then raise exception 'Máximo 300 ítems por llamada.'; end if;
  select p.rol into v_rol from public.profiles p where p.id = auth.uid();
  for v_id in select distinct unnest(p_ids) loop
    select * into r from public.conteo_items c where c.id = v_id for update;
    if r.id is null then raise exception 'No existe el ítem %.', v_id; end if;
    if r.herramienta_id is not null then continue; end if;
    if not (r.contado_por = auth.uid() or v_rol in ('admin', 'corporativo', 'direccion', 'almacen')) then
      raise exception 'Solo quien contó % o quien administra el conteo puede pasarlo a herramienta.', r.codigo using errcode = '42501';
    end if;
    perform public.fn_conteo_puede_dar_alta(r.empresa_id);
    select c.estado into v_estado from public.conteos_inventario c where c.id = r.conteo_id;
    if v_estado <> 'abierto' then raise exception 'El conteo de % ya está cerrado.', r.codigo; end if;
    v_piezas := greatest(1, round(r.cantidad)::integer);
    if v_piezas > 100 then raise exception '% tiene % piezas; una herramienta se da de alta pieza por pieza hasta 100.', r.codigo, v_piezas; end if;
    v_nota := 'Del conteo ' || r.codigo || coalesce(' · ' || r.ubicacion, '');
    for i in 1 .. v_piezas loop
      insert into public.herramientas (empresa_id, nombre, categoria, condicion, notas, created_by)
      values (r.empresa_id, left(r.descripcion, 200), 'herramienta', 'buena', v_nota, coalesce(auth.uid(), r.contado_por))
      returning id, public.herramientas.folio into v_h, v_folio;
      insert into public.herramienta_movimientos (herramienta_id, empresa_id, tipo, condicion, nota, registrado_por)
      values (v_h, r.empresa_id, 'alta', 'buena', 'Alta desde el conteo de inventario (' || r.codigo || ', pasado de material a herramienta)', coalesce(auth.uid(), r.contado_por));
      if i = 1 then
        update public.conteo_items c
           set herramienta_id = v_h, codigo_barras = v_folio, cantidad = 1, unidad = 'pza',
               notas = concat_ws(' · ', c.notas, case when v_piezas > 1 then 'eran ' || v_piezas || ' piezas como material; ahora una por renglón' else 'pasado de material a herramienta' end)
         where c.id = r.id;
        v_item := r.id; v_codigo := r.codigo;
      else
        insert into public.conteo_items (conteo_id, empresa_id, descripcion, cantidad, unidad, ubicacion, ubicacion_id, almacen_id, codigo_barras, notas, herramienta_id, contado_por, created_at)
        values (r.conteo_id, r.empresa_id, r.descripcion, 1, 'pza', case when r.ubicacion_id is null then r.ubicacion end, r.ubicacion_id, r.almacen_id, v_folio,
                'Pieza ' || i || ' de ' || v_piezas || ' de ' || r.codigo, v_h, r.contado_por, r.created_at)
        returning id, public.conteo_items.codigo into v_item, v_codigo;
      end if;
      item_id := v_item; item_codigo := v_codigo; herramienta_id := v_h; folio := v_folio;
      return next;
    end loop;
  end loop;
end $$;
