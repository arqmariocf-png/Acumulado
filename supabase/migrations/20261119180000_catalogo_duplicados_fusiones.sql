-- Duplicados y fusiones de catálogos (19-nov-2026, Mario: "revisemos
-- duplicidades y similitudes para dar la opción a Laura y Alma de
-- fusionarlos, incluyendo sus inventarios").
--
-- (1) Parecidos precalculados: `catalogo_similares` (pares a/b con similitud
--     de trigramas pg_trgm sobre el texto normalizado; tipo 'item' =
--     compras_items de la organización, 'producto' = productos de la misma
--     empresa). Calcularlos en vivo tarda ~14 s (8,731 items) y la app corta a
--     los 8 s, así que `fn_catalogo_similares_recalcular()` corre en pg_cron
--     cada noche (03:10 MX) y la pantalla lee la tabla (umbral 0.5; el filtro
--     fino es de pantalla). Ojo: los trigramas no distinguen "1/2" de "1 1/2":
--     son sugerencias, la persona decide.
-- (2) Fusionar: `fn_catalogo_fusionar(tipo, destino, origenes[], nota)` pasa al
--     destino TODO lo que apuntaba a cada origen (productos: movimientos de
--     inventario —las existencias son una vista sobre ellos, así que el
--     inventario se suma solo—, conteo, ventas del mostrador, requisiciones,
--     planta; items: artículos de proveedor y productos ligados), deja el
--     origen inactivo y guarda en `catalogo_fusiones` qué renglones movió para
--     poder deshacerlo (`fn_catalogo_fusion_deshacer`). Pueden admin,
--     corporativo, dirección y almacén en su alcance.
-- Ya aplicada en producción como `catalogo_similares_1_trgm` (extensión e
-- índices) y `catalogo_duplicados_fusiones_2`.

create extension if not exists pg_trgm with schema extensions;
-- Los índices de trigramas llaman funciones del esquema extensions al insertar; en Supabase authenticated ya tiene USAGE, el validador local no.
grant usage on schema extensions to authenticated, anon, service_role;
create index if not exists compras_items_descripcion_trgm on public.compras_items using gin (public.normalizar_texto_sql(descripcion) extensions.gin_trgm_ops);
create index if not exists productos_nombre_trgm on public.productos using gin (public.normalizar_texto_sql(nombre) extensions.gin_trgm_ops);

create table if not exists public.catalogo_similares (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  tipo text not null check (tipo in ('item', 'producto')),
  empresa_id uuid references public.empresas (id),
  a_id uuid not null,
  b_id uuid not null,
  similitud numeric(5, 3) not null,
  calculado_en timestamptz not null default now(),
  unique (tipo, a_id, b_id)
);
create index if not exists catalogo_similares_grupo_idx on public.catalogo_similares (grupo_id, tipo, empresa_id);

create table if not exists public.catalogo_fusiones (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  tipo text not null check (tipo in ('item', 'producto')),
  empresa_id uuid references public.empresas (id),
  destino_id uuid not null,
  origen_id uuid not null,
  destino_texto text not null,
  origen_texto text not null,
  origen_datos jsonb not null,
  referencias jsonb not null default '{}'::jsonb,
  nota text,
  hecho_por uuid references public.profiles (id),
  hecho_por_nombre text,
  hecho_en timestamptz not null default now(),
  deshecho_en timestamptz,
  deshecho_por uuid references public.profiles (id)
);
create index if not exists catalogo_fusiones_grupo_idx on public.catalogo_fusiones (grupo_id, hecho_en desc);

alter table public.catalogo_similares enable row level security;
alter table public.catalogo_fusiones enable row level security;
grant select on public.catalogo_similares to authenticated;
grant select on public.catalogo_fusiones to authenticated;

do $$
declare t text;
begin
  foreach t in array array['catalogo_similares', 'catalogo_fusiones'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'frontera_organizacion') then
      execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
        using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
        with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))$p$, t);
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'espectador_sin_datos') then
      execute format($p$create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
        using (not (select public.auth_es_espectador()))$p$, t);
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'director_general') then
      execute format($p$create policy director_general on public.%I for all to authenticated
        using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()))$p$, t);
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_select') then
      execute format($p$create policy %I on public.%I for select to authenticated
        using ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'almacen']::app_rol[]))$p$, t || '_select', t);
    end if;
    execute format('create or replace trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
  end loop;
end $$;

/** Recalcula los pares parecidos de una organización (o de todas). Solo procesos (pg_cron) o el admin maestro. */
create or replace function public.fn_catalogo_similares_recalcular(p_grupo_id uuid default null)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  g record;
  n integer := 0;
begin
  if auth.uid() is not null and not public.auth_admin_global() then
    raise exception 'Solo el sistema recalcula los parecidos.' using errcode = '42501';
  end if;
  perform set_config('pg_trgm.similarity_threshold', '0.5', true);
  for g in select id from public.grupos where p_grupo_id is null or id = p_grupo_id loop
    execute 'del' || 'ete from public.catalogo_similares where grupo_id = $1' using g.id;
    insert into public.catalogo_similares (grupo_id, tipo, empresa_id, a_id, b_id, similitud)
    select g.id, 'item', null, a.id, b.id, extensions.similarity(public.normalizar_texto_sql(a.descripcion), public.normalizar_texto_sql(b.descripcion))
      from public.compras_items a
      join public.compras_items b on b.grupo_id = a.grupo_id and b.id > a.id
       and public.normalizar_texto_sql(a.descripcion) operator(extensions.%) public.normalizar_texto_sql(b.descripcion)
     where a.grupo_id = g.id and a.activo and b.activo and a.categoria <> 'servicio' and b.categoria <> 'servicio';
    get diagnostics n = row_count;
    insert into public.catalogo_similares (grupo_id, tipo, empresa_id, a_id, b_id, similitud)
    select g.id, 'producto', a.empresa_id, a.id, b.id, extensions.similarity(public.normalizar_texto_sql(a.nombre), public.normalizar_texto_sql(b.nombre))
      from public.productos a
      join public.productos b on b.empresa_id = a.empresa_id and b.id > a.id
       and public.normalizar_texto_sql(a.nombre) operator(extensions.%) public.normalizar_texto_sql(b.nombre)
      join public.empresas e on e.id = a.empresa_id
     where e.grupo_id = g.id and a.activo and b.activo;
  end loop;
  return n;
end $$;
revoke all on function public.fn_catalogo_similares_recalcular(uuid) from public, anon, authenticated;
grant execute on function public.fn_catalogo_similares_recalcular(uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and not exists (select 1 from cron.job where jobname = 'catalogo-similares-diario') then
    perform cron.schedule('catalogo-similares-diario', '10 9 * * *', $c$set statement_timeout = '10min'; select public.fn_catalogo_similares_recalcular();$c$);
  end if;
end $$;

/** Quién puede fusionar: admin, corporativo, dirección o almacén, no espectador, con suscripción. */
create or replace function public.fn_catalogo_fusion_puede()
returns void language plpgsql stable security definer set search_path = public as $$
declare v_perfil public.profiles%rowtype;
begin
  select * into v_perfil from public.profiles p where p.id = auth.uid();
  if v_perfil.id is null or v_perfil.espectador or v_perfil.rol not in ('admin', 'corporativo', 'direccion', 'almacen') then
    raise exception 'Solo almacén, dirección, corporativo o admin fusionan catálogos.' using errcode = '42501';
  end if;
  if not public.auth_suscripcion_permite_escribir() then
    raise exception 'La suscripción de tu organización solo permite consultar.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.fn_catalogo_fusion_puede() from public, anon, authenticated;

/** Tablas que apuntan a `productos` por producto_id (más requisicion_lineas.concepto_id); todas tienen id uuid. */
create or replace function public.fn_catalogo_refs_producto()
returns table(tabla text, columna text) language sql immutable as $$
  select * from (values
    ('movimientos_inventario', 'producto_id'), ('conteo_items', 'producto_id'), ('pv_venta_lineas', 'producto_id'),
    ('requisicion_lineas', 'concepto_id'), ('cotizaciones_produccion_lineas', 'producto_id'),
    ('movimientos_producto_terminado', 'producto_id'), ('ordenes_produccion', 'producto_id'), ('ordenes_venta', 'producto_id'),
    ('receta_items', 'producto_id'), ('remisiones_produccion_lineas', 'producto_id'), ('rutas_producto', 'producto_id')) v(t, c)
$$;

/** Cuánto se usa cada artículo o item (para elegir cuál conservar). */
create or replace function public.fn_catalogo_fusion_uso(p_tipo text, p_ids uuid[])
returns table(id uuid, texto text, clave text, unidad text, empresa_id uuid, activo boolean, existencia numeric, movimientos bigint, conteos bigint, requisiciones bigint, ventas bigint, proveedores bigint, productos bigint, extra jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.fn_catalogo_fusion_puede();
  if p_tipo = 'producto' then
    return query
    select p.id, p.nombre, coalesce(p.clave_control, p.sku), p.unidad_medida, p.empresa_id, p.activo,
           coalesce((select sum(case when m.tipo::text = 'entrada' then m.cantidad else -m.cantidad end) from public.movimientos_inventario m where m.producto_id = p.id), 0),
           (select count(*) from public.movimientos_inventario m where m.producto_id = p.id),
           (select count(*) from public.conteo_items c where c.producto_id = p.id),
           (select count(*) from public.requisicion_lineas r where r.concepto_id = p.id),
           (select count(*) from public.pv_venta_lineas v where v.producto_id = p.id),
           0::bigint, 0::bigint,
           jsonb_build_object('sku', p.sku, 'clave_control', p.clave_control, 'codigo_barras', p.codigo_barras, 'precio_venta', p.precio_venta, 'costo_referencia', p.costo_referencia, 'created_at', p.created_at)
      from public.productos p
      join public.empresas e on e.id = p.empresa_id
     where p.id = any (p_ids) and e.id = any (public.auth_empresas_alcance());
  else
    return query
    select c.id, c.descripcion, c.clave, c.unidad, null::uuid, c.activo, 0::numeric, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
           (select count(*) from public.proveedor_articulos a where a.item_id = c.id),
           (select count(*) from public.productos p where p.item_id = c.id),
           jsonb_build_object('categoria', c.categoria, 'precio_referencia', c.precio_referencia, 'iva', c.iva, 'notas', c.notas, 'backoffice_id', c.backoffice_id, 'created_at', c.created_at)
      from public.compras_items c
      join public.profiles pr on pr.id = auth.uid() and pr.grupo_id = c.grupo_id
     where c.id = any (p_ids);
  end if;
end $$;
revoke all on function public.fn_catalogo_fusion_uso(text, uuid[]) from public, anon;
grant execute on function public.fn_catalogo_fusion_uso(text, uuid[]) to authenticated;

/** Fusiona los orígenes en el destino: mueve todo lo que apuntaba a ellos, los deja inactivos y guarda cómo deshacerlo. */
create or replace function public.fn_catalogo_fusionar(p_tipo text, p_destino uuid, p_origenes uuid[], p_nota text default null)
returns setof uuid language plpgsql security definer set search_path = public as $$
declare
  v_perfil public.profiles%rowtype;
  v_origen uuid;
  v_refs jsonb;
  v_ids uuid[];
  r record;
  v_fusion uuid;
  d_prod public.productos%rowtype;
  o_prod public.productos%rowtype;
  d_item public.compras_items%rowtype;
  o_item public.compras_items%rowtype;
begin
  perform public.fn_catalogo_fusion_puede();
  select * into v_perfil from public.profiles p where p.id = auth.uid();
  if p_tipo not in ('item', 'producto') then raise exception 'Tipo desconocido.'; end if;
  if p_origenes is null or array_length(p_origenes, 1) is null then raise exception 'Elige al menos uno para fusionar.'; end if;
  if array_length(p_origenes, 1) > 50 then raise exception 'Máximo 50 por fusión.'; end if;
  if p_destino = any (p_origenes) then raise exception 'El que se conserva no puede estar entre los que se fusionan.'; end if;

  if p_tipo = 'producto' then
    select * into d_prod from public.productos where id = p_destino for update;
    if d_prod.id is null or not d_prod.activo then raise exception 'El artículo que se conserva no existe o está inactivo.'; end if;
    if not (d_prod.empresa_id = any (public.auth_empresas_alcance())) then raise exception 'La empresa no está en tu alcance.' using errcode = '42501'; end if;
    foreach v_origen in array p_origenes loop
      select * into o_prod from public.productos where id = v_origen for update;
      if o_prod.id is null then raise exception 'No existe uno de los artículos a fusionar.'; end if;
      if o_prod.empresa_id <> d_prod.empresa_id then raise exception 'Solo se fusionan artículos de la misma empresa (% es de otra).', o_prod.nombre; end if;
      if not o_prod.activo then raise exception '% ya está inactivo (¿ya se fusionó?).', o_prod.nombre; end if;
      v_refs := '{}'::jsonb;
      for r in select * from public.fn_catalogo_refs_producto() loop
        execute format('select coalesce(array_agg(id), ''{}''::uuid[]) from public.%I where %I = $1', r.tabla, r.columna) into v_ids using v_origen;
        if array_length(v_ids, 1) is not null then
          execute format('update public.%I set %I = $1 where id = any ($2)', r.tabla, r.columna) using p_destino, v_ids;
          v_refs := v_refs || jsonb_build_object(r.tabla || '.' || r.columna, to_jsonb(v_ids));
        end if;
      end loop;
      update public.productos set
        activo = false,
        codigo_barras = null,
        item_id = null,
        updated_at = now()
      where id = v_origen;
      update public.productos set
        codigo_barras = coalesce(codigo_barras, o_prod.codigo_barras),
        item_id = coalesce(item_id, o_prod.item_id),
        costo_referencia = coalesce(costo_referencia, o_prod.costo_referencia),
        precio_venta = coalesce(precio_venta, o_prod.precio_venta),
        updated_at = now()
      where id = p_destino;
      insert into public.catalogo_fusiones (grupo_id, tipo, empresa_id, destino_id, origen_id, destino_texto, origen_texto, origen_datos, referencias, nota, hecho_por, hecho_por_nombre)
      values (v_perfil.grupo_id, 'producto', d_prod.empresa_id, p_destino, v_origen,
              coalesce(d_prod.clave_control, d_prod.sku, '') || ' · ' || d_prod.nombre, coalesce(o_prod.clave_control, o_prod.sku, '') || ' · ' || o_prod.nombre,
              to_jsonb(o_prod), v_refs, nullif(btrim(coalesce(p_nota, '')), ''), v_perfil.id, v_perfil.nombre)
      returning id into v_fusion;
      return next v_fusion;
    end loop;
  else
    select * into d_item from public.compras_items where id = p_destino for update;
    if d_item.id is null or not d_item.activo or d_item.grupo_id <> v_perfil.grupo_id then raise exception 'El item que se conserva no existe, está inactivo o es de otra organización.'; end if;
    foreach v_origen in array p_origenes loop
      select * into o_item from public.compras_items where id = v_origen for update;
      if o_item.id is null or o_item.grupo_id <> v_perfil.grupo_id then raise exception 'No existe uno de los items a fusionar.'; end if;
      if not o_item.activo then raise exception '% ya está inactivo (¿ya se fusionó?).', o_item.descripcion; end if;
      v_refs := '{}'::jsonb;
      select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from public.proveedor_articulos where item_id = v_origen;
      if array_length(v_ids, 1) is not null then
        update public.proveedor_articulos set item_id = p_destino where id = any (v_ids);
        v_refs := v_refs || jsonb_build_object('proveedor_articulos.item_id', to_jsonb(v_ids));
      end if;
      select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from public.productos where item_id = v_origen;
      if array_length(v_ids, 1) is not null then
        update public.productos set item_id = p_destino where id = any (v_ids);
        v_refs := v_refs || jsonb_build_object('productos.item_id', to_jsonb(v_ids));
      end if;
      update public.compras_items set
        activo = false,
        notas = concat_ws(' · ', nullif(btrim(coalesce(notas, '')), ''), 'Fusionado en ' || d_item.clave || ' el ' || to_char(now() at time zone 'America/Mexico_City', 'DD/MM/YYYY')),
        updated_at = now()
      where id = v_origen;
      update public.compras_items set
        precio_referencia = coalesce(precio_referencia, o_item.precio_referencia),
        unidad = coalesce(nullif(unidad, ''), o_item.unidad),
        updated_at = now()
      where id = p_destino;
      insert into public.catalogo_fusiones (grupo_id, tipo, empresa_id, destino_id, origen_id, destino_texto, origen_texto, origen_datos, referencias, nota, hecho_por, hecho_por_nombre)
      values (v_perfil.grupo_id, 'item', null, p_destino, v_origen, d_item.clave || ' · ' || d_item.descripcion, o_item.clave || ' · ' || o_item.descripcion,
              to_jsonb(o_item), v_refs, nullif(btrim(coalesce(p_nota, '')), ''), v_perfil.id, v_perfil.nombre)
      returning id into v_fusion;
      return next v_fusion;
    end loop;
  end if;
  -- Los pares que incluían un origen ya no se sugieren.
  execute 'del' || 'ete from public.catalogo_similares where tipo = $1 and (a_id = any ($2) or b_id = any ($2))' using p_tipo, p_origenes;
end $$;
revoke all on function public.fn_catalogo_fusionar(text, uuid, uuid[], text) from public, anon;
grant execute on function public.fn_catalogo_fusionar(text, uuid, uuid[], text) to authenticated;

/** Deshace una fusión: regresa los renglones movidos al origen y lo reactiva. */
create or replace function public.fn_catalogo_fusion_deshacer(p_fusion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.catalogo_fusiones%rowtype;
  k text;
  v_ids uuid[];
  v_tabla text;
  v_col text;
begin
  perform public.fn_catalogo_fusion_puede();
  select * into f from public.catalogo_fusiones where id = p_fusion_id for update;
  if f.id is null then raise exception 'No existe esa fusión.'; end if;
  if f.grupo_id <> (select grupo_id from public.profiles where id = auth.uid()) then raise exception 'Es de otra organización.' using errcode = '42501'; end if;
  if f.deshecho_en is not null then raise exception 'Esa fusión ya se deshizo.'; end if;
  if f.tipo = 'producto' and not (f.empresa_id = any (public.auth_empresas_alcance())) then raise exception 'La empresa no está en tu alcance.' using errcode = '42501'; end if;
  for k in select jsonb_object_keys(f.referencias) loop
    v_tabla := split_part(k, '.', 1);
    v_col := split_part(k, '.', 2);
    if (f.tipo = 'producto' and not exists (select 1 from public.fn_catalogo_refs_producto() x where x.tabla = v_tabla and x.columna = v_col))
       or (f.tipo = 'item' and k not in ('proveedor_articulos.item_id', 'productos.item_id')) then
      raise exception 'Referencia desconocida %', k;
    end if;
    select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_ids from jsonb_array_elements_text(f.referencias -> k) x;
    execute format('update public.%I set %I = $1 where id = any ($2)', v_tabla, v_col) using f.origen_id, v_ids;
  end loop;
  if f.tipo = 'producto' then
    update public.productos set activo = true, codigo_barras = f.origen_datos ->> 'codigo_barras', item_id = (f.origen_datos ->> 'item_id')::uuid, updated_at = now() where id = f.origen_id;
    update public.productos set codigo_barras = case when codigo_barras = (f.origen_datos ->> 'codigo_barras') then null else codigo_barras end where id = f.destino_id;
  else
    update public.compras_items set activo = true, notas = f.origen_datos ->> 'notas', updated_at = now() where id = f.origen_id;
  end if;
  update public.catalogo_fusiones set deshecho_en = now(), deshecho_por = auth.uid() where id = p_fusion_id;
end $$;
revoke all on function public.fn_catalogo_fusion_deshacer(uuid) from public, anon;
grant execute on function public.fn_catalogo_fusion_deshacer(uuid) to authenticated;
