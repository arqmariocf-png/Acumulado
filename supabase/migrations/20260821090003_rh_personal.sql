-- Módulo de Recursos Humanos, primera capa: personal y su asignación diaria
-- a empresa/obra (mecánica "inter-empresa" confirmada con el usuario
-- 2026-08-21, ejemplo real: plomero con sueldo semanal $3,200, lun-mié en
-- una obra de LOMA y jue-sáb en una obra de Ergodinova).
--
-- Lo que NO incluye todavía esta migración, a propósito, porque falta
-- información real para no adivinar:
--   - expedientes/documentos requeridos y generación de contratos (el
--     usuario mencionó que compartiría el formato real y la checklist, aún
--     no llegan)
--   - el "listado de pagos" de los jueves para tesorería (el usuario mismo
--     dijo que eso se configura más adelante)
--   - qué pasa con el día de descanso cuando la semana no se trabajó
--     completa (ausencias) -- el usuario confirmó que el sueldo semanal se
--     divide entre 7 y que el 7° día (descanso) se reparte proporcional a
--     los días trabajados en cada empresa, pero eso se validó para una
--     semana COMPLETA (6 días trabajados). Qué pasa con una semana con
--     ausencias no está confirmado, así que la vista de abajo solo calcula
--     el monto de los días efectivamente asignados -- NO intenta repartir
--     el séptimo día, para no introducir una regla de pago no confirmada.

create table public.personal (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  puesto text,
  sueldo_semanal numeric(10, 2) not null check (sueldo_semanal > 0),
  fecha_ingreso date not null,
  activo boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.personal is 'Personal del grupo (RH). No está ligado a una sola empresa -- su costo se reparte día a día vía asignaciones_diarias.';
comment on column public.personal.fecha_ingreso is 'Fecha de contratación -- base para calcular antigüedad. Hoy se captura manual; cuando exista el módulo de contratos podría derivarse de ahí.';

create trigger personal_set_updated_at
  before update on public.personal
  for each row
  execute function public.set_updated_at();

-- Un renglón por persona+día: en qué empresa/obra trabajó ese día. Unique en
-- (personal_id, fecha) porque una persona no puede estar en dos empresas el
-- mismo día -- si el dashboard de "mover personal" reasigna un día, debe
-- hacer upsert sobre esta llave, no insertar un segundo renglón.
create table public.asignaciones_diarias (
  id uuid primary key default gen_random_uuid(),
  personal_id uuid not null references public.personal (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),
  proyecto text,
  fecha date not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (personal_id, fecha)
);

comment on table public.asignaciones_diarias is 'Un renglón por persona+día trabajado y la empresa/obra a la que se le asigna ese día -- la base del prorrateo inter-empresa.';
comment on column public.asignaciones_diarias.proyecto is 'La obra específica dentro de la empresa (texto libre, igual que movimientos.proyecto) -- opcional.';

create index asignaciones_diarias_personal_fecha_idx on public.asignaciones_diarias (personal_id, fecha);
create index asignaciones_diarias_empresa_fecha_idx on public.asignaciones_diarias (empresa_id, fecha);

create trigger asignaciones_diarias_set_updated_at
  before update on public.asignaciones_diarias
  for each row
  execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Acotado a 'rh' y 'admin' -- ningún otro rol (ni siquiera corporativo) ve
-- estas tablas por ahora. Si más adelante dirección/corporativo necesitan
-- visibilidad de nómina, se agrega explícitamente; no es lo que se pidió.
alter table public.personal enable row level security;
alter table public.asignaciones_diarias enable row level security;

create policy personal_all on public.personal
  for all
  using (public.auth_rol() in ('rh', 'admin'))
  with check (public.auth_rol() in ('rh', 'admin'));

create policy asignaciones_diarias_all on public.asignaciones_diarias
  for all
  using (public.auth_rol() in ('rh', 'admin'))
  with check (public.auth_rol() in ('rh', 'admin'));

-- ── Reporte: monto por persona/empresa/semana ───────────────────────────
-- Semana ISO (lunes a domingo). Calcula únicamente el monto de los días
-- EFECTIVAMENTE asignados (sueldo_semanal / 7 * días asignados en esa
-- empresa) -- deliberadamente NO reparte el 7º día/descanso todavía (ver
-- nota al inicio del archivo).
create view public.v_prorrateo_semanal_personal with (security_invoker = true) as
select
  a.personal_id,
  p.nombre as personal_nombre,
  a.empresa_id,
  date_trunc('week', a.fecha)::date as semana_inicio,
  count(*) as dias_asignados,
  round(p.sueldo_semanal / 7 * count(*), 2) as monto_dias_asignados
from public.asignaciones_diarias a
join public.personal p on p.id = a.personal_id
group by a.personal_id, p.nombre, a.empresa_id, date_trunc('week', a.fecha)::date;
