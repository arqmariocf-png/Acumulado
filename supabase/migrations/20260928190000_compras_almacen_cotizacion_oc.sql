-- Almacén resuelve requisiciones, sube la cotización y genera la orden de
-- compra desde la app (Mario por Alma, 28-sep-2026). Antes solo admin y
-- corporativo podían resolver, no había dónde guardar la cotización y la
-- OC tenía que nacer en el backoffice. Las OC que nacen aquí llevan su
-- propia serie de folio (RQ-<empresa>-0001) para distinguirlas de las del
-- backoffice (fuente 'api') y de las capturadas a mano (fuente 'excel').
-- Ya aplicado en producción.

-- 1. Almacén resuelve (compra / entrega) ---------------------------------
drop policy if exists necesidades_compra_write on public.necesidades_compra;
create policy necesidades_compra_write on public.necesidades_compra for all
  using (public.auth_rol() in ('admin', 'corporativo', 'almacen'))
  with check (public.auth_rol() in ('admin', 'corporativo', 'almacen'));
drop policy if exists necesidades_entrega_write on public.necesidades_entrega;
create policy necesidades_entrega_write on public.necesidades_entrega for all
  using (public.auth_rol() in ('admin', 'corporativo', 'almacen'))
  with check (public.auth_rol() in ('admin', 'corporativo', 'almacen'));
-- Almacén ve las necesidades de compra de su alcance (antes: solo quien ve
-- todas, empresa/dirección o el responsable del proyecto).
drop policy if exists necesidades_compra_select on public.necesidades_compra;
create policy necesidades_compra_select on public.necesidades_compra for select
  using (exists (
    select 1 from public.requisicion_lineas rl join public.requisiciones r on r.id = rl.requisicion_id
    where rl.id = necesidades_compra.requisicion_linea_id
      and (public.auth_ve_todas_empresas()
        or (public.auth_rol() in ('empresa', 'direccion', 'almacen') and public.empresa_en_alcance(r.empresa_id))
        or exists (select 1 from public.proyectos p where p.id = r.proyecto_id and (p.responsable_id = (select auth.uid()) or p.comprador_id = (select auth.uid()))))));

-- 2. Cotización en la necesidad de compra ----------------------------------
alter table public.necesidades_compra
  add column if not exists cotizacion_path text,
  add column if not exists cotizacion_nombre text,
  add column if not exists cotizacion_proveedor text,
  add column if not exists cotizacion_costo_unitario numeric(14,4),
  add column if not exists cotizacion_nota text,
  add column if not exists cotizacion_en timestamptz,
  add column if not exists cotizacion_por uuid references public.profiles (id);

-- 3. Serie de folios propia -----------------------------------------------
alter table public.ordenes_compra drop constraint if exists ordenes_compra_fuente_check;
alter table public.ordenes_compra add constraint ordenes_compra_fuente_check check (fuente in ('api', 'excel', 'requisicion'));

create table if not exists public.folios_series (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  serie text not null,
  ultimo integer not null default 0,
  primary key (empresa_id, serie)
);
alter table public.folios_series enable row level security;
drop policy if exists frontera_organizacion on public.folios_series;
create policy frontera_organizacion on public.folios_series as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
drop policy if exists folios_series_select on public.folios_series;
create policy folios_series_select on public.folios_series for select using (public.empresa_en_alcance(empresa_id));
grant select on public.folios_series to authenticated;

