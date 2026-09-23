-- Pedidos de BBVA en Adquira (export "PEDIDOS RECIBIDOS" del portal de
-- proveedores): la otra mitad de la conciliación del módulo Mantenimiento
-- BBVA. El maestro de folios trae por folio el NUMERO DE PEDIDO; Adquira
-- trae por pedido lo facturado (ID. PEDIDO COMPRADOR). Se conservan todos
-- los pedidos del export (incluye otras regiones); la conciliación solo
-- cruza los que aparecen en el maestro de Puebla-Tlaxcala.
--
-- Hallazgo del primer cruce (export 2026-09-17 vs corte 2026-09-15): el
-- maestro BBVA va SIN IVA -- lo comparable es la base imponible de Adquira,
-- no el importe total.
create table public.bbva_adquira_pedidos (
  id_pedido text primary key,
  fecha date,
  fecha_publicacion date,
  importe_total numeric(14,2) not null default 0,   -- con IVA, como lo reporta Adquira
  base_imponible numeric(14,2) not null default 0,  -- suma de líneas sin IVA (comparable con el maestro BBVA)
  impuestos numeric(14,2) not null default 0,
  estado text,
  lineas integer not null default 0,
  solicitante text,
  contrato text,
  lineas_detalle jsonb,
  fecha_exportacion date,
  archivo_origen text,
  subido_por uuid references public.profiles (id),
  subido_en timestamptz not null default now()
);

alter table public.bbva_adquira_pedidos enable row level security;

-- Mismos lectores que los cortes del maestro (incluye el permiso acotado
-- profiles.bbva_mantenimiento); escriben corporativo (Belén) y admin.
create policy bbva_adquira_pedidos_select on public.bbva_adquira_pedidos
  for select using (public.auth_rol() in ('corporativo', 'direccion', 'admin') or public.auth_bbva_mantenimiento());
create policy bbva_adquira_pedidos_insert on public.bbva_adquira_pedidos
  for insert with check (public.auth_rol() in ('corporativo', 'admin'));
create policy bbva_adquira_pedidos_update on public.bbva_adquira_pedidos
  for update using (public.auth_rol() in ('corporativo', 'admin')) with check (public.auth_rol() in ('corporativo', 'admin'));
