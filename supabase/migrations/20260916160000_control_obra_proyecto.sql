-- Control de obra por especialidad dentro de un proyecto.
--
-- Nace del "Control de Proyectos — Carpintería" (Portamar): un trabajo
-- acotado dentro de una obra (la carpintería de Portamar) con su propio
-- contrato/presupuesto, sus compras de material y su nómina semanal, y el
-- cierre con utilidad y margen. Un proyecto puede tener varios controles
-- (uno por especialidad: carpintería, herrería, hidráulica...).
--
-- La nómina se lleva por dos lados y la pantalla muestra ambos:
--   * proyecto_control_nomina: lo que la dirección DECIDE pagar por semana
--     (ej. Portamar: 7 semanas completas de oficial + ayudante).
--   * nomina_api_control_obra(): lo que la API de mano de obra de Grupo
--     Loma tiene cargado al proyecto para esa subpartida (importes
--     prorrateados cuando la cuadrilla se reparte entre obras).

-- ============================================================
-- 1. Visibilidad de un proyecto (misma regla que proyectos_select)
-- ============================================================
create or replace function public.auth_ve_proyecto(p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.proyectos p
    where p.id = p_proyecto_id
      and public.auth_rol() <> 'pendiente'
      and (
        public.auth_ve_todas_empresas()
        or (public.auth_rol() in ('empresa', 'direccion') and p.empresa_id = public.auth_empresa_id())
        or p.responsable_id = auth.uid()
        or p.comprador_id = auth.uid()
      )
  )
$$;
revoke execute on function public.auth_ve_proyecto(uuid) from anon, public;
grant execute on function public.auth_ve_proyecto(uuid) to authenticated;

-- ============================================================
-- 2. Tablas
-- ============================================================
create table public.proyecto_controles (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  especialidad text not null,
  presupuesto numeric(14,2) not null check (presupuesto >= 0),
  fecha_inicio date,
  estatus text not null default 'en_curso' check (estatus in ('en_curso', 'cierre', 'cerrado')),
  semana_cierre text,
  -- Subpartida con la que viene la mano de obra en la API (ej. 'Carpintería').
  -- Null = toda la nómina del proyecto.
  subpartida_nomina text,
  notas text,
  creado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proyecto_id, especialidad)
);
create trigger proyecto_controles_updated_at before update on public.proyecto_controles
  for each row execute function public.set_updated_at();

create table public.proyecto_control_compras (
  id uuid primary key default gen_random_uuid(),
  control_id uuid not null references public.proyecto_controles(id) on delete cascade,
  -- Liga opcional a la OC real (API/Excel) para no capturar la compra dos veces.
  orden_compra_id uuid references public.ordenes_compra(id) on delete set null,
  fecha date not null,
  proveedor text not null,
  folio text,
  descripcion text,
  categoria text,
  estatus text not null default 'pagado' check (estatus in ('pagado', 'pendiente')),
  importe numeric(14,2) not null check (importe >= 0),
  created_at timestamptz not null default now()
);
create index proyecto_control_compras_control_idx on public.proyecto_control_compras(control_id);

create table public.proyecto_control_nomina (
  id uuid primary key default gen_random_uuid(),
  control_id uuid not null references public.proyecto_controles(id) on delete cascade,
  semana int not null check (semana > 0),
  fecha_inicio date not null,
  fecha_fin date not null,
  puesto text not null,
  sueldo numeric(14,2) not null check (sueldo >= 0),
  created_at timestamptz not null default now()
);
create index proyecto_control_nomina_control_idx on public.proyecto_control_nomina(control_id);

-- ============================================================
-- 3. RLS: ve quien ve el proyecto; escribe admin/corporativo
-- ============================================================
alter table public.proyecto_controles enable row level security;
alter table public.proyecto_control_compras enable row level security;
alter table public.proyecto_control_nomina enable row level security;

create policy proyecto_controles_select on public.proyecto_controles
  for select using (public.auth_ve_proyecto(proyecto_id));
create policy proyecto_controles_write on public.proyecto_controles
  for all using (public.auth_rol() in ('admin', 'corporativo'))
  with check (public.auth_rol() in ('admin', 'corporativo'));

create policy proyecto_control_compras_select on public.proyecto_control_compras
  for select using (exists (select 1 from public.proyecto_controles c where c.id = control_id and public.auth_ve_proyecto(c.proyecto_id)));
create policy proyecto_control_compras_write on public.proyecto_control_compras
  for all using (public.auth_rol() in ('admin', 'corporativo'))
  with check (public.auth_rol() in ('admin', 'corporativo'));

create policy proyecto_control_nomina_select on public.proyecto_control_nomina
  for select using (exists (select 1 from public.proyecto_controles c where c.id = control_id and public.auth_ve_proyecto(c.proyecto_id)));
create policy proyecto_control_nomina_write on public.proyecto_control_nomina
  for all using (public.auth_rol() in ('admin', 'corporativo'))
  with check (public.auth_rol() in ('admin', 'corporativo'));

-- ============================================================
-- 4. Nómina según la API de mano de obra, acotada al control
-- ============================================================
-- nomina_externa_renglones solo la leen admin/rh; esta función deja ver
-- únicamente los renglones del proyecto+subpartida del control, y solo a
-- quien puede ver ese proyecto.
create or replace function public.nomina_api_control_obra(p_control_id uuid)
returns table (semana int, fecha_inicio date, fecha_fin date, nombre text, monto numeric)
language sql stable security definer set search_path = public as $$
  select
    (r.datos->>'Num_sem')::int,
    (r.datos->>'Fecha_inicio')::date,
    (r.datos->>'Fecha_fin')::date,
    trim(r.datos->>'Nombre'),
    (r.datos->>'Monto')::numeric
  from public.proyecto_controles c
  join public.proyectos p on p.id = c.proyecto_id
  join public.nomina_externa_renglones r
    on r.origen = 'mano_obra'
   and trim(r.datos->>'Proyecto') ilike trim(p.nombre)
   and (c.subpartida_nomina is null or trim(r.datos->>'Subpartida') ilike trim(c.subpartida_nomina))
  where c.id = p_control_id
    and public.auth_ve_proyecto(c.proyecto_id)
  order by 1, 4
$$;
revoke execute on function public.nomina_api_control_obra(uuid) from anon, public;
grant execute on function public.nomina_api_control_obra(uuid) to authenticated;
