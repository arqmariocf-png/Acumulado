-- Módulo de Producción y Costeo, bitácoras de inventario. Mismo criterio
-- que inventory_movements en el proyecto hermano aasanwellness: el stock
-- SIEMPRE se calcula de aquí (ver vistas v_stock_* en
-- 20260824090006_produccion_vistas.sql), nunca se guarda como contador
-- aparte.
--
-- El consumo real de materia prima de un lote de producción NO es una
-- tabla propia: es una salida de movimientos_materia_prima con
-- orden_produccion_id apuntando a ese lote -- un solo registro de verdad
-- para "cuánto material entró/salió", sin duplicar el dato entre
-- inventario y costeo.

create table public.movimientos_materia_prima (
  id uuid primary key default gen_random_uuid(),
  materia_prima_id uuid not null references public.materias_primas (id),
  tipo text not null check (tipo in ('entrada', 'salida')),
  cantidad numeric(14, 4) not null check (cantidad > 0),
  costo_unitario numeric(14, 4) not null check (costo_unitario >= 0),
  fecha date not null default current_date,

  -- Entrada: de dónde vino (compra real, ligada al mismo catálogo que
  -- concilia el motor de bancos -- ver 20260824090005_produccion_integra_oc_ov.sql).
  orden_compra_id uuid references public.ordenes_compra (id),
  -- Salida: a qué lote se consumió. NULL = ajuste/merma sin lote (ej.
  -- material dañado en almacén).
  orden_produccion_id uuid references public.ordenes_produccion (id),

  motivo text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),

  constraint movimientos_materia_prima_entrada_salida_check check (
    (tipo = 'entrada' and orden_produccion_id is null)
    or (tipo = 'salida' and orden_compra_id is null)
  )
);

create index movimientos_materia_prima_materia_idx on public.movimientos_materia_prima (materia_prima_id, fecha);
create index movimientos_materia_prima_orden_idx on public.movimientos_materia_prima (orden_produccion_id);

create table public.movimientos_producto_terminado (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos_produccion (id),
  tipo text not null check (tipo in ('entrada', 'salida')),
  cantidad numeric(14, 4) not null check (cantidad > 0),
  -- Entrada: costo_unitario_lote calculado en v_costeo_orden_produccion --
  -- así el inventario de producto terminado queda valuado al costo REAL
  -- de cada lote, no a un costo estándar fijo. Salida: costo al que sale
  -- (mismo con el que entró, para no inventar una valuación nueva).
  costo_unitario numeric(14, 4) not null check (costo_unitario >= 0),
  fecha date not null default current_date,

  -- Entrada: de qué lote salió el producto terminado.
  orden_produccion_id uuid references public.ordenes_produccion (id),
  -- Salida: a qué venta real corresponde (mismo catálogo que concilia el
  -- motor de bancos -- ver 20260824090005_produccion_integra_oc_ov.sql).
  orden_venta_id uuid references public.ordenes_venta (id),

  motivo text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),

  constraint movimientos_producto_terminado_entrada_salida_check check (
    (tipo = 'entrada' and orden_venta_id is null)
    or (tipo = 'salida' and orden_produccion_id is null)
  )
);

create index movimientos_producto_terminado_producto_idx on public.movimientos_producto_terminado (producto_id, fecha);
create index movimientos_producto_terminado_orden_idx on public.movimientos_producto_terminado (orden_produccion_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.movimientos_materia_prima enable row level security;
alter table public.movimientos_producto_terminado enable row level security;

create policy movimientos_materia_prima_select on public.movimientos_materia_prima
  for select
  using (public.auth_rol() in ('produccion', 'admin', 'corporativo'));

create policy movimientos_materia_prima_write on public.movimientos_materia_prima
  for all
  using (public.auth_rol() in ('produccion', 'admin'))
  with check (public.auth_rol() in ('produccion', 'admin'));

create policy movimientos_producto_terminado_select on public.movimientos_producto_terminado
  for select
  using (public.auth_rol() in ('produccion', 'admin', 'corporativo'));

create policy movimientos_producto_terminado_write on public.movimientos_producto_terminado
  for all
  using (public.auth_rol() in ('produccion', 'admin'))
  with check (public.auth_rol() in ('produccion', 'admin'));
