-- Panel de control de folios BBVA (mantenimiento), armado a partir del
-- maestro de folios en Excel que ya lleva el equipo (folio -> ejecución ->
-- conciliación con supervisor -> pago). Cada actualización del maestro se
-- guarda como un "corte" nuevo (jsonb ya calculado) en vez de modelar cada
-- folio como fila: hoy el Excel no captura especialidad/cuadrilla/responsable
-- por folio, así que replicar esas columnas en tablas normalizadas sería
-- inventar estructura que el proceso real todavía no tiene.
create table public.bbva_mantenimiento_snapshots (
  id uuid primary key default gen_random_uuid(),
  fecha_corte date not null,
  region text not null default 'Puebla-Tlaxcala',
  datos jsonb not null,
  creado_por uuid references public.profiles(id),
  creado_en timestamptz not null default now(),
  unique (fecha_corte, region)
);

alter table public.bbva_mantenimiento_snapshots enable row level security;

-- Datos financieros de un cliente (montos por folio, supervisores) --
-- mismo nivel de acceso que Saldos: dirección/corporativo/admin.
create policy bbva_mantenimiento_select on public.bbva_mantenimiento_snapshots
  for select to authenticated
  using (auth_rol() in ('corporativo', 'direccion', 'admin'));

create policy bbva_mantenimiento_insert on public.bbva_mantenimiento_snapshots
  for insert to authenticated
  with check (auth_rol() in ('corporativo', 'admin'));