-- Siguiente folio de una serie por empresa: RQ-ERG-0001. Definer: la tabla
-- solo se escribe desde aquí.
create or replace function public.fn_siguiente_folio(p_empresa_id uuid, p_serie text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_codigo text;
  v_n integer;
begin
  select codigo into v_codigo from public.empresas where id = p_empresa_id;
  if v_codigo is null then raise exception 'Empresa no encontrada'; end if;
  insert into public.folios_series (empresa_id, serie, ultimo) values (p_empresa_id, p_serie, 1)
  on conflict (empresa_id, serie) do update set ultimo = public.folios_series.ultimo + 1
  returning ultimo into v_n;
  return upper(p_serie) || '-' || upper(v_codigo) || '-' || lpad(v_n::text, 4, '0');
end;
$$;
revoke execute on function public.fn_siguiente_folio(uuid, text) from public, authenticated;

-- 4. Orden de compra desde necesidades de compra ---------------------------
-- p_lineas: [{"necesidad_id": uuid, "costo": numeric}] (costo unitario sin
-- IVA; si viene null se toma el de la cotización). Todas las necesidades
-- deben estar pendientes y ser de la misma empresa. Crea la OC (tipo OC,
-- fuente 'requisicion', folio RQ-…), sus partidas y liga las necesidades.
create or replace function public.fn_oc_desde_necesidades(p_lineas jsonb, p_proveedor text, p_fecha date default current_date, p_iva boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_empresa uuid;
  v_proyecto text;
  v_folio text;
  v_oc_id uuid;
  v_total numeric := 0;
  v_n integer := 0;
  r record;
begin
  if v_rol not in ('admin', 'corporativo', 'almacen') then
    raise exception 'Tu rol (%) no genera órdenes de compra', v_rol using errcode = '42501';
  end if;
  if not public.auth_suscripcion_permite_escribir() then
    raise exception 'La suscripción no permite capturar' using errcode = '42501';
  end if;
  if coalesce(trim(p_proveedor), '') = '' then raise exception 'Indica el proveedor'; end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Elige al menos una necesidad de compra';
  end if;

  -- Validación: pendientes, misma empresa, dentro del alcance.
  for r in
    select nc.id, nc.estado, req.empresa_id, pr.nombre proyecto
    from jsonb_array_elements(p_lineas) l
    join public.necesidades_compra nc on nc.id = (l->>'necesidad_id')::uuid
    join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
    join public.requisiciones req on req.id = rl.requisicion_id
    left join public.proyectos pr on pr.id = req.proyecto_id
  loop
    if r.estado <> 'pendiente' then raise exception 'Una de las necesidades ya no está pendiente'; end if;
    if v_empresa is null then
      v_empresa := r.empresa_id;
      v_proyecto := r.proyecto;
    elsif v_empresa <> r.empresa_id then
      raise exception 'Todas las necesidades deben ser de la misma empresa';
    end if;
  end loop;
  if v_empresa is null then raise exception 'Necesidades no encontradas'; end if;
  if not public.empresa_en_alcance(v_empresa) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;

  v_folio := public.fn_siguiente_folio(v_empresa, 'RQ');
  -- periodo es columna generada a partir de fecha_creacion.
  insert into public.ordenes_compra (id_orden, tipo, empresa_id, proyecto, proveedor, total, fecha_creacion, fuente)
  values (v_folio, 'OC', v_empresa, v_proyecto, trim(p_proveedor), 0, coalesce(p_fecha, current_date), 'requisicion')
  returning id into v_oc_id;

  for r in
    select nc.id, nc.cantidad, rl.unidad_medida,
           coalesce(p.nombre, rl.descripcion, 'Material') item,
           coalesce(nullif(l->>'costo', '')::numeric, nc.cotizacion_costo_unitario, 0) costo
    from jsonb_array_elements(p_lineas) l
    join public.necesidades_compra nc on nc.id = (l->>'necesidad_id')::uuid
    join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
    left join public.productos p on p.id = rl.concepto_id
    order by nc.created_at
  loop
    v_n := v_n + 1;
    insert into public.ordenes_compra_lineas (orden_compra_id, clave, numero, item, unidad, cantidad, costo, iva, fuente)
    values (v_oc_id, r.id::text, v_n, r.item, r.unidad_medida, r.cantidad, r.costo, p_iva, 'requisicion');
    v_total := v_total + r.cantidad * r.costo * case when p_iva then 1.16 else 1 end;
    update public.necesidades_compra
      set estado = 'vinculada', orden_compra_id = v_oc_id, vinculado_por = v_uid, vinculado_at = now()
      where id = r.id;
  end loop;

  update public.ordenes_compra set total = round(v_total, 2) where id = v_oc_id;
  return jsonb_build_object('id', v_oc_id, 'id_orden', v_folio, 'total', round(v_total, 2), 'lineas', v_n);
end;
$$;
grant execute on function public.fn_oc_desde_necesidades(jsonb, text, date, boolean) to authenticated;
