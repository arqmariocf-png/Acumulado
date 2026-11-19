-- Conteo físico de inventario (19-nov-2026, Mario: "agrega a todos para el
-- día de hoy un módulo de inventarios: todos van a contar y subir códigos con
-- los ítems existentes, así como códigos QR para tener todos los ítems
-- identificados; envíales una notificación donde van a tener el módulo de
-- manera directa; registra la fecha y los ítems que harán todos y cada uno y
-- también a las empresas que pertenece el inventario").
--
--   * conteos_inventario: una jornada de conteo por organización y fecha
--     (abierto → cerrado). La abren admin, corporativo, dirección o almacén.
--   * conteo_items: cada ítem que alguien cuenta: empresa dueña del
--     inventario, descripción, cantidad, unidad, ubicación, el código de
--     barras que trae el artículo (si tiene) y el código propio
--     INV-<EMPRESA>-0001 (fn_siguiente_folio, serie 'INV') que va en la
--     etiqueta QR. Guarda quién lo contó (y su nombre: profiles solo deja
--     leer el renglón propio) y cuándo. Cualquiera de la organización
--     (menos pendiente/espectador) captura a su nombre y ve lo de todos;
--     corrige o borra lo suyo; admin/corporativo/dirección/almacén todo.
--   * fn_conteo_resumen(conteo): cuántos ítems y cuánto contó cada persona en
--     cada empresa.
--   * fn_conteo_avisar(conteo): push "Conteo de inventario" a toda la
--     organización con la liga directa /inventario/conteo (fn_push_aviso).
-- Ya aplicado en producción.

create table if not exists public.conteos_inventario (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  fecha date not null default (now() at time zone 'America/Mexico_City')::date,
  nombre text not null default 'Conteo de inventario',
  instrucciones text,
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  creado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  cerrado_en timestamptz,
  unique (grupo_id, fecha)
);

create table if not exists public.conteo_items (
  id uuid primary key default gen_random_uuid(),
  conteo_id uuid not null references public.conteos_inventario (id) on delete cascade,
  grupo_id uuid not null references public.grupos (id),
  empresa_id uuid not null references public.empresas (id),
  codigo text not null,
  descripcion text not null check (length(trim(descripcion)) between 1 and 300),
  cantidad numeric(14, 3) not null check (cantidad >= 0),
  unidad text not null default 'pza',
  ubicacion text,
  codigo_barras text,
  producto_id uuid references public.productos (id),
  notas text,
  contado_por uuid not null references public.profiles (id),
  contado_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grupo_id, codigo)
);
create index if not exists conteo_items_conteo_idx on public.conteo_items (conteo_id, empresa_id);
create index if not exists conteo_items_contado_por_idx on public.conteo_items (contado_por);

create or replace function public.conteos_inventario_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.grupo_id is null then new.grupo_id := public.auth_grupo_id(); end if;
  if new.grupo_id is null then raise exception 'La cuenta no tiene organización.'; end if;
  if tg_op = 'INSERT' and new.creado_por is null then new.creado_por := auth.uid(); end if;
  if new.estado = 'cerrado' and (tg_op = 'INSERT' or old.estado <> 'cerrado') then new.cerrado_en := now(); end if;
  if new.estado = 'abierto' then new.cerrado_en := null; end if;
  return new;
end $$;
create or replace trigger conteos_inventario_antes before insert or update on public.conteos_inventario
  for each row execute function public.conteos_inventario_antes();

create or replace function public.conteo_items_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_grupo uuid;
  v_estado text;
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
  new.descripcion := trim(new.descripcion);
  new.unidad := coalesce(nullif(trim(new.unidad), ''), 'pza');
  new.ubicacion := nullif(trim(coalesce(new.ubicacion, '')), '');
  new.codigo_barras := nullif(trim(coalesce(new.codigo_barras, '')), '');
  new.updated_at := now();
  return new;
end $$;
create or replace trigger conteo_items_antes before insert or update on public.conteo_items
  for each row execute function public.conteo_items_antes();

alter table public.conteos_inventario enable row level security;
alter table public.conteo_items enable row level security;
grant select, insert, update, delete on public.conteos_inventario to authenticated;
grant select, insert, update, delete on public.conteo_items to authenticated;

