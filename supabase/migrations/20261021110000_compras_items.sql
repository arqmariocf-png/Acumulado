-- Catálogo propio de items de compras (21-oct-2026, Mario: "para compras, un
-- módulo para agregar nuevos items"; eligió "catálogo propio de items": clave,
-- descripción, unidad, categoría, IVA y precio de referencia, sin necesidad de
-- proveedor; que salga al capturar OC/OS y requisiciones; cada proveedor liga
-- su precio al item).
--
-- - `compras_items`: un item por organización (clave única —si no se captura,
--   IT-0001 consecutiva—, descripción única sin acentos ni mayúsculas, unidad,
--   categoría, IVA, precio de referencia SIN IVA, activo). Lo ve cualquiera de
--   la organización que no sea pendiente (requisiciones lo sugieren); dan de
--   alta y corrigen quienes capturan órdenes o cotizan; quitar solo admin y
--   dirección (en pantalla se desactiva).
-- - `proveedor_articulos.item_id`: liga el precio de un proveedor al item.
-- - `fn_item_ultimas_compras(descripcion)`: últimas 20 partidas de OC con la
--   misma descripción, precio s/IVA (RLS de quien consulta).
-- - `fn_ordenes_catalogo_captura` suma los items activos (al capturar OC/OS).
-- Ya aplicado en producción (compras_items).

create table if not exists public.compras_items (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  clave text not null,
  descripcion text not null check (btrim(descripcion) <> ''),
  unidad text,
  categoria text not null default 'material'
    check (categoria in ('material', 'herramienta', 'equipo', 'servicio', 'consumible', 'otro')),
  iva boolean not null default true,
  precio_referencia numeric(14, 2) check (precio_referencia is null or precio_referencia >= 0),
  notas text,
  activo boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grupo_id, clave)
);
create unique index if not exists compras_items_descripcion_unica on public.compras_items (grupo_id, public.normalizar_texto_sql(descripcion));
create index if not exists compras_items_created_by_idx on public.compras_items (created_by);

alter table public.proveedor_articulos add column if not exists item_id uuid references public.compras_items (id) on delete set null;
create index if not exists proveedor_articulos_item_idx on public.proveedor_articulos (item_id);

-- Organización, clave consecutiva y limpieza de textos.
create or replace function public.compras_items_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.descripcion := btrim(regexp_replace(new.descripcion, '\s+', ' ', 'g'));
  new.unidad := nullif(btrim(coalesce(new.unidad, '')), '');
  if new.grupo_id is null then new.grupo_id := public.auth_grupo_id(); end if;
  if new.grupo_id is null then raise exception 'No se pudo determinar la organización del item.'; end if;
  new.clave := nullif(upper(btrim(coalesce(new.clave, ''))), '');
  if new.clave is null then
    select 'IT-' || lpad((coalesce(max(substring(i.clave from '^IT-(\d+)$')::int), 0) + 1)::text, 4, '0')
      into new.clave
      from public.compras_items i
     where i.grupo_id = new.grupo_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists compras_items_antes on public.compras_items;
create trigger compras_items_antes before insert or update on public.compras_items
  for each row execute function public.compras_items_antes();

-- RLS: frontera, espectador, director general; ver la organización, capturar
-- quienes capturan órdenes o cotizan.
alter table public.compras_items enable row level security;

drop policy if exists frontera_organizacion on public.compras_items;
create policy frontera_organizacion on public.compras_items as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
drop policy if exists espectador_sin_datos on public.compras_items;
create policy espectador_sin_datos on public.compras_items as restrictive for select using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.compras_items;
create policy director_general on public.compras_items for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
drop policy if exists compras_items_select on public.compras_items;
create policy compras_items_select on public.compras_items for select
  using ((select public.auth_rol_definer()) <> 'pendiente'::app_rol);
drop policy if exists compras_items_insert on public.compras_items;
create policy compras_items_insert on public.compras_items for insert
  with check ((select public.auth_captura_ordenes()) or (select public.auth_opera_cotizador()));
drop policy if exists compras_items_update on public.compras_items;
create policy compras_items_update on public.compras_items for update
  using ((select public.auth_captura_ordenes()) or (select public.auth_opera_cotizador()))
  with check ((select public.auth_captura_ordenes()) or (select public.auth_opera_cotizador()));
drop policy if exists compras_items_delete on public.compras_items;
create policy compras_items_delete on public.compras_items for delete
  using ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'direccion'::app_rol]));

drop trigger if exists solo_consulta on public.compras_items;
create trigger solo_consulta before insert or update or delete on public.compras_items
  for each statement execute function public.bloquear_solo_consulta();
grant select, insert, update, delete on public.compras_items to authenticated;

-- Últimas compras con la misma descripción (corre con la RLS de quien consulta).
create or replace function public.fn_item_ultimas_compras(p_descripcion text)
returns table (fecha date, folio text, tipo text, proveedor text, empresa text, proyecto text, cantidad numeric, unidad text, precio numeric, fuente text)
language sql stable set search_path = public as $$
  select coalesce(o.fecha_creacion, o.created_at::date), o.id_orden, o.tipo, o.proveedor, e.codigo, o.proyecto,
         l.cantidad, l.unidad,
         round(case when o.fuente = 'api' and coalesce(l.iva, true) then l.costo / 1.16 else l.costo end, 2),
         o.fuente
    from public.ordenes_compra_lineas l
    join public.ordenes_compra o on o.id = l.orden_compra_id
    left join public.empresas e on e.id = o.empresa_id
   where o.rechazada_en is null
     and public.normalizar_texto_sql(l.item) = public.normalizar_texto_sql(p_descripcion)
   order by coalesce(o.fecha_creacion, o.created_at::date) desc, o.id_orden desc
   limit 20;
$$;
revoke all on function public.fn_item_ultimas_compras(text) from public, anon;
grant execute on function public.fn_item_ultimas_compras(text) to authenticated;

-- Los items activos del catálogo también salen en el buscador de OC/OS.
do $x$
declare d text; n text;
begin
  d := pg_get_functiondef('public.fn_ordenes_catalogo_captura(boolean,uuid)'::regprocedure);
  n := replace(d, $r$
    union all
    select p.nombre, p.unidad_medida, true,$r$, $r$
    union all
    select ci.descripcion, ci.unidad, ci.iva, ci.precio_referencia, null, null::uuid, ci.updated_at::date, false
      from public.compras_items ci
     where not p_venta and ci.activo
    union all
    select p.nombre, p.unidad_medida, true,$r$);
  if n = d then raise exception 'fn_ordenes_catalogo_captura no tenía la unión de productos esperada'; end if;
  execute n;
end $x$;
