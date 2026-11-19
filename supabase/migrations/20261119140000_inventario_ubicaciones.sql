-- Racks y niveles de la bodega (19-nov-2026, Mario: "poner una opción de
-- racks y niveles de rack para darle forma" al inventario digital).
-- Cada lugar físico (bodega › rack › nivel › posición) tiene su código
-- (p. ej. B1-R03-N2 o B1-R03-N2-P4) y su etiqueta QR; el conteo lo elige o lo
-- escanea en vez de escribir la ubicación a mano. x/y/ancho/largo/alto quedan
-- para el plano y la vista 3D.
-- Ya aplicada en producción como `inventario_ubicaciones`.

create table if not exists public.inventario_ubicaciones (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  empresa_id uuid not null references public.empresas (id),
  bodega text not null default 'Bodega',
  rack text not null,
  nivel integer check (nivel is null or nivel between 1 and 99),
  posicion integer check (posicion is null or posicion between 1 and 999),
  codigo text not null,
  descripcion text,
  x numeric(8, 2),
  y numeric(8, 2),
  ancho numeric(8, 2),
  largo numeric(8, 2),
  alto numeric(8, 2),
  activo boolean not null default true,
  creado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists inventario_ubicaciones_empresa_idx on public.inventario_ubicaciones (empresa_id, bodega, rack, nivel, posicion);

/** Código del lugar: 3 letras de la bodega + R<rack> + N<nivel> + P<posición>. */
create or replace function public.fn_ubicacion_codigo(p_bodega text, p_rack text, p_nivel integer, p_posicion integer)
returns text language sql immutable set search_path = public, extensions as $$
  select coalesce(nullif(left(regexp_replace(public.normalizar_texto_sql(p_bodega), '[^A-Z0-9]', '', 'g'), 3), ''), 'BOD')
      || '-R' || case when trim(p_rack) ~ '^[0-9]+$' then lpad(trim(p_rack), 2, '0') else upper(regexp_replace(public.normalizar_texto_sql(p_rack), '[^A-Z0-9]', '', 'g')) end
      || case when p_nivel is null then '' else '-N' || p_nivel end
      || case when p_posicion is null then '' else '-P' || p_posicion end
$$;

create or replace function public.inventario_ubicaciones_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.empresas e where e.id = new.empresa_id) then raise exception 'No existe esa empresa.'; end if;
  select e.grupo_id into new.grupo_id from public.empresas e where e.id = new.empresa_id;
  if tg_op = 'INSERT' and new.creado_por is null then new.creado_por := auth.uid(); end if;
  new.bodega := coalesce(nullif(trim(new.bodega), ''), 'Bodega');
  new.rack := trim(new.rack);
  if new.rack = '' then raise exception 'El rack necesita nombre o número.'; end if;
  if new.posicion is not null and new.nivel is null then raise exception 'Una posición necesita su nivel.'; end if;
  if new.codigo is null or trim(new.codigo) = '' or tg_op = 'UPDATE' then
    new.codigo := public.fn_ubicacion_codigo(new.bodega, new.rack, new.nivel, new.posicion);
  end if;
  return new;
end $$;
create or replace trigger inventario_ubicaciones_antes before insert or update on public.inventario_ubicaciones
  for each row execute function public.inventario_ubicaciones_antes();

alter table public.inventario_ubicaciones enable row level security;
grant select, insert, update, delete on public.inventario_ubicaciones to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'inventario_ubicaciones' and policyname = 'frontera_organizacion') then
    create policy frontera_organizacion on public.inventario_ubicaciones as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'inventario_ubicaciones' and policyname = 'espectador_sin_datos') then
    create policy espectador_sin_datos on public.inventario_ubicaciones as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'inventario_ubicaciones' and policyname = 'director_general') then
    create policy director_general on public.inventario_ubicaciones for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'inventario_ubicaciones' and policyname = 'inventario_ubicaciones_select') then
    create policy inventario_ubicaciones_select on public.inventario_ubicaciones for select to authenticated
      using ((select public.auth_rol_definer()) <> 'pendiente');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'inventario_ubicaciones' and policyname = 'inventario_ubicaciones_write') then
    create policy inventario_ubicaciones_write on public.inventario_ubicaciones for all to authenticated
      using ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'almacen']::app_rol[])
             and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
      with check ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'almacen']::app_rol[])
                  and empresa_id = any ((select public.auth_empresas_alcance())::uuid[])
                  and (select public.auth_suscripcion_permite_escribir_definer()));
  end if;
end $$;

create or replace trigger solo_consulta before insert or update or delete on public.inventario_ubicaciones
  for each statement execute function public.bloquear_solo_consulta();

-- El ítem contado apunta al lugar; el texto `ubicacion` queda con el código.
alter table public.conteo_items add column if not exists ubicacion_id uuid references public.inventario_ubicaciones (id);
create index if not exists conteo_items_ubicacion_idx on public.conteo_items (ubicacion_id);

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
  if new.ubicacion_id is not null then
    select * into v_lugar from public.inventario_ubicaciones u where u.id = new.ubicacion_id;
    if v_lugar.id is null then raise exception 'No existe ese lugar de la bodega.'; end if;
    if v_lugar.empresa_id <> new.empresa_id then raise exception 'El lugar % es de otra empresa.', v_lugar.codigo; end if;
    new.ubicacion := v_lugar.codigo;
  end if;
  if tg_op = 'INSERT' then
    if new.contado_por is null then new.contado_por := auth.uid(); end if;
    if new.contado_por is null then raise exception 'No se sabe quién cuenta.'; end if;
    if new.codigo is null or trim(new.codigo) = '' then new.codigo := public.fn_siguiente_folio(new.empresa_id, 'INV'); end if;
    select p.nombre into new.contado_por_nombre from public.profiles p where p.id = new.contado_por;
  end if;
  new.descripcion := trim(new.descripcion);
  new.unidad := coalesce(nullif(trim(new.unidad), ''), 'pza');
  new.ubicacion := nullif(trim(coalesce(new.ubicacion, '')), '');
  new.codigo_barras := nullif(trim(coalesce(new.codigo_barras, '')), '');
  new.updated_at := now();
  return new;
end $$;

/** Lo que hay en cada lugar según el conteo abierto más reciente (o el que se pida). */
create or replace function public.fn_ubicacion_contenido(p_empresa_id uuid, p_conteo_id uuid default null)
returns table(ubicacion_id uuid, codigo text, items bigint, cantidad numeric)
language sql stable set search_path = public as $$
  with c as (
    select coalesce(p_conteo_id, (select id from public.conteos_inventario ci where ci.grupo_id = (select grupo_id from public.empresas where id = p_empresa_id) order by (estado = 'abierto') desc, fecha desc limit 1)) as id
  )
  select u.id, u.codigo, count(i.id), coalesce(sum(i.cantidad), 0)
    from public.inventario_ubicaciones u
    left join public.conteo_items i on i.ubicacion_id = u.id and i.conteo_id = (select id from c)
   where u.empresa_id = p_empresa_id
   group by u.id, u.codigo
$$;
grant execute on function public.fn_ubicacion_contenido(uuid, uuid) to authenticated;
