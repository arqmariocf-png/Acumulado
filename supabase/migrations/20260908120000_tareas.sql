-- Módulo "Tareas": tablero estilo Trello para seguimiento de personal y
-- ventas (columnas -> tarjetas -> comentarios/archivos/actividad). Alcance
-- decidido con el cliente 2026-09-08:
--   * Tableros por empresa; un tablero con empresa_id NULL es "corporativo"
--     y se ve desde cualquier empresa (misma convención que
--     auth_ve_todas_empresas() para perfiles sin empresa fija).
--   * Cualquier usuario con acceso al tablero puede crear/mover/comentar
--     tarjetas y subir archivos -- es una herramienta de colaboración, no
--     un dato financiero que haya que restringir por rol.
--   * Crear/renombrar/archivar TABLEROS (y administrar sus columnas) queda
--     reservado a admin/corporativo -- evita que la estructura del tablero
--     cambie por accidente mientras cualquiera opera sus tarjetas.
--   * Vínculo opcional de una tarjeta con una orden de venta existente,
--     para dar seguimiento a una venta concreta desde el tablero.
--   * El "chat interno" pedido es el hilo de comentarios por tarjeta
--     (tarjeta_comentarios) -- el frontend lo consulta por polling con
--     React Query, no hay Realtime en el proyecto todavía.

create function public.tablero_visible(p_empresa_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_rol() <> 'pendiente'
    and (p_empresa_id is null or public.auth_ve_todas_empresas() or p_empresa_id = public.auth_empresa_id())
$$;

create function public.auth_puede_administrar_tableros()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_rol() in ('admin', 'corporativo')
$$;

-- ── Tableros ─────────────────────────────────────────────────────────────
create table public.tableros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id), -- NULL = corporativo, visible a todas las empresas
  nombre text not null,
  descripcion text,
  archivado boolean not null default false,
  creado_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tableros_set_updated_at
  before update on public.tableros
  for each row
  execute function public.set_updated_at();

create index tableros_empresa_idx on public.tableros (empresa_id);

alter table public.tableros enable row level security;

create policy tableros_select on public.tableros
  for select
  using (public.tablero_visible(empresa_id));

create policy tableros_insert on public.tableros
  for insert
  with check (public.auth_puede_administrar_tableros() and creado_por = (select auth.uid()));

create policy tableros_update on public.tableros
  for update
  using (public.auth_puede_administrar_tableros())
  with check (public.auth_puede_administrar_tableros());

-- Sin policy de delete: un tablero se archiva (columna `archivado`), nunca
-- se borra -- conserva el historial de tarjetas/comentarios/archivos.

-- ── Columnas ─────────────────────────────────────────────────────────────
create table public.tablero_columnas (
  id uuid primary key default gen_random_uuid(),
  tablero_id uuid not null references public.tableros (id),
  nombre text not null,
  orden integer not null,
  created_at timestamptz not null default now()
);

create index tablero_columnas_tablero_idx on public.tablero_columnas (tablero_id, orden);

alter table public.tablero_columnas enable row level security;

create policy tablero_columnas_select on public.tablero_columnas
  for select
  using (
    exists (
      select 1 from public.tableros t
      where t.id = tablero_columnas.tablero_id and public.tablero_visible(t.empresa_id)
    )
  );

create policy tablero_columnas_write on public.tablero_columnas
  for all
  using (
    public.auth_puede_administrar_tableros()
    and exists (select 1 from public.tableros t where t.id = tablero_columnas.tablero_id)
  )
  with check (
    public.auth_puede_administrar_tableros()
    and exists (select 1 from public.tableros t where t.id = tablero_columnas.tablero_id)
  );

-- ── Tarjetas ─────────────────────────────────────────────────────────────
create table public.tarjetas (
  id uuid primary key default gen_random_uuid(),
  -- Denormalizado desde tablero_columnas.tablero_id: permite que las
  -- policies de comentarios/archivos/actividad (y consultas por tablero)
  -- no necesiten un doble join para llegar al tablero. La trigger de abajo
  -- valida que siempre coincida con la columna real.
  tablero_id uuid not null references public.tableros (id),
  columna_id uuid not null references public.tablero_columnas (id),
  titulo text not null,
  descripcion text,
  orden_venta_id uuid references public.ordenes_venta (id),
  asignado_a uuid references public.profiles (id),
  creado_por uuid not null references public.profiles (id),
  fecha_limite date,
  orden integer not null default 0, -- posición dentro de la columna, para el drag-and-drop
  archivada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tarjetas_set_updated_at
  before update on public.tarjetas
  for each row
  execute function public.set_updated_at();

create index tarjetas_columna_idx on public.tarjetas (columna_id, orden);
create index tarjetas_tablero_idx on public.tarjetas (tablero_id);
create index tarjetas_asignado_idx on public.tarjetas (asignado_a) where asignado_a is not null;

create or replace function public.validar_columna_de_tarjeta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.tablero_columnas c
    where c.id = new.columna_id and c.tablero_id = new.tablero_id
  ) then
    raise exception 'La columna no pertenece al tablero de la tarjeta';
  end if;
  return new;
end;
$$;

create trigger tarjetas_validar_columna
  before insert or update of tablero_id, columna_id on public.tarjetas
  for each row
  execute function public.validar_columna_de_tarjeta();

alter table public.tarjetas enable row level security;

