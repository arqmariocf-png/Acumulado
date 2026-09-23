-- Módulo de Producción y Costeo, catálogos base. La planta (Mallas y
-- Clavos Clavicón) produce dos líneas: malla armex y clavos en dos
-- calibres. En vez de hardcodear esas variantes en código, `productos` es
-- un catálogo abierto (tipo + calibre + presentación) que el admin/planta
-- edita según lo que realmente se fabrique.

create table public.materias_primas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  unidad_medida text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.materias_primas is 'Insumos de planta (alambrón por calibre, zinc, empaque, etc). Sin costo fijo guardado -- el costo se deriva del historial de compras en movimientos_materia_prima (mismo criterio que product_stock en el proyecto hermano aasanwellness: nunca un contador aparte).';

create trigger materias_primas_set_updated_at
  before update on public.materias_primas
  for each row
  execute function public.set_updated_at();

create table public.productos_produccion (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('malla_armex', 'clavo')),
  nombre text not null,
  calibre text,
  presentacion text,
  unidad_medida text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.productos_produccion is 'Catálogo de producto terminado de la planta. calibre/presentacion son texto libre a propósito -- cubre malla armex y clavos de cualquier calibre sin modificar el esquema cuando la planta agregue una variante nueva.';

create trigger productos_produccion_set_updated_at
  before update on public.productos_produccion
  for each row
  execute function public.set_updated_at();

-- Receta/BOM estándar: cuánta materia prima lleva 1 unidad de producto.
-- Es el costo PLANEADO -- el costo REAL de cada lote se calcula del
-- consumo efectivo (ver 20260824090004_produccion_ordenes.sql), no de
-- aquí. Se edita la receta vigente; no se versiona histórico (fuera de
-- alcance del primer corte, ver plan).
create table public.receta_items (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos_produccion (id) on delete cascade,
  materia_prima_id uuid not null references public.materias_primas (id),
  cantidad_por_unidad numeric(14, 4) not null check (cantidad_por_unidad > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (producto_id, materia_prima_id)
);

create trigger receta_items_set_updated_at
  before update on public.receta_items
  for each row
  execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Lectura: produccion/admin/corporativo (corporativo ve el costeo
-- consolidado igual que ve el resto de reportes financieros). Escritura:
-- produccion/admin. Mismo patrón de aislamiento que el módulo de RH.
alter table public.materias_primas enable row level security;
alter table public.productos_produccion enable row level security;
alter table public.receta_items enable row level security;

create policy materias_primas_select on public.materias_primas
  for select
  using (public.auth_rol() in ('produccion', 'admin', 'corporativo'));

create policy materias_primas_write on public.materias_primas
  for all
  using (public.auth_rol() in ('produccion', 'admin'))
  with check (public.auth_rol() in ('produccion', 'admin'));

create policy productos_produccion_select on public.productos_produccion
  for select
  using (public.auth_rol() in ('produccion', 'admin', 'corporativo'));

create policy productos_produccion_write on public.productos_produccion
  for all
  using (public.auth_rol() in ('produccion', 'admin'))
  with check (public.auth_rol() in ('produccion', 'admin'));

create policy receta_items_select on public.receta_items
  for select
  using (public.auth_rol() in ('produccion', 'admin', 'corporativo'));

create policy receta_items_write on public.receta_items
  for all
  using (public.auth_rol() in ('produccion', 'admin'))
  with check (public.auth_rol() in ('produccion', 'admin'));
