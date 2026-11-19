-- Pasar ítems del conteo capturados como "Material / artículo" a "Herramienta o
-- equipo" sin borrarlos ni volverlos a capturar (19-nov-2026, Mario: "ya metí
-- casi todo en Material, ¿se le puede pedir a la IA que mueva eso a
-- Herramienta o lo borro y lo vuelvo a meter?").
--
-- fn_conteo_items_a_herramienta(ids[]): por cada ítem del conteo que todavía no
-- es herramienta, da de alta tantas piezas en `herramientas` como diga su
-- cantidad (folio HE-<EMP>-0001 cada una, bitácora 'alta'); la primera pieza se
-- queda en el MISMO renglón INV- (cantidad 1, codigo_barras = folio HE-,
-- herramienta_id) y las demás piezas abren renglones INV- nuevos con la misma
-- persona, empresa, lugar y hora de captura original. Conserva código,
-- ubicación y quién lo contó. Lo hace quien lo contó o quien administra el
-- conteo (admin, corporativo, dirección, almacén), con las mismas guardas que
-- dar de alta una herramienta (fn_conteo_puede_dar_alta).
-- fn_conteo_items_a_material(ids[]): el camino de regreso para un error: la
-- herramienta que nació de ese renglón (nunca asignada ni movida) se da de
-- baja con bitácora y el renglón vuelve a ser material (cantidad = piezas que
-- se juntan en el primer renglón; los renglones extra se borran).
-- Ya aplicada en producción como `conteo_material_a_herramienta`.

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
    if r.herramienta_id is not null then continue; end if; -- ya es herramienta
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
        insert into public.conteo_items (conteo_id, empresa_id, descripcion, cantidad, unidad, ubicacion, ubicacion_id, codigo_barras, notas, herramienta_id, contado_por, created_at)
        values (r.conteo_id, r.empresa_id, r.descripcion, 1, 'pza', case when r.ubicacion_id is null then r.ubicacion end, r.ubicacion_id, v_folio,
                'Pieza ' || i || ' de ' || v_piezas || ' de ' || r.codigo, v_h, r.contado_por, r.created_at)
        returning id, public.conteo_items.codigo into v_item, v_codigo;
      end if;
      item_id := v_item; item_codigo := v_codigo; herramienta_id := v_h; folio := v_folio;
      return next;
    end loop;
  end loop;
end $$;
revoke all on function public.fn_conteo_items_a_herramienta(uuid[]) from public, anon;
grant execute on function public.fn_conteo_items_a_herramienta(uuid[]) to authenticated;

/** Regreso: el renglón vuelve a ser material; su herramienta (si nunca se movió) se da de baja. */
create or replace function public.fn_conteo_items_a_material(p_ids uuid[])
returns table(item_id uuid, item_codigo text, cantidad numeric)
language plpgsql security definer set search_path = public as $$
declare
  r public.conteo_items%rowtype;
  v_rol public.app_rol;
  v_id uuid;
  v_h uuid;
  v_folio text;
  v_grupo text;
  v_extra record;
  n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  select p.rol into v_rol from public.profiles p where p.id = auth.uid();
  for v_id in select distinct unnest(p_ids) loop
    select * into r from public.conteo_items c where c.id = v_id for update;
    if r.id is null then raise exception 'No existe el ítem %.', v_id; end if;
    if r.herramienta_id is null then continue; end if;
    if not (r.contado_por = auth.uid() or v_rol in ('admin', 'corporativo', 'direccion', 'almacen')) then
      raise exception 'Solo quien contó % o quien administra el conteo puede regresarlo a material.', r.codigo using errcode = '42501';
    end if;
    perform public.fn_conteo_puede_dar_alta(r.empresa_id);
    -- Solo si la herramienta nació de ese renglón y nunca se movió (sin asignación, reparación…).
    v_h := r.herramienta_id;
    if exists (select 1 from public.herramienta_movimientos m where m.herramienta_id = v_h and m.tipo <> 'alta')
       or exists (select 1 from public.herramientas h where h.id = v_h and h.estado <> 'disponible') then
      raise exception 'La herramienta de % ya tiene movimientos (asignación, reparación…): no se puede regresar a material.', r.codigo;
    end if;
    select h.folio into v_folio from public.herramientas h where h.id = v_h;
    update public.herramientas h set estado = 'baja', notas = concat_ws(' · ', h.notas, 'Regresada a material en el conteo') where h.id = v_h;
    insert into public.herramienta_movimientos (herramienta_id, empresa_id, tipo, nota, registrado_por)
    values (v_h, r.empresa_id, 'baja', 'Regresada a material en el conteo de inventario (' || r.codigo || ')', coalesce(auth.uid(), r.contado_por));
    update public.conteo_items c
       set herramienta_id = null, codigo_barras = case when c.codigo_barras = v_folio then null else c.codigo_barras end,
           notas = concat_ws(' · ', c.notas, 'regresado a material')
     where c.id = r.id;
    item_id := r.id; item_codigo := r.codigo; cantidad := r.cantidad;
    return next;
  end loop;
end $$;
revoke all on function public.fn_conteo_items_a_material(uuid[]) from public, anon;
grant execute on function public.fn_conteo_items_a_material(uuid[]) to authenticated;