do $$
begin
  -- conteos_inventario
  if not exists (select 1 from pg_policies where tablename = 'conteos_inventario' and policyname = 'frontera_organizacion') then
    create policy frontera_organizacion on public.conteos_inventario as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'conteos_inventario' and policyname = 'espectador_sin_datos') then
    create policy espectador_sin_datos on public.conteos_inventario as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'conteos_inventario' and policyname = 'director_general') then
    create policy director_general on public.conteos_inventario for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'conteos_inventario' and policyname = 'conteos_select') then
    create policy conteos_select on public.conteos_inventario for select to authenticated
      using ((select public.auth_rol_definer()) <> 'pendiente');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'conteos_inventario' and policyname = 'conteos_write') then
    create policy conteos_write on public.conteos_inventario for all to authenticated
      using ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'almacen']::app_rol[]))
      with check ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'almacen']::app_rol[])
                  and (select public.auth_suscripcion_permite_escribir_definer()));
  end if;
  -- conteo_items
  if not exists (select 1 from pg_policies where tablename = 'conteo_items' and policyname = 'frontera_organizacion') then
    create policy frontera_organizacion on public.conteo_items as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'conteo_items' and policyname = 'espectador_sin_datos') then
    create policy espectador_sin_datos on public.conteo_items as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'conteo_items' and policyname = 'director_general') then
    create policy director_general on public.conteo_items for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'conteo_items' and policyname = 'conteo_items_select') then
    create policy conteo_items_select on public.conteo_items for select to authenticated
      using ((select public.auth_rol_definer()) <> 'pendiente');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'conteo_items' and policyname = 'conteo_items_insert') then
    create policy conteo_items_insert on public.conteo_items for insert to authenticated
      with check (contado_por = (select auth.uid())
                  and (select public.auth_rol_definer()) <> 'pendiente'
                  and (select public.auth_suscripcion_permite_escribir_definer()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'conteo_items' and policyname = 'conteo_items_update') then
    create policy conteo_items_update on public.conteo_items for update to authenticated
      using (contado_por = (select auth.uid())
             or (select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'almacen']::app_rol[]))
      with check ((contado_por = (select auth.uid())
                   or (select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'almacen']::app_rol[]))
                  and (select public.auth_suscripcion_permite_escribir_definer()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'conteo_items' and policyname = 'conteo_items_delete') then
    create policy conteo_items_delete on public.conteo_items for delete to authenticated
      using (contado_por = (select auth.uid())
             or (select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'almacen']::app_rol[]));
  end if;
end $$;

create or replace trigger solo_consulta before insert or update or delete on public.conteos_inventario
  for each statement execute function public.bloquear_solo_consulta();
create or replace trigger solo_consulta before insert or update or delete on public.conteo_items
  for each statement execute function public.bloquear_solo_consulta();

-- Cuántos ítems y cuánto contó cada persona en cada empresa (RLS de quien pregunta).
create or replace function public.fn_conteo_resumen(p_conteo_id uuid)
returns table(contado_por uuid, contado_por_nombre text, empresa_id uuid, empresa_codigo text, empresa_nombre text, items bigint, cantidad numeric, primero timestamptz, ultimo timestamptz)
language sql stable set search_path = public as $$
  select i.contado_por, max(i.contado_por_nombre), i.empresa_id, e.codigo, e.nombre,
         count(*), sum(i.cantidad), min(i.created_at), max(i.created_at)
    from public.conteo_items i
    join public.empresas e on e.id = i.empresa_id
   where i.conteo_id = p_conteo_id
   group by i.contado_por, i.empresa_id, e.codigo, e.nombre
   order by max(i.contado_por_nombre), e.nombre
$$;
grant execute on function public.fn_conteo_resumen(uuid) to authenticated;

-- Aviso push a toda la organización con la liga directa al conteo.
create or replace function public.fn_conteo_avisar(p_conteo_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_conteo public.conteos_inventario%rowtype;
  v_destinatarios uuid[];
  v_cuerpo text;
begin
  if public.auth_rol() not in ('admin', 'corporativo', 'direccion', 'almacen') then
    raise exception 'Solo admin, corporativo, dirección o almacén avisan del conteo.';
  end if;
  select * into v_conteo from public.conteos_inventario c where c.id = p_conteo_id
    and c.grupo_id = any (public.auth_grupos_alcance());
  if v_conteo.id is null then raise exception 'No existe ese conteo.'; end if;
  select coalesce(array_agg(p.id), '{}'::uuid[]) into v_destinatarios
    from public.profiles p
   where p.grupo_id = v_conteo.grupo_id and coalesce(p.activo, true)
     and p.rol <> 'pendiente' and not coalesce(p.espectador, false);
  v_cuerpo := format('Hoy %s todos contamos el inventario: entra, elige la empresa y captura cada ítem con su cantidad, unidad y ubicación; cada ítem recibe su etiqueta QR.%s',
                     to_char(v_conteo.fecha, 'DD/MM/YYYY'),
                     case when v_conteo.instrucciones is not null then ' ' || v_conteo.instrucciones else '' end);
  perform public.fn_push_aviso(v_destinatarios, v_conteo.nombre, v_cuerpo, '/inventario/conteo');
  return coalesce(array_length(v_destinatarios, 1), 0);
end $$;
revoke all on function public.fn_conteo_avisar(uuid) from public, anon;
grant execute on function public.fn_conteo_avisar(uuid) to authenticated;