create policy tarjetas_select on public.tarjetas
  for select
  using (
    exists (select 1 from public.tableros t where t.id = tarjetas.tablero_id and public.tablero_visible(t.empresa_id))
  );

create policy tarjetas_insert on public.tarjetas
  for insert
  with check (
    creado_por = (select auth.uid())
    and exists (select 1 from public.tableros t where t.id = tarjetas.tablero_id and public.tablero_visible(t.empresa_id))
  );

-- Cualquiera con acceso al tablero puede mover/editar/asignar/archivar la
-- tarjeta -- es trabajo en equipo, no un dato que solo su creador controle.
create policy tarjetas_update on public.tarjetas
  for update
  using (
    exists (select 1 from public.tableros t where t.id = tarjetas.tablero_id and public.tablero_visible(t.empresa_id))
  )
  with check (
    exists (select 1 from public.tableros t where t.id = tarjetas.tablero_id and public.tablero_visible(t.empresa_id))
  );

create policy tarjetas_delete on public.tarjetas
  for delete
  using (public.auth_puede_administrar_tableros());

-- ── Comentarios (el "chat interno" pedido, por tarjeta) ─────────────────
create table public.tarjeta_comentarios (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references public.tarjetas (id) on delete cascade,
  autor_id uuid not null references public.profiles (id),
  texto text not null,
  created_at timestamptz not null default now()
);

create index tarjeta_comentarios_tarjeta_idx on public.tarjeta_comentarios (tarjeta_id, created_at);

alter table public.tarjeta_comentarios enable row level security;

create policy tarjeta_comentarios_select on public.tarjeta_comentarios
  for select
  using (
    exists (
      select 1 from public.tarjetas tj
      join public.tableros t on t.id = tj.tablero_id
      where tj.id = tarjeta_comentarios.tarjeta_id and public.tablero_visible(t.empresa_id)
    )
  );

create policy tarjeta_comentarios_insert on public.tarjeta_comentarios
  for insert
  with check (
    autor_id = (select auth.uid())
    and exists (
      select 1 from public.tarjetas tj
      join public.tableros t on t.id = tj.tablero_id
      where tj.id = tarjeta_comentarios.tarjeta_id and public.tablero_visible(t.empresa_id)
    )
  );

create policy tarjeta_comentarios_delete on public.tarjeta_comentarios
  for delete
  using (autor_id = (select auth.uid()) or public.auth_rol() = 'admin');

-- ── Archivos adjuntos por tarjeta ────────────────────────────────────────
-- Igual que "cargas" para el resto del proyecto: el bucket es privado y sin
-- policies de Storage para authenticated, así que la subida real siempre
-- pasa por un edge function con la service_role key (ver
-- supabase/functions/tareas-archivos). Esta tabla solo registra los
-- metadatos; la policy de insert es defensa en profundidad, no la vía real
-- de escritura.
create table public.tarjeta_archivos (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references public.tarjetas (id) on delete cascade,
  storage_path text not null,
  nombre_original text not null,
  subido_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index tarjeta_archivos_tarjeta_idx on public.tarjeta_archivos (tarjeta_id, created_at);

alter table public.tarjeta_archivos enable row level security;

create policy tarjeta_archivos_select on public.tarjeta_archivos
  for select
  using (
    exists (
      select 1 from public.tarjetas tj
      join public.tableros t on t.id = tj.tablero_id
      where tj.id = tarjeta_archivos.tarjeta_id and public.tablero_visible(t.empresa_id)
    )
  );

create policy tarjeta_archivos_insert on public.tarjeta_archivos
  for insert
  with check (
    subido_por = (select auth.uid())
    and exists (
      select 1 from public.tarjetas tj
      join public.tableros t on t.id = tj.tablero_id
      where tj.id = tarjeta_archivos.tarjeta_id and public.tablero_visible(t.empresa_id)
    )
  );

create policy tarjeta_archivos_delete on public.tarjeta_archivos
  for delete
  using (subido_por = (select auth.uid()) or public.auth_rol() = 'admin');

-- ── Actividad (bitácora de la tarjeta: creada/movida/asignada/etc.) ─────
-- Inmutable a propósito -- es la línea de tiempo de la tarjeta, no se edita
-- ni se borra, solo se agrega.
create table public.tarjeta_actividad (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references public.tarjetas (id) on delete cascade,
  tipo text not null check (tipo in ('creada', 'movida', 'asignada', 'archivada', 'reabierta', 'editada')),
  detalle jsonb,
  actor_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index tarjeta_actividad_tarjeta_idx on public.tarjeta_actividad (tarjeta_id, created_at);

alter table public.tarjeta_actividad enable row level security;

create policy tarjeta_actividad_select on public.tarjeta_actividad
  for select
  using (
    exists (
      select 1 from public.tarjetas tj
      join public.tableros t on t.id = tj.tablero_id
      where tj.id = tarjeta_actividad.tarjeta_id and public.tablero_visible(t.empresa_id)
    )
  );

create policy tarjeta_actividad_insert on public.tarjeta_actividad
  for insert
  with check (
    actor_id = (select auth.uid())
    and exists (
      select 1 from public.tarjetas tj
      join public.tableros t on t.id = tj.tablero_id
      where tj.id = tarjeta_actividad.tarjeta_id and public.tablero_visible(t.empresa_id)
    )
  );
