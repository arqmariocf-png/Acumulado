-- Reglas de clasificación automática (sección 4.3 del spec): palabra clave
-- detectada en Comentarios/Referencia -> etiqueta "N/A - ...". Editable por el
-- rol admin desde el panel, nunca hardcodeada en el motor de conciliación.
create table public.reglas_clasificacion (
  id uuid primary key default gen_random_uuid(),
  palabra_clave text not null unique,
  etiqueta text not null,
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

comment on column public.reglas_clasificacion.orden is
  'Prioridad de evaluación cuando varias palabras clave podrían matchear el mismo movimiento; menor = se evalúa primero.';

create trigger reglas_clasificacion_set_updated_at
  before update on public.reglas_clasificacion
  for each row
  execute function public.set_updated_at();

-- Excepciones de proveedor con crédito (sección 4.4 del spec): estos proveedores
-- NO cuentan como "falta factura" dentro de su ventana de tolerancia. Editable
-- por admin para poder agregar proveedores nuevos sin tocar código.
create table public.excepciones_proveedor (
  id uuid primary key default gen_random_uuid(),
  proveedor text not null unique,
  descripcion_regla text not null,
  dias_tolerancia integer,
  hasta_mes_siguiente boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create trigger excepciones_proveedor_set_updated_at
  before update on public.excepciones_proveedor
  for each row
  execute function public.set_updated_at();
