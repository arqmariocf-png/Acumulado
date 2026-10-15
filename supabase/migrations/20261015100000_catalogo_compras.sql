-- Catálogo de compras: proveedores y artículos por proveedor, e histórico de
-- costos (15-oct-2026, Mario: "en cuanto a los ítems fíltralos por proveedor
-- para no ver todo el universo; necesitamos el módulo para agregar items y
-- proveedores, por si hay nuevos; también es importante tener el histórico
-- por proveedor de costos").
--
-- - `proveedores`: ficha del proveedor por organización (clave =
--   fn_proveedor_clave(nombre), la misma de datos bancarios y líneas de
--   crédito). Los proveedores que solo existen en OC del backoffice siguen
--   saliendo en el buscador; la ficha se completa cuando se necesite.
-- - `proveedor_articulos`: lista de artículos/servicios de cada proveedor con
--   unidad y precio SIN IVA (lo que se ofrece en el buscador de la OC).
-- - `fn_proveedor_historico_costos(proveedor)`: cada partida comprada a ese
--   proveedor con su precio s/IVA (las OC del backoffice traen IVA dentro).
-- - `fn_ordenes_catalogo_captura` suma la ficha, los artículos de lista y las
--   obras usadas en órdenes de la empresa.
-- Capturan y ven quienes capturan órdenes (`auth_captura_ordenes`). Ya
-- aplicado en producción.

create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  clave text not null,
  nombre text not null check (btrim(nombre) <> ''),
  rfc text,
  contacto text,
  telefono text,
  correo text,
  giro text,
  notas text,
  activo boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grupo_id, clave)
);
create index if not exists proveedores_created_by_idx on public.proveedores (created_by);

create table if not exists public.proveedor_articulos (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  proveedor_id uuid not null references public.proveedores (id) on delete cascade,
  descripcion text not null check (btrim(descripcion) <> ''),
  unidad text,
  precio numeric(14, 2) check (precio is null or precio >= 0),
  iva boolean not null default true,
  notas text,
  activo boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists proveedor_articulos_unico on public.proveedor_articulos (proveedor_id, public.normalizar_texto_sql(descripcion));
create index if not exists proveedor_articulos_grupo_idx on public.proveedor_articulos (grupo_id);
create index if not exists proveedor_articulos_created_by_idx on public.proveedor_articulos (created_by);

-- Clave, organización y fecha de cambio se llenan solas.
create or replace function public.proveedores_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.nombre := btrim(new.nombre);
  new.clave := public.fn_proveedor_clave(new.nombre);
  if new.grupo_id is null then new.grupo_id := public.auth_grupo_id(); end if;
  if new.grupo_id is null then raise exception 'No se pudo determinar la organización del proveedor.'; end if;
  new.rfc := nullif(upper(btrim(coalesce(new.rfc, ''))), '');
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists proveedores_antes on public.proveedores;
create trigger proveedores_antes before insert or update on public.proveedores
  for each row execute function public.proveedores_antes();

create or replace function public.proveedor_articulos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.descripcion := btrim(new.descripcion);
  select p.grupo_id into new.grupo_id from public.proveedores p where p.id = new.proveedor_id;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists proveedor_articulos_antes on public.proveedor_articulos;
create trigger proveedor_articulos_antes before insert or update on public.proveedor_articulos
  for each row execute function public.proveedor_articulos_antes();

-- RLS: frontera, espectador, director general y quienes capturan órdenes.
alter table public.proveedores enable row level security;
alter table public.proveedor_articulos enable row level security;

drop policy if exists frontera_organizacion on public.proveedores;
create policy frontera_organizacion on public.proveedores as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
drop policy if exists espectador_sin_datos on public.proveedores;
create policy espectador_sin_datos on public.proveedores as restrictive for select using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.proveedores;
create policy director_general on public.proveedores for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
drop policy if exists proveedores_select on public.proveedores;
create policy proveedores_select on public.proveedores for select using ((select public.auth_captura_ordenes()));
drop policy if exists proveedores_insert on public.proveedores;
create policy proveedores_insert on public.proveedores for insert with check ((select public.auth_captura_ordenes()));
drop policy if exists proveedores_update on public.proveedores;
create policy proveedores_update on public.proveedores for update using ((select public.auth_captura_ordenes())) with check ((select public.auth_captura_ordenes()));
drop policy if exists proveedores_delete on public.proveedores;
create policy proveedores_delete on public.proveedores for delete
  using ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'direccion'::app_rol]));

