-- Repara el historial: el módulo de Precios Unitarios vive en producción pero
-- NINGUNA migración lo creaba. Faltaban 2 tipos, 6 tablas con sus llaves,
-- índices y policies, y 4 funciones de permisos. Las migraciones posteriores
-- que sí están en el repositorio (20260917090000_pu_insumos_rol_empresa.sql,
-- 20260909130000_proyectos_planos_cotizacion_avance.sql) daban por hecho todo
-- esto y por eso el repositorio no podía reconstruir la base desde cero.
--
-- Todo lo de abajo está leído del proyecto zdqahpzijkkcnfehbggs con
-- pg_get_functiondef / pg_get_constraintdef / pg_indexes / pg_policies: es lo
-- que está vivo hoy, no una reconstrucción de memoria. Va fechada antes de
-- quien lo usa, y en el proyecto real es un no-op (todo va con IF NOT EXISTS
-- o CREATE OR REPLACE).
--
-- Por qué importa: sin esto no hay forma de levantar una copia de la base para
-- probar, ni de recuperarla el día que haga falta. Es también lo que impedía
-- correr ./scripts/validar-sql.sh contra main.

do $$ begin
  create type public.pu_base_calculo as enum ('cantidad', 'pct_mano_obra');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pu_tipo_insumo as enum ('material', 'mano_obra', 'herramienta', 'equipo', 'auxiliar');
exception when duplicate_object then null; end $$;

create table if not exists public.pu_insumos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  descripcion text not null,
  unidad text not null,
  tipo public.pu_tipo_insumo not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pu_factores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nombre text not null,
  indirectos_pct numeric(7,4) not null default 0 check (indirectos_pct >= 0),
  financiamiento_pct numeric(7,4) not null default 0 check (financiamiento_pct >= 0),
  utilidad_pct numeric(7,4) not null default 0 check (utilidad_pct >= 0),
  cargos_adicionales_pct numeric(7,4) not null default 0 check (cargos_adicionales_pct >= 0),
  vigente_desde date not null default current_date,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre, vigente_desde)
);

create table if not exists public.pu_analisis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  proyecto_id uuid references public.proyectos (id) on delete set null,
  codigo text not null,
  concepto text not null,
  unidad text not null,
  es_auxiliar boolean not null default false,
  factor_id uuid references public.pu_factores (id) on delete set null,
  estado text not null default 'borrador' check (
    estado in ('borrador', 'en_revision_material', 'material_confirmado', 'autorizado', 'publicado', 'obsoleto')
  ),
  notas text,
  creado_por uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  comentario_revision text,
  unique (empresa_id, codigo)
);

create table if not exists public.pu_analisis_items (
  id uuid primary key default gen_random_uuid(),
  analisis_id uuid not null references public.pu_analisis (id) on delete cascade,
  insumo_id uuid references public.pu_insumos (id) on delete restrict,
  analisis_hijo_id uuid references public.pu_analisis (id) on delete restrict,
  cantidad numeric(16,6) not null check (cantidad >= 0),
  rendimiento numeric(16,6) not null default 1 check (rendimiento > 0),
  costo_congelado numeric(14,4) check (costo_congelado >= 0),
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  base_calculo public.pu_base_calculo not null default 'cantidad',
  proveedor text,
  precio_autorizado_por uuid references public.profiles (id) on delete set null,
  precio_autorizado_en timestamptz,
  constraint pu_analisis_items_una_fuente check (num_nonnulls(insumo_id, analisis_hijo_id) = 1),
  constraint pu_analisis_items_no_autoref check (analisis_hijo_id is null or analisis_hijo_id <> analisis_id),
  constraint pu_analisis_items_pct_solo_insumo check (base_calculo = 'cantidad' or insumo_id is not null)
);

