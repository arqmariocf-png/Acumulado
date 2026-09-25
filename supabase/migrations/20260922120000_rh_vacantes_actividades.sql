-- Panel de RH para Fernando (pedido de Mario, 22-sep-2026): vacantes
-- disponibles con sus candidatos, rotación de personal por mes y
-- actividades asignadas con seguimiento de cumplimiento. Las actividades
-- reutilizan el módulo de Tareas (tablero "RH · Actividades", corporativo);
-- aquí solo se agregan vacantes/candidatos y la vista de rotación.

create table public.vacantes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id),
  puesto text not null,
  area text check (area in ('operativo', 'administrativo', 'bbva_puebla')),
  cantidad integer not null default 1 check (cantidad > 0),
  descripcion text,
  prioridad text not null default 'media' check (prioridad in ('alta', 'media', 'baja')),
  -- 'reemplazo' cuando la vacante nace de una baja; se liga a la persona.
  motivo text not null default 'nueva' check (motivo in ('nueva', 'reemplazo')),
  reemplaza_personal_id uuid references public.personal (id),
  fecha_apertura date not null default current_date,
  fecha_cierre date,
  estatus text not null default 'abierta' check (estatus in ('abierta', 'cubierta', 'cancelada')),
  cubierta_por_personal_id uuid references public.personal (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vacantes_estatus_idx on public.vacantes (estatus, fecha_apertura desc);

create trigger vacantes_set_updated_at before update on public.vacantes for each row execute function public.set_updated_at();

create table public.vacante_candidatos (
  id uuid primary key default gen_random_uuid(),
  vacante_id uuid not null references public.vacantes (id) on delete cascade,
  nombre text not null,
  telefono text,
  correo text,
  fuente text,
  estatus text not null default 'postulado' check (estatus in ('postulado', 'entrevista', 'oferta', 'contratado', 'descartado')),
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vacante_candidatos_vacante_idx on public.vacante_candidatos (vacante_id, created_at);

create trigger vacante_candidatos_set_updated_at before update on public.vacante_candidatos for each row execute function public.set_updated_at();

alter table public.vacantes enable row level security;
alter table public.vacante_candidatos enable row level security;

-- RH y admin administran; corporativo y dirección consultan.
create policy vacantes_select on public.vacantes
  for select using (public.auth_rol() in ('rh', 'admin', 'corporativo', 'direccion'));
create policy vacantes_write on public.vacantes
  for all using (public.auth_rol() in ('rh', 'admin')) with check (public.auth_rol() in ('rh', 'admin'));
create policy vacante_candidatos_select on public.vacante_candidatos
  for select using (public.auth_rol() in ('rh', 'admin', 'corporativo', 'direccion'));
create policy vacante_candidatos_write on public.vacante_candidatos
  for all using (public.auth_rol() in ('rh', 'admin')) with check (public.auth_rol() in ('rh', 'admin'));

-- Rotación mensual de personal (últimos 12 meses): altas por fecha de
-- ingreso, bajas por fecha de baja, plantilla al cierre del mes y rotación
-- = bajas / plantilla promedio del mes.
create view public.v_rotacion_mensual with (security_invoker = true) as
with meses as (
  select date_trunc('month', current_date)::date - (n || ' months')::interval as mes
  from generate_series(0, 11) n
),
base as (
  select m.mes::date as mes,
    (select count(*) from public.personal p where p.fecha_ingreso >= m.mes and p.fecha_ingreso < (m.mes + interval '1 month')) as altas,
    (select count(*) from public.personal p where p.fecha_baja >= m.mes and p.fecha_baja < (m.mes + interval '1 month')) as bajas,
    (select count(*) from public.personal p where p.fecha_ingreso < m.mes and (p.fecha_baja is null or p.fecha_baja >= m.mes)) as plantilla_inicio,
    (select count(*) from public.personal p where p.fecha_ingreso < (m.mes + interval '1 month') and (p.fecha_baja is null or p.fecha_baja >= (m.mes + interval '1 month'))) as plantilla_fin
  from meses m
)
select mes, altas, bajas, plantilla_inicio, plantilla_fin,
  case when (plantilla_inicio + plantilla_fin) > 0 then round(bajas::numeric * 100 / ((plantilla_inicio + plantilla_fin) / 2.0), 1) else 0 end as rotacion_pct
from base
order by mes;

grant select on public.v_rotacion_mensual to authenticated;

-- Tablero corporativo de actividades de RH (el módulo de Tareas exige
-- admin/corporativo para crear tableros; se crea aquí una sola vez).
do $$
declare
  v_admin uuid;
  v_tablero uuid;
begin
  select id into v_admin from public.profiles where rol = 'admin' order by created_at limit 1;

  -- El tablero exige un creador (tableros.creado_por es not null), así que la
  -- semilla solo corre si ya hay un admin. En una base recién creada todavía
  -- no lo hay -- el primer admin se da de alta a mano, ver README -- y sin
  -- esta guarda la migración revienta al aplicarse desde cero, que es justo lo
  -- que hay que poder hacer para restaurar o para probar.
  if v_admin is not null
     and not exists (select 1 from public.tableros where nombre = 'RH · Actividades') then
    insert into public.tableros (empresa_id, nombre, descripcion, creado_por)
      values (null, 'RH · Actividades', 'Actividades asignadas por Recursos Humanos con seguimiento de cumplimiento.', v_admin)
      returning id into v_tablero;
    insert into public.tablero_columnas (tablero_id, nombre, orden) values
      (v_tablero, 'Por hacer', 0), (v_tablero, 'En progreso', 1), (v_tablero, 'Hecho', 2);
  end if;
end $$;