drop policy if exists frontera_organizacion on public.proveedor_articulos;
create policy frontera_organizacion on public.proveedor_articulos as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
drop policy if exists espectador_sin_datos on public.proveedor_articulos;
create policy espectador_sin_datos on public.proveedor_articulos as restrictive for select using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.proveedor_articulos;
create policy director_general on public.proveedor_articulos for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
drop policy if exists proveedor_articulos_select on public.proveedor_articulos;
create policy proveedor_articulos_select on public.proveedor_articulos for select using ((select public.auth_captura_ordenes()));
drop policy if exists proveedor_articulos_insert on public.proveedor_articulos;
create policy proveedor_articulos_insert on public.proveedor_articulos for insert with check ((select public.auth_captura_ordenes()));
drop policy if exists proveedor_articulos_update on public.proveedor_articulos;
create policy proveedor_articulos_update on public.proveedor_articulos for update using ((select public.auth_captura_ordenes())) with check ((select public.auth_captura_ordenes()));
drop policy if exists proveedor_articulos_delete on public.proveedor_articulos;
create policy proveedor_articulos_delete on public.proveedor_articulos for delete using ((select public.auth_captura_ordenes()));

drop trigger if exists solo_consulta on public.proveedores;
create trigger solo_consulta before insert or update or delete on public.proveedores
  for each statement execute function public.bloquear_solo_consulta();
drop trigger if exists solo_consulta on public.proveedor_articulos;
create trigger solo_consulta before insert or update or delete on public.proveedor_articulos
  for each statement execute function public.bloquear_solo_consulta();

-- Histórico de costos de un proveedor (corre con la RLS de quien consulta).
create or replace function public.fn_proveedor_historico_costos(p_proveedor text)
returns table (descripcion text, unidad text, fecha date, precio numeric, cantidad numeric, iva boolean, folio text, empresa text, proyecto text, fuente text)
language sql stable set search_path = public as $$
  select btrim(l.item), l.unidad, coalesce(o.fecha_creacion, o.created_at::date),
         round(case when o.fuente = 'api' and coalesce(l.iva, true) then l.costo / 1.16 else l.costo end, 2),
         l.cantidad, l.iva, o.id_orden, e.codigo, o.proyecto, o.fuente
    from public.ordenes_compra_lineas l
    join public.ordenes_compra o on o.id = l.orden_compra_id
    left join public.empresas e on e.id = o.empresa_id
   where o.rechazada_en is null
     and public.normalizar_texto_sql(o.proveedor) = public.normalizar_texto_sql(p_proveedor)
     and l.costo > 0 and nullif(btrim(l.item), '') is not null
   order by 3 desc, o.id_orden desc
$$;
revoke all on function public.fn_proveedor_historico_costos(text) from public, anon;
grant execute on function public.fn_proveedor_historico_costos(text) to authenticated;

