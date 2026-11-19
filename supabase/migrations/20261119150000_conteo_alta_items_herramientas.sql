-- Alta de ítems y herramientas desde el conteo, con código QR interno de
-- control (19-nov-2026, Mario: "permite agregar ítems y herramientas y este a
-- su vez generarle un código qr interno de control").
--
-- Mientras hay un conteo abierto, cualquiera de la organización (no pendiente,
-- no espectador) puede:
--   * fn_conteo_alta_producto(empresa, nombre, unidad, codigo_barras): dar de
--     alta un artículo en el catálogo `productos` con clave ART-<EMP>-0001
--     (`folios_series` serie 'ART'); si ya existe uno con el mismo nombre o el
--     mismo código de barras en esa empresa, devuelve ese (no duplica). El QR
--     del artículo es el de siempre (/inventario/conteo?producto=<id>).
--   * fn_conteo_alta_herramienta(conteo, empresa, nombre, cantidad, marca,
--     modelo, notas, ubicacion_id, ubicacion): dar de alta N piezas en
--     `herramientas` (folio HE-<EMP>-0001 cada una, bitácora 'alta') y a la vez
--     su renglón del conteo (1 pza, codigo_barras = folio,
--     `conteo_items.herramienta_id`). El QR de control de la herramienta abre
--     /inventario/conteo?herramienta=<folio>, que cualquiera puede leer con
--     fn_herramienta_tarjeta(folio) (quién la tiene, dónde está).
-- Quien ya opera herramienta (almacén, corporativo, admin, empresa, permiso)
-- no necesita el conteo abierto.
-- Ya aplicada en producción como `conteo_alta_items_herramientas`.

alter table public.conteo_items add column if not exists herramienta_id uuid references public.herramientas (id);
create index if not exists conteo_items_herramienta_idx on public.conteo_items (herramienta_id);

/** ¿Puede quien pregunta dar de alta cosas en esta empresa durante el conteo? */
create or replace function public.fn_conteo_puede_dar_alta(p_empresa_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_perfil public.profiles%rowtype;
  v_grupo uuid;
begin
  select * into v_perfil from public.profiles p where p.id = auth.uid();
  if v_perfil.id is null or v_perfil.rol = 'pendiente' or v_perfil.espectador then
    raise exception 'Tu cuenta no puede dar de alta inventario.' using errcode = '42501';
  end if;
  if not public.auth_suscripcion_permite_escribir() then
    raise exception 'La suscripción de tu organización solo permite consultar.' using errcode = '42501';
  end if;
  select e.grupo_id into v_grupo from public.empresas e where e.id = p_empresa_id and e.activo;
  if v_grupo is null or v_grupo <> v_perfil.grupo_id then
    raise exception 'La empresa no es de tu organización.' using errcode = '42501';
  end if;
  if v_perfil.rol in ('admin', 'corporativo', 'direccion', 'almacen') or public.auth_opera_herramienta() then return; end if;
  if not exists (select 1 from public.conteos_inventario c where c.grupo_id = v_grupo and c.estado = 'abierto') then
    raise exception 'Solo se dan de alta ítems y herramientas mientras hay un conteo de inventario abierto.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.fn_conteo_puede_dar_alta(uuid) from public, anon, authenticated;

/** Artículo nuevo en el catálogo de la empresa (clave ART-<EMP>-0001). Si ya existe, devuelve el que hay. */
create or replace function public.fn_conteo_alta_producto(p_empresa_id uuid, p_nombre text, p_unidad text default 'pza', p_codigo_barras text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_barras text := nullif(btrim(coalesce(p_codigo_barras, '')), '');
  v_id uuid;
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
  if v_id is not null then return v_id; end if;
  insert into public.productos (empresa_id, sku, nombre, unidad_medida, codigo_barras, activo)
  values (p_empresa_id, public.fn_siguiente_folio(p_empresa_id, 'ART'), v_nombre, coalesce(nullif(btrim(p_unidad), ''), 'pza'), v_barras, true)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.fn_conteo_alta_producto(uuid, text, text, text) from public, anon;
grant execute on function public.fn_conteo_alta_producto(uuid, text, text, text) to authenticated;

/** N herramientas nuevas (folio HE- cada una) y su renglón en el conteo. */
create or replace function public.fn_conteo_alta_herramienta(
  p_conteo_id uuid, p_empresa_id uuid, p_nombre text, p_cantidad integer default 1,
  p_marca text default null, p_modelo text default null, p_notas text default null,
  p_ubicacion_id uuid default null, p_ubicacion text default null)
returns table(herramienta_id uuid, folio text, item_id uuid, item_codigo text)
language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_estado text;
  v_grupo uuid;
  v_desc text;
  v_h uuid;
  v_folio text;
  v_item uuid;
  v_codigo text;
  i integer;
begin
  perform public.fn_conteo_puede_dar_alta(p_empresa_id);
  if v_nombre = '' then raise exception 'Escribe el nombre de la herramienta.'; end if;
  if coalesce(p_cantidad, 1) < 1 or p_cantidad > 100 then raise exception 'Cantidad de piezas entre 1 y 100.'; end if;
  select c.estado, c.grupo_id into v_estado, v_grupo from public.conteos_inventario c where c.id = p_conteo_id;
  if v_estado is null then raise exception 'No existe ese conteo.'; end if;
  if v_estado <> 'abierto' then raise exception 'Este conteo ya está cerrado.'; end if;
  if not exists (select 1 from public.empresas e where e.id = p_empresa_id and e.grupo_id = v_grupo) then
    raise exception 'La empresa no es de la organización del conteo.';
  end if;
  v_desc := concat_ws(' ', v_nombre, nullif(btrim(coalesce(p_marca, '')), ''), nullif(btrim(coalesce(p_modelo, '')), ''));
  for i in 1 .. coalesce(p_cantidad, 1) loop
    insert into public.herramientas (empresa_id, nombre, categoria, marca, modelo, condicion, notas, created_by)
    values (p_empresa_id, v_nombre, 'herramienta', nullif(btrim(coalesce(p_marca, '')), ''), nullif(btrim(coalesce(p_modelo, '')), ''), 'buena',
            nullif(btrim(coalesce(p_notas, '')), ''), auth.uid())
    returning id, public.herramientas.folio into v_h, v_folio;
    insert into public.herramienta_movimientos (herramienta_id, empresa_id, tipo, condicion, nota, registrado_por)
    values (v_h, p_empresa_id, 'alta', 'buena', 'Alta en el conteo de inventario', auth.uid());
    insert into public.conteo_items (conteo_id, empresa_id, descripcion, cantidad, unidad, ubicacion, ubicacion_id, codigo_barras, notas, herramienta_id, contado_por)
    values (p_conteo_id, p_empresa_id, v_desc, 1, 'pza', case when p_ubicacion_id is null then nullif(btrim(coalesce(p_ubicacion, '')), '') end,
            p_ubicacion_id, v_folio, nullif(btrim(coalesce(p_notas, '')), ''), v_h, auth.uid())
    returning id, public.conteo_items.codigo into v_item, v_codigo;
    herramienta_id := v_h; folio := v_folio; item_id := v_item; item_codigo := v_codigo;
    return next;
  end loop;
end $$;
revoke all on function public.fn_conteo_alta_herramienta(uuid, uuid, text, integer, text, text, text, uuid, text) from public, anon;
grant execute on function public.fn_conteo_alta_herramienta(uuid, uuid, text, integer, text, text, text, uuid, text) to authenticated;

/** Lo que dice el QR de control de una herramienta: qué es, de quién, dónde (cualquiera de la organización). */
create or replace function public.fn_herramienta_tarjeta(p_folio text)
returns table(id uuid, folio text, nombre text, marca text, modelo text, estado text, condicion text, empresa_id uuid, empresa text,
              responsable_nombre text, proyecto_id uuid, obra text, devolver_el date, ultimo_conteo_codigo text, ultimo_conteo_ubicacion text, ultimo_conteo_en timestamptz)
language sql stable security definer set search_path = public as $$
  select h.id, h.folio, h.nombre, h.marca, h.modelo, h.estado, h.condicion, h.empresa_id, e.nombre,
         h.responsable_nombre, h.proyecto_id, pr.nombre, h.devolver_el,
         ci.codigo, ci.ubicacion, ci.created_at
    from public.herramientas h
    join public.empresas e on e.id = h.empresa_id
    join public.profiles p on p.id = auth.uid() and p.grupo_id = e.grupo_id and p.rol <> 'pendiente' and not p.espectador
    left join public.proyectos pr on pr.id = h.proyecto_id
    left join lateral (select c.codigo, c.ubicacion, c.created_at from public.conteo_items c where c.herramienta_id = h.id order by c.created_at desc limit 1) ci on true
   where upper(btrim(h.folio)) = upper(btrim(p_folio))
   limit 1
$$;
revoke all on function public.fn_herramienta_tarjeta(text) from public, anon;
grant execute on function public.fn_herramienta_tarjeta(text) to authenticated;

/** Datos de un artículo para su etiqueta QR (cualquiera de la organización, aunque su RLS de productos no lo deje leer). */
create or replace function public.fn_producto_etiqueta(p_id uuid)
returns table(id uuid, empresa_id uuid, sku text, nombre text, unidad_medida text, codigo_barras text)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.empresa_id, pr.sku, pr.nombre, pr.unidad_medida, pr.codigo_barras
    from public.productos pr
    join public.empresas e on e.id = pr.empresa_id
    join public.profiles p on p.id = auth.uid() and p.grupo_id = e.grupo_id and p.rol <> 'pendiente' and not p.espectador
   where pr.id = p_id
$$;
revoke all on function public.fn_producto_etiqueta(uuid) from public, anon;
grant execute on function public.fn_producto_etiqueta(uuid) to authenticated;