create table if not exists public.pu_insumo_precios (
  id uuid primary key default gen_random_uuid(),
  insumo_id uuid not null references public.pu_insumos (id) on delete cascade,
  empresa_id uuid references public.empresas (id) on delete cascade,
  costo numeric(14,4) not null check (costo >= 0),
  fecha_vigencia date not null default current_date,
  fuente text,
  orden_compra_id uuid references public.ordenes_compra (id) on delete set null,
  creado_por uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.pu_aprobaciones (
  id uuid primary key default gen_random_uuid(),
  analisis_id uuid not null references public.pu_analisis (id) on delete cascade,
  estado_anterior text not null,
  estado_nuevo text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_rol public.app_rol,
  comentario text,
  created_at timestamptz not null default now(),
  actor_nombre text
);

create index if not exists pu_insumos_tipo_idx on public.pu_insumos (tipo) where activo;
create index if not exists pu_analisis_empresa_idx on public.pu_analisis (empresa_id, estado);
create index if not exists pu_analisis_proyecto_idx on public.pu_analisis (proyecto_id) where proyecto_id is not null;
create index if not exists pu_analisis_items_analisis_idx on public.pu_analisis_items (analisis_id, orden);
create index if not exists pu_analisis_items_hijo_idx on public.pu_analisis_items (analisis_hijo_id) where analisis_hijo_id is not null;
create index if not exists pu_insumo_precios_lookup_idx on public.pu_insumo_precios (insumo_id, fecha_vigencia desc, created_at desc);
create index if not exists pu_aprobaciones_analisis_idx on public.pu_aprobaciones (analisis_id, created_at desc);

-- ── Funciones de permisos del módulo ────────────────────────────────────
create or replace function public.auth_es_supervisor_pu(p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.proyectos p
    where p.id = p_proyecto_id and p.responsable_id = (select auth.uid())
  )
$$;

create or replace function public.auth_participa_pu(p_empresa_id uuid, p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    (
      public.auth_rol() = any (array['admin', 'corporativo', 'direccion', 'empresa', 'almacen']::public.app_rol[])
      and (public.auth_ve_todas_empresas() or p_empresa_id = public.auth_empresa_id())
    )
    or public.auth_es_supervisor_pu(p_proyecto_id)
$$;

create or replace function public.auth_edita_borrador_pu(p_analisis_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.pu_analisis a
    where a.id = p_analisis_id
      and (
        public.auth_rol() = 'admin'
        or (a.estado = 'borrador' and (
              public.auth_es_supervisor_pu(a.proyecto_id)
              or (public.auth_puede_escribir_pu()
                  and (public.auth_ve_todas_empresas() or a.empresa_id = public.auth_empresa_id()))
           ))
      )
  )
$$;

create or replace function public.auth_revisa_material_pu(p_analisis_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.pu_analisis a
    where a.id = p_analisis_id
      and a.estado = 'en_revision_material'
      and public.auth_rol() = 'almacen'
  )
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.pu_insumos enable row level security;
alter table public.pu_factores enable row level security;
alter table public.pu_analisis enable row level security;
alter table public.pu_analisis_items enable row level security;
alter table public.pu_insumo_precios enable row level security;
alter table public.pu_aprobaciones enable row level security;

create policy pu_insumos_select on public.pu_insumos for select
  using (public.auth_rol() <> 'pendiente');
create policy pu_insumos_write on public.pu_insumos for all
  using (public.auth_rol() = any (array['admin','corporativo','direccion']::public.app_rol[]))
  with check (public.auth_rol() = any (array['admin','corporativo','direccion']::public.app_rol[]));
-- pu_insumos_alta_empresa y pu_insumos_editar_empresa NO van aquí: las crea
-- 20260917090000_pu_insumos_rol_empresa.sql, que sí está en el repositorio.
-- Esta migración reconstruye solo lo que faltaba, no el estado final.
create policy pu_insumos_alta_supervisor on public.pu_insumos for insert
  with check (public.auth_rol() = 'responsable');

create policy pu_factores_select on public.pu_factores for select
  using (public.auth_rol() <> 'pendiente' and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy pu_factores_write on public.pu_factores for all
  using (public.auth_puede_escribir_pu() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()))
  with check (public.auth_puede_escribir_pu() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));

create policy pu_analisis_select on public.pu_analisis for select
  using (
    public.auth_rol() <> 'pendiente'
    and (
      public.auth_ve_todas_empresas()
      or empresa_id = public.auth_empresa_id()
      or exists (
        select 1 from public.proyectos p
        where p.id = pu_analisis.proyecto_id
          and ((select auth.uid()) = p.responsable_id or (select auth.uid()) = p.comprador_id)
      )
    )
  );
create policy pu_analisis_insert on public.pu_analisis for insert
  with check (
    (public.auth_puede_escribir_pu() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()))
    or (public.auth_rol() = 'responsable' and public.auth_es_supervisor_pu(proyecto_id))
  );
create policy pu_analisis_update on public.pu_analisis for update
  using (public.auth_participa_pu(empresa_id, proyecto_id))
  with check (public.auth_participa_pu(empresa_id, proyecto_id));
create policy pu_analisis_delete on public.pu_analisis for delete
  using (
    public.auth_rol() = any (array['admin','corporativo']::public.app_rol[])
    or (estado = 'borrador' and public.auth_es_supervisor_pu(proyecto_id))
  );

create policy pu_analisis_items_select on public.pu_analisis_items for select
  using (
    exists (
      select 1 from public.pu_analisis a
      where a.id = pu_analisis_items.analisis_id
        and public.auth_rol() <> 'pendiente'
        and (public.auth_ve_todas_empresas() or a.empresa_id = public.auth_empresa_id() or public.auth_es_supervisor_pu(a.proyecto_id))
    )
  );
create policy pu_analisis_items_insert on public.pu_analisis_items for insert
  with check (public.auth_edita_borrador_pu(analisis_id));
create policy pu_analisis_items_update on public.pu_analisis_items for update
  using (public.auth_edita_borrador_pu(analisis_id) or public.auth_revisa_material_pu(analisis_id))
  with check (public.auth_edita_borrador_pu(analisis_id) or public.auth_revisa_material_pu(analisis_id));
create policy pu_analisis_items_delete on public.pu_analisis_items for delete
  using (public.auth_edita_borrador_pu(analisis_id));

create policy pu_insumo_precios_select on public.pu_insumo_precios for select
  using (
    public.auth_rol() <> 'pendiente'
    and (empresa_id is null or public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );
create policy pu_insumo_precios_write on public.pu_insumo_precios for all
  using (
    public.auth_rol() = any (array['admin','corporativo','direccion']::public.app_rol[])
    and (empresa_id is null or public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  )
  with check (
    public.auth_rol() = any (array['admin','corporativo','direccion']::public.app_rol[])
    and (empresa_id is null or public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );
-- pu_insumo_precios_empresa_insert tampoco: misma migración de 20260917.

create policy pu_aprobaciones_select on public.pu_aprobaciones for select
  using (exists (select 1 from public.pu_analisis a where a.id = pu_aprobaciones.analisis_id));
