-- Auditoría de cada archivo cargado (estado de cuenta, CFDI, Excel de OC/OV):
-- quién lo subió, a qué empresa pertenece, y el resultado del procesamiento.
-- Se crea antes de los catálogos/movimientos para que puedan referenciarla.
create table public.archivos_cargados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id),
  tipo text not null check (
    tipo in ('estado_cuenta', 'cfdi_recibidos', 'cfdi_emitidos', 'oc_excel', 'ov_excel')
  ),
  nombre_original text not null,
  storage_path text not null,
  cargado_por uuid not null references auth.users (id),
  estado text not null default 'procesando' check (estado in ('procesando', 'completado', 'error')),
  filas_procesadas integer not null default 0,
  filas_error integer not null default 0,
  detalle_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index archivos_cargados_empresa_idx on public.archivos_cargados (empresa_id);
