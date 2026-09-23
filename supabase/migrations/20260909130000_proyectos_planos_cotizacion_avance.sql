-- Ventana de "Proyectos" pedida por el cliente 2026-09-09, sobre el
-- catálogo de proyectos que YA usan Requisiciones y Precios Unitarios (no
-- se duplica ese catálogo):
--   1. Planos (PDF y DWG) por proyecto.
--   2. Cotización: catálogo de precios por cliente, como apoyo a Precios
--      Unitarios (no reemplaza el motor de costeo por insumo que ya existe
--      -- es una lista de referencia de lo ya negociado con ese cliente).
--   3. Avance: se resuelve enlazando un tablero de Tareas al proyecto
--      (columna nueva tableros.proyecto_id), reusando el kanban que ya
--      existe en vez de construir algo nuevo.

alter table public.proyectos add column cliente text;

-- ── Planos por proyecto ──────────────────────────────────────────────────
create table public.proyecto_planos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos (id),
  nombre_original text not null,
  storage_path text not null,
  tipo_archivo text not null check (tipo_archivo in ('pdf', 'dwg')),
  subido_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index proyecto_planos_proyecto_idx on public.proyecto_planos (proyecto_id, created_at);

alter table public.proyecto_planos enable row level security;

-- Mismo criterio de visibilidad que proyectos_select (ver
-- 20260827193435_requisiciones_rls.sql): admin/corporativo ven todo,
-- empresa/dirección su empresa, y el responsable/comprador del proyecto
-- aunque no tengan acceso al resto de su empresa.
create policy proyecto_planos_select on public.proyecto_planos
  for select
  using (
    exists (
      select 1 from public.proyectos p
      where p.id = proyecto_planos.proyecto_id
        and (
          public.auth_ve_todas_empresas()
          or (public.auth_rol() in ('empresa', 'direccion') and p.empresa_id = public.auth_empresa_id())
          or p.responsable_id = (select auth.uid())
          or p.comprador_id = (select auth.uid())
        )
    )
  );

create policy proyecto_planos_insert on public.proyecto_planos
  for insert
  with check (
    subido_por = (select auth.uid())
    and exists (
      select 1 from public.proyectos p
      where p.id = proyecto_planos.proyecto_id
        and (
          public.auth_ve_todas_empresas()
          or (public.auth_rol() in ('empresa', 'direccion') and p.empresa_id = public.auth_empresa_id())
          or p.responsable_id = (select auth.uid())
          or p.comprador_id = (select auth.uid())
        )
    )
  );

-- Borrar un plano (por si se subió el archivo equivocado) queda más
-- restringido que subirlo -- evita que se pierda un plano por accidente.
create policy proyecto_planos_delete on public.proyecto_planos
  for delete
  using (public.auth_rol() in ('admin', 'corporativo') or subido_por = (select auth.uid()));

-- ── Catálogo de precios por cliente (apoyo a Precios Unitarios) ─────────
create table public.pu_precios_cliente (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  cliente text not null,
  concepto text not null,
  unidad text not null,
  precio_unitario numeric(14, 2) not null,
  vigente_desde date not null default current_date,
  activo boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

comment on table public.pu_precios_cliente is 'Catálogo de referencia de precios ya negociados por cliente -- apoyo para cotizar rápido, no sustituye el costeo por insumo de pu_analisis.';

create index pu_precios_cliente_empresa_cliente_idx on public.pu_precios_cliente (empresa_id, cliente);

alter table public.pu_precios_cliente enable row level security;

-- Mismo criterio que auth_puede_escribir_pu(): corporativo/empresa/admin/
-- dirección son quienes manejan precios en Precios Unitarios.
create policy pu_precios_cliente_select on public.pu_precios_cliente
  for select
  using (
    public.auth_puede_escribir_pu()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

-- Insert exige created_by = quien llama (no se puede insertar a nombre de
-- alguien más); update/delete no lo vuelven a exigir -- cualquiera con
-- permiso de escritura de PU en esa empresa puede mantener un precio que
-- capturó alguien más del equipo, es un catálogo compartido.
create policy pu_precios_cliente_insert on public.pu_precios_cliente
  for insert
  with check (
    public.auth_puede_escribir_pu()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
    and created_by = (select auth.uid())
  );

create policy pu_precios_cliente_update on public.pu_precios_cliente
  for update
  using (
    public.auth_puede_escribir_pu()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  )
  with check (
    public.auth_puede_escribir_pu()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy pu_precios_cliente_delete on public.pu_precios_cliente
  for delete
  using (
    public.auth_puede_escribir_pu()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

-- ── Avance: vincular un tablero de Tareas a un proyecto ─────────────────
alter table public.tableros add column proyecto_id uuid references public.proyectos (id);
create index tableros_proyecto_idx on public.tableros (proyecto_id) where proyecto_id is not null;
