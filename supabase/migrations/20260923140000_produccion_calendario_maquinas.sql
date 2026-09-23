-- Calendarización de tiempos y equipos (pedido de Mario, 23-sep-2026):
-- la malla en Clavicón pasa por varios pasos en distintas máquinas. Se
-- modela:
--   equipos_produccion      máquinas / estaciones de trabajo por empresa.
--   rutas_producto          pasos estándar de cada producto (orden, máquina
--                           por omisión, minutos de preparación y por unidad).
--   operaciones_programadas la programación real de cada lote: un renglón
--                           por paso con máquina, inicio/fin programados y
--                           (después, con cámaras) inicio/fin reales.
-- Con esto se ve la carga por máquina y más adelante se comparan tiempos
-- programados contra reales para eficientar estaciones.
create table public.equipos_produccion (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  nombre text not null,
  proceso text,
  capacidad_nota text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create table public.rutas_producto (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos_produccion (id) on delete cascade,
  orden integer not null,
  nombre_paso text not null,
  equipo_id uuid references public.equipos_produccion (id),
  minutos_preparacion numeric(8, 2) not null default 0 check (minutos_preparacion >= 0),
  minutos_por_unidad numeric(10, 4) not null default 0 check (minutos_por_unidad >= 0),
  notas text,
  unique (producto_id, orden)
);

create table public.operaciones_programadas (
  id uuid primary key default gen_random_uuid(),
  orden_produccion_id uuid not null references public.ordenes_produccion (id) on delete cascade,
  paso integer not null,
  nombre_paso text not null,
  equipo_id uuid references public.equipos_produccion (id),
  personal_id uuid references public.personal (id),
  inicio_programado timestamptz not null,
  fin_programado timestamptz not null check (fin_programado > inicio_programado),
  inicio_real timestamptz,
  fin_real timestamptz,
  -- 'manual' hoy; 'camara' cuando se vincule la lectura automática.
  fuente_real text not null default 'manual' check (fuente_real in ('manual', 'camara')),
  estado text not null default 'programada' check (estado in ('programada', 'en_proceso', 'terminada', 'cancelada')),
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (orden_produccion_id, paso)
);

create index operaciones_programadas_equipo_idx on public.operaciones_programadas (equipo_id, inicio_programado);
create index operaciones_programadas_orden_idx on public.operaciones_programadas (orden_produccion_id, paso);

create trigger operaciones_programadas_set_updated_at before update on public.operaciones_programadas for each row execute function public.set_updated_at();

alter table public.equipos_produccion enable row level security;
alter table public.rutas_producto enable row level security;
alter table public.operaciones_programadas enable row level security;

create policy equipos_produccion_select on public.equipos_produccion
  for select using (public.auth_rol() in ('produccion', 'admin', 'corporativo', 'direccion') and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy equipos_produccion_write on public.equipos_produccion
  for all using (public.auth_rol() in ('produccion', 'admin') and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()))
  with check (public.auth_rol() in ('produccion', 'admin') and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));

create policy rutas_producto_select on public.rutas_producto
  for select using (public.auth_rol() in ('produccion', 'admin', 'corporativo', 'direccion'));
create policy rutas_producto_write on public.rutas_producto
  for all using (public.auth_rol() in ('produccion', 'admin')) with check (public.auth_rol() in ('produccion', 'admin'));

create policy operaciones_programadas_select on public.operaciones_programadas
  for select using (public.auth_rol() in ('produccion', 'admin', 'corporativo', 'direccion'));
create policy operaciones_programadas_write on public.operaciones_programadas
  for all using (public.auth_rol() in ('produccion', 'admin')) with check (public.auth_rol() in ('produccion', 'admin'));

-- Vista para el calendario: operaciones con lote, producto y máquina.
create view public.v_operaciones_programadas with (security_invoker = true) as
select o.*, op.folio as lote_folio, op.empresa_id, op.estado as lote_estado, pp.nombre as producto_nombre,
  e.nombre as equipo_nombre, pe.nombre as personal_nombre,
  round(extract(epoch from (o.fin_programado - o.inicio_programado)) / 60) as minutos_programados,
  case when o.inicio_real is not null and o.fin_real is not null then round(extract(epoch from (o.fin_real - o.inicio_real)) / 60) end as minutos_reales
from public.operaciones_programadas o
join public.ordenes_produccion op on op.id = o.orden_produccion_id
join public.productos_produccion pp on pp.id = op.producto_id
left join public.equipos_produccion e on e.id = o.equipo_id
left join public.personal pe on pe.id = o.personal_id;
grant select on public.v_operaciones_programadas to authenticated;
