-- Una contratación = un contrato por tiempo determinado real (con su propia
-- vigencia y sueldo). Una persona puede tener varias contrataciones en el
-- tiempo (renovaciones); antigüedad se calcula desde personal.fecha_ingreso,
-- NO desde fecha_inicio de la contratación vigente.
--
-- empresa_id es la empresa que firma como "EL PATRÓN" en el contrato -- el
-- empleador legal formal. Es DISTINTA de asignaciones_diarias.empresa_id
-- (dónde trabajó cada día): la mecánica inter-empresa significa que el
-- trabajador tiene un patrón legal fijo por contrato, pero puede prestar
-- servicios en obras de otras empresas del grupo día a día (de ahí la
-- cláusula inter-empresa que el usuario pidió agregar al machote real de
-- contrato -- pendiente redactar y confirmar antes de generar el primer
-- contrato real).
create table public.contrataciones (
  id uuid primary key default gen_random_uuid(),
  personal_id uuid not null references public.personal (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),

  puesto text not null,
  sueldo_semanal numeric(10, 2) not null check (sueldo_semanal > 0),

  fecha_inicio date not null,
  duracion_dias integer not null check (duracion_dias > 0),
  -- date + integer = date en Postgres; no hace falta aritmética de intervalos.
  fecha_fin date generated always as (fecha_inicio + duracion_dias) stored,

  estatus text not null default 'vigente'
    check (estatus in ('vigente', 'vencido', 'rescindido', 'renovado')),

  -- Ruta del contrato ya generado/impreso (PDF/DOCX en Storage), llenado por
  -- el edge function de generación una vez que exista -- NULL mientras no
  -- se ha generado el documento.
  contrato_storage_path text,
  contrato_generado_at timestamptz,

  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contrataciones is 'Un contrato por tiempo determinado real. empresa_id es el patrón legal que firma -- puede diferir de dónde trabaja el día a día (ver asignaciones_diarias).';

create index contrataciones_personal_idx on public.contrataciones (personal_id);
create index contrataciones_vigencia_idx on public.contrataciones (fecha_inicio, fecha_fin);

create trigger contrataciones_set_updated_at
  before update on public.contrataciones
  for each row
  execute function public.set_updated_at();

alter table public.contrataciones enable row level security;

create policy contrataciones_all on public.contrataciones
  for all
  using (public.auth_rol() in ('rh', 'admin'))
  with check (public.auth_rol() in ('rh', 'admin'));

-- ── Reporte: monto por persona/empresa/semana ───────────────────────────
-- Reemplaza la vista de 20260821090003 (que leía personal.sueldo_semanal,
-- columna que ya no existe) -- ahora toma el sueldo de la contratación
-- vigente el día de cada asignación. Semana ISO (lunes a domingo). Calcula
-- únicamente el monto de los días EFECTIVAMENTE asignados (sueldo_semanal /
-- 7 * días asignados en esa empresa) -- deliberadamente NO reparte el 7º
-- día/descanso todavía (ver nota en 20260821090003).
--
-- Asume que una persona no tiene dos contrataciones con vigencias
-- traslapadas -- no hay constraint de exclusión que lo garantice todavía
-- (requeriría btree_gist); si llegara a pasar, esta vista duplicaría filas
-- para esos días.
create view public.v_prorrateo_semanal_personal with (security_invoker = true) as
select
  a.personal_id,
  p.nombre as personal_nombre,
  a.empresa_id,
  date_trunc('week', a.fecha)::date as semana_inicio,
  count(*) as dias_asignados,
  round(c.sueldo_semanal / 7 * count(*), 2) as monto_dias_asignados
from public.asignaciones_diarias a
join public.personal p on p.id = a.personal_id
join public.contrataciones c
  on c.personal_id = a.personal_id
  and a.fecha between c.fecha_inicio and c.fecha_fin
group by a.personal_id, p.nombre, a.empresa_id, date_trunc('week', a.fecha)::date, c.sueldo_semanal;
