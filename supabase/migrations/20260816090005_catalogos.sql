-- Cuentas bancarias de cada empresa (~22 en total según el spec).
create table public.cuentas_bancarias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  banco text not null check (banco in ('BBVA', 'Banorte', 'Santander', 'BanBajio')),
  ultimos_4 text not null check (ultimos_4 ~ '^[0-9]{4}$'),
  alias text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, banco, ultimos_4)
);

-- Catálogo de OC/OS. fuente indica si vino de la API del backoffice o de carga
-- manual de Excel (fallback mientras se corrige la autenticación de la API).
create table public.ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  id_orden text not null,
  tipo text not null check (tipo in ('OC', 'OS')),
  empresa_id uuid not null references public.empresas (id),
  proyecto text,
  proveedor text,
  total numeric(14, 2),
  fecha_creacion date,
  -- periodo AAAAMM derivado de fecha_creacion, usado para la regla de "OC de mes
  -- anterior pagada este mes" (sección 4.5 del spec).
  periodo text generated always as (public.periodo_aaaamm(fecha_creacion)) stored,
  fuente text not null check (fuente in ('api', 'excel')),
  archivo_id uuid references public.archivos_cargados (id),
  created_at timestamptz not null default now(),
  unique (id_orden, tipo)
);

create index ordenes_compra_periodo_idx on public.ordenes_compra (periodo);
create index ordenes_compra_empresa_idx on public.ordenes_compra (empresa_id);

-- Catálogo de OV.
create table public.ordenes_venta (
  id uuid primary key default gen_random_uuid(),
  id_ov text not null unique,
  empresa_id uuid not null references public.empresas (id),
  proyecto text,
  cliente text,
  total numeric(14, 2),
  fecha_ov date,
  periodo text generated always as (public.periodo_aaaamm(fecha_ov)) stored,
  fuente text not null check (fuente in ('api', 'excel')),
  archivo_id uuid references public.archivos_cargados (id),
  created_at timestamptz not null default now()
);

create index ordenes_venta_periodo_idx on public.ordenes_venta (periodo);
create index ordenes_venta_empresa_idx on public.ordenes_venta (empresa_id);

-- CFDI recibidos (compras) y emitidos (ventas), en una sola tabla con `tipo`
-- para no duplicar esquema/políticas — el spec los trata simétricamente
-- (mismo formato de archivo, misma lógica de matching por monto+periodo).
create table public.cfdi (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('recibido', 'emitido')),
  empresa_id uuid not null references public.empresas (id),
  rfc text not null,
  folio text not null,
  total numeric(14, 2) not null,
  periodo text not null check (periodo ~ '^[0-9]{6}$'),
  contraparte text,
  fecha date,
  archivo_id uuid references public.archivos_cargados (id),
  created_at timestamptz not null default now(),
  unique (tipo, rfc, folio, periodo)
);

create index cfdi_matching_idx on public.cfdi (empresa_id, tipo, periodo, total);