-- Catálogo de captura (reemplaza la versión de 20261015090000): + fichas de
-- proveedor, artículos de lista y obras usadas en órdenes de la empresa.
create or replace function public.fn_ordenes_catalogo_captura(p_venta boolean, p_empresa uuid)
returns jsonb
language sql stable set search_path = public as $$
  with oc as (
    select o.proveedor as contraparte, o.empresa_id, coalesce(o.fecha_creacion, o.created_at::date) as fecha, o.fuente, o.id, o.proyecto
      from public.ordenes_compra o
     where not p_venta and o.rechazada_en is null and nullif(trim(o.proveedor), '') is not null
  ),
  ov as (
    select o.cliente as contraparte, o.empresa_id, coalesce(o.fecha_ov, o.created_at::date) as fecha, o.id, o.proyecto
      from public.ordenes_venta o
     where p_venta and o.cancelada_en is null and nullif(trim(o.cliente), '') is not null
  ),
  fichas as (
    select p.id, p.nombre, p.rfc from public.proveedores p where not p_venta and p.activo
  ),
  usos as (
    select contraparte, empresa_id, fecha, null::text as rfc, false as ficha from oc
    union all select contraparte, empresa_id, fecha, null, false from ov
    union all
    select c.razon_social, c.empresa_id, null::date, c.rfc, true from public.clientes c where p_venta and c.activo and nullif(trim(c.razon_social), '') is not null
    union all
    select f.nombre, null::uuid, null::date, f.rfc, true from fichas f
  ),
  contrapartes as (
    select (array_agg(trim(u.contraparte) order by u.ficha desc, u.fecha desc nulls last))[1] as nombre,
           (array_agg(u.rfc) filter (where u.rfc is not null))[1] as rfc,
           count(u.fecha) as veces,
           max(u.fecha) as ultima,
           bool_or(u.empresa_id = p_empresa or u.ficha) as misma_empresa,
           bool_or(u.ficha) as ficha
      from usos u
     group by public.normalizar_texto_sql(u.contraparte)
  ),
  partidas as (
    -- OC del backoffice: el costo ya trae IVA; las de aquí (RQ, IA, Excel) no.
    select l.item as descripcion, l.unidad, l.iva,
           case when o.fuente = 'api' and coalesce(l.iva, true) then l.costo / 1.16 else l.costo end as precio,
           o.contraparte, o.empresa_id, o.fecha, true as compra
      from public.ordenes_compra_lineas l join oc o on o.id = l.orden_compra_id
     where nullif(trim(l.item), '') is not null
    union all
    select l.concepto, l.unidad, l.iva, l.precio_base, o.contraparte, o.empresa_id, o.fecha, true
      from public.ordenes_venta_lineas l join ov o on o.id = l.orden_venta_id
     where nullif(trim(l.concepto), '') is not null
    union all
    select a.descripcion, a.unidad, a.iva, a.precio, f.nombre, null::uuid, a.updated_at::date, false
      from public.proveedor_articulos a join fichas f on f.id = a.proveedor_id
     where a.activo
    union all
    select p.nombre, p.unidad_medida, true,
           case when p_venta then p.precio_venta / (1 + coalesce(p.iva_tasa, 0.16)) else p.costo_referencia end,
           null, p.empresa_id, null::date, false
      from public.productos p
     where p.activo and p.empresa_id = p_empresa
  ),
  items as (
    select (array_agg(trim(x.descripcion) order by x.fecha desc nulls last))[1] as descripcion,
           (array_agg(x.unidad order by x.fecha desc nulls last) filter (where nullif(trim(x.unidad), '') is not null))[1] as unidad,
           (array_agg(round(x.precio, 2) order by x.fecha desc nulls last) filter (where x.precio > 0))[1] as precio,
           (array_agg(x.iva order by x.fecha desc nulls last) filter (where x.iva is not null))[1] as iva,
           (array_agg(trim(x.contraparte) order by x.fecha desc nulls last))[1] as contraparte,
           count(*) filter (where x.compra) as veces,
           max(x.fecha) as ultima,
           coalesce(bool_or(x.empresa_id = p_empresa), true) as misma_empresa
      from partidas x
     group by public.normalizar_texto_sql(x.descripcion), public.normalizar_texto_sql(x.contraparte)
  ),
  obras as (
    select (array_agg(trim(o.nombre) order by o.fecha desc nulls last))[1] as nombre, count(o.fecha) as veces, max(o.fecha) as ultima
      from (
        select proyecto as nombre, fecha from oc where empresa_id = p_empresa and nullif(trim(proyecto), '') is not null
        union all select proyecto, fecha from ov where empresa_id = p_empresa and nullif(trim(proyecto), '') is not null
        union all select p.nombre, null::date from public.proyectos p where p.activo and p.empresa_id = p_empresa
      ) o
     where public.normalizar_texto_sql(o.nombre) <> 'PROYECTO X'
     group by public.normalizar_texto_sql(o.nombre)
  )
  select jsonb_build_object(
    'contrapartes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nombre', c.nombre, 'veces', c.veces, 'ultima', c.ultima, 'misma_empresa', coalesce(c.misma_empresa, false), 'ficha', c.ficha,
               'rfc', coalesce(c.rfc, (select b.rfc from public.proveedores_datos_bancarios b where not p_venta and b.clave = public.fn_proveedor_clave(c.nombre) limit 1))
                      ) order by c.misma_empresa desc nulls last, c.veces desc, c.nombre)
        from contrapartes c), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'descripcion', i.descripcion, 'unidad', i.unidad, 'precio', i.precio, 'iva', i.iva,
               'contraparte', i.contraparte, 'veces', i.veces, 'ultima', i.ultima, 'misma_empresa', i.misma_empresa
                      ) order by i.misma_empresa desc, i.veces desc, i.descripcion)
        from items i), '[]'::jsonb),
    'obras', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', b.nombre, 'veces', b.veces, 'ultima', b.ultima) order by b.ultima desc nulls last, b.nombre)
        from obras b), '[]'::jsonb)
  )
$$;
revoke all on function public.fn_ordenes_catalogo_captura(boolean, uuid) from public, anon;
grant execute on function public.fn_ordenes_catalogo_captura(boolean, uuid) to authenticated;
