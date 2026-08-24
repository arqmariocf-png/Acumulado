-- Módulo de Producción y Costeo, órdenes de producción -- el módulo
-- central: cada fila es un LOTE (ej. "Lote 0142 -- Clavo cal. 12, 500 kg")
-- y de ahí sale su costo real. Va antes que
-- 20260824090004_produccion_inventario.sql porque los movimientos de
-- inventario de ese archivo referencian orden_produccion_id.
create table public.ordenes_produccion (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique,
  producto_id uuid not null references public.productos (id),
  fecha_inicio date not null,
  fecha_fin date,
  cantidad_planeada numeric(14, 4) not null check (cantidad_planeada > 0),
  cantidad_producida numeric(14, 4) not null default 0 check (cantidad_producida >= 0),
  cantidad_merma numeric(14, 4) not null default 0 check (cantidad_merma >= 0),
  estado text not null default 'planeada' check (estado in ('planeada', 'en_proceso', 'terminada', 'cancelada')),
  notas text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ordenes_produccion is 'Un renglón por lote de producción. El costo real del lote (v_costeo_orden_produccion) se calcula sumando el consumo de materia prima ligado a esta orden (movimientos_materia_prima.orden_produccion_id), la mano de obra (mano_de_obra_produccion) y los indirectos (costos_indirectos_produccion) -- no de la receta estándar, que solo sirve para comparar.';

create index ordenes_produccion_producto_idx on public.ordenes_produccion (producto_id);
create index ordenes_produccion_estado_idx on public.ordenes_produccion (estado);

create trigger ordenes_produccion_set_updated_at
  before update on public.ordenes_produccion
  for each row
  execute function public.set_updated_at();

-- Mano de obra de un lote. personal_id es opcional y reutiliza
-- public.personal del módulo de RH (20260821090003_rh_personal.sql) en
-- vez de duplicar un catálogo de trabajadores -- si el operador no está
-- dado de alta en RH, se puede capturar solo con `descripcion`.
create table public.mano_de_obra_produccion (
  id uuid primary key default gen_random_uuid(),
  orden_produccion_id uuid not null references public.ordenes_produccion (id) on delete cascade,
  personal_id uuid references public.personal (id),
  descripcion text,
  horas numeric(8, 2) not null check (horas > 0),
  costo_hora numeric(12, 2) not null check (costo_hora >= 0),
  costo_total numeric(14, 2) generated always as (horas * costo_hora) stored,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint mano_de_obra_produccion_identifica check (personal_id is not null or descripcion is not null)
);

create index mano_de_obra_produccion_orden_idx on public.mano_de_obra_produccion (orden_produccion_id);

-- Costos indirectos de un lote (energía, mantenimiento, prorrateo de
-- renta, etc.) -- capturados a mano, concepto libre.
create table public.costos_indirectos_produccion (
  id uuid primary key default gen_random_uuid(),
  orden_produccion_id uuid not null references public.ordenes_produccion (id) on delete cascade,
  concepto text not null,
  monto numeric(14, 2) not null check (monto >= 0),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index costos_indirectos_produccion_orden_idx on public.costos_indirectos_produccion (orden_produccion_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.ordenes_produccion enable row level security;
alter table public.mano_de_obra_produccion enable row level security;
alter table public.costos_indirectos_produccion enable row level security;

create policy ordenes_produccion_select on public.ordenes_produccion
  for select
  using (public.auth_rol() in ('produccion', 'admin', 'corporativo'));

create policy ordenes_produccion_write on public.ordenes_produccion
  for all
  using (public.auth_rol() in ('produccion', 'admin'))
  with check (public.auth_rol() in ('produccion', 'admin'));

create policy mano_de_obra_produccion_select on public.mano_de_obra_produccion
  for select
  using (public.auth_rol() in ('produccion', 'admin', 'corporativo'));

create policy mano_de_obra_produccion_write on public.mano_de_obra_produccion
  for all
  using (public.auth_rol() in ('produccion', 'admin'))
  with check (public.auth_rol() in ('produccion', 'admin'));

create policy costos_indirectos_produccion_select on public.costos_indirectos_produccion
  for select
  using (public.auth_rol() in ('produccion', 'admin', 'corporativo'));

create policy costos_indirectos_produccion_write on public.costos_indirectos_produccion
  for all
  using (public.auth_rol() in ('produccion', 'admin'))
  with check (public.auth_rol() in ('produccion', 'admin'));
