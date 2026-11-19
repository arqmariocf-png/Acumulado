-- Claves nuevas para contar de cero y tablero en vivo del conteo (19-nov-2026,
-- Laura: "la clave de las etiquetas es errónea; las toma sobre cada OC
-- registrada, pero estamos contando de 0; es necesario que las claves que
-- generen sean nuevas y sobre eso poder contabilizar el inventario").
--
-- El `sku` del catálogo de AEP (365) y MCC (24) viene del match de OC/OV
-- ("OC-MWE0CL1R-17"): no sirve de clave de inventario. `productos.clave_control`
-- es la clave propia de control, ART-<EMP>-0001 (`folios_series` serie 'ART'),
-- la misma que ya reciben los artículos dados de alta desde el conteo.
-- `fn_productos_asignar_claves(empresa)` se la pone a todos los activos que no
-- la tienen (en orden de nombre); las etiquetas QR del catálogo y la captura
-- la usan en vez del sku. El sku del match no cambia.
-- Realtime en `conteo_items` para el tablero en vivo de almacén.
-- Ya aplicada en producción como `conteo_claves_control_y_tablero`.

alter table public.productos add column if not exists clave_control text;
create unique index if not exists productos_clave_control_uniq on public.productos (empresa_id, clave_control) where clave_control is not null;

/** Clave de control ART- a todos los artículos activos de la empresa que no la tienen. Devuelve cuántas asignó. */
create or replace function public.fn_productos_asignar_claves(p_empresa_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_perfil public.profiles%rowtype;
  v_grupo uuid;
  r record;
  n integer := 0;
begin
  select * into v_perfil from public.profiles p where p.id = auth.uid();
  if v_perfil.id is null or v_perfil.espectador or v_perfil.rol not in ('admin', 'corporativo', 'direccion', 'almacen') then
    raise exception 'Solo almacén, dirección, corporativo o admin asignan claves de control.' using errcode = '42501';
  end if;
  if not public.auth_suscripcion_permite_escribir() then
    raise exception 'La suscripción de tu organización solo permite consultar.' using errcode = '42501';
  end if;
  select e.grupo_id into v_grupo from public.empresas e where e.id = p_empresa_id;
  if v_grupo is null or (v_grupo <> v_perfil.grupo_id and not public.auth_admin_global()) then
    raise exception 'La empresa no es de tu organización.' using errcode = '42501';
  end if;
  for r in select p.id from public.productos p where p.empresa_id = p_empresa_id and p.activo and p.clave_control is null order by p.nombre, p.created_at loop
    update public.productos set clave_control = public.fn_siguiente_folio(p_empresa_id, 'ART') where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.fn_productos_asignar_claves(uuid) from public, anon;
grant execute on function public.fn_productos_asignar_claves(uuid) to authenticated;

-- El artículo dado de alta desde el conteo lleva la misma clave en sku y en clave_control.
create or replace function public.fn_conteo_alta_producto(p_empresa_id uuid, p_nombre text, p_unidad text default 'pza', p_codigo_barras text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_barras text := nullif(btrim(coalesce(p_codigo_barras, '')), '');
  v_id uuid;
  v_clave text;
begin
  perform public.fn_conteo_puede_dar_alta(p_empresa_id);
  if v_nombre = '' then raise exception 'Escribe el nombre del artículo.'; end if;
  if length(v_nombre) > 300 then raise exception 'El nombre es muy largo (máximo 300 caracteres).'; end if;
  if v_barras is not null then
    select p.id into v_id from public.productos p where p.empresa_id = p_empresa_id and p.codigo_barras = v_barras and p.activo limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  select p.id into v_id from public.productos p
   where p.empresa_id = p_empresa_id and p.activo
     and public.normalizar_texto_sql(p.nombre) = public.normalizar_texto_sql(v_nombre)
   order by p.created_at limit 1;
  if v_id is not null then
    update public.productos set clave_control = public.fn_siguiente_folio(p_empresa_id, 'ART') where id = v_id and clave_control is null;
    return v_id;
  end if;
  v_clave := public.fn_siguiente_folio(p_empresa_id, 'ART');
  insert into public.productos (empresa_id, sku, clave_control, nombre, unidad_medida, codigo_barras, activo)
  values (p_empresa_id, v_clave, v_clave, v_nombre, coalesce(nullif(btrim(p_unidad), ''), 'pza'), v_barras, true)
  returning id into v_id;
  return v_id;
end $$;

-- La etiqueta del artículo trae la clave de control (si no hay, el sku).
create or replace function public.fn_producto_etiqueta(p_id uuid)
returns table(id uuid, empresa_id uuid, sku text, nombre text, unidad_medida text, codigo_barras text)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.empresa_id, coalesce(pr.clave_control, pr.sku), pr.nombre, pr.unidad_medida, pr.codigo_barras
    from public.productos pr
    join public.empresas e on e.id = pr.empresa_id
    join public.profiles p on p.id = auth.uid() and p.grupo_id = e.grupo_id and p.rol <> 'pendiente' and not p.espectador
   where pr.id = p_id
$$;

-- Tablero en vivo: los cambios de conteo_items llegan por realtime (la RLS de select sigue mandando).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conteo_items') then
    alter publication supabase_realtime add table public.conteo_items;
  end if;
end $$;
