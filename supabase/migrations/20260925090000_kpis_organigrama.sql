-- KPIs del organigrama de dirección general (Mario, 25-sep-2026): debajo del
-- nombre de cada área van puntos de color (verde/ámbar/rojo) por indicador.
-- Qué indicadores lleva cada área y sus umbrales lo configura el admin.
-- `indicador` es la clave del catálogo web/src/lib/indicadores.ts.

create table public.kpis_organigrama (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  indicador text not null,
  etiqueta text,
  orden int not null default 0,
  umbral_ambar numeric not null default 1,
  umbral_rojo numeric not null default 5,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (area, indicador)
);
alter table public.kpis_organigrama enable row level security;
create policy kpis_organigrama_select on public.kpis_organigrama for select to authenticated using (public.auth_rol() = 'admin');
create policy kpis_organigrama_write on public.kpis_organigrama for all to authenticated
  using (public.auth_rol() = 'admin') with check (public.auth_rol() = 'admin');

insert into public.kpis_organigrama (area, indicador, orden, umbral_ambar, umbral_rojo) values
  ('finanzas', 'movimientos_revisar', 1, 1, 20),
  ('contabilidad', 'carga_sin_estado', 1, 1, 3),
  ('contabilidad', 'movimientos_revisar', 2, 1, 20),
  ('rh', 'rh_accesos', 1, 1, 5),
  ('rh', 'rh_contratos', 2, 1, 3),
  ('rh', 'rh_expedientes', 3, 1, 10),
  ('almacen', 'inventario_oc', 1, 1, 5),
  ('logistica', 'inventario_remisiones', 1, 1, 5),
  ('logistica', 'produccion_remisiones', 2, 1, 5),
  ('mantenimiento', 'bbva_folios', 1, 1, 10),
  ('operacion', 'produccion_ordenes', 1, 5, 15),
  ('operacion', 'precios_pendientes', 2, 1, 5),
  ('sistemas', 'cuentas_pendientes', 1, 1, 3);
