-- Módulo de Recursos Humanos, primera capa: personal, su asignación diaria a
-- empresa/obra (mecánica "inter-empresa" confirmada con el usuario
-- 2026-08-21, ejemplo real: plomero con sueldo semanal $3,200, lun-mié en
-- una obra de LOMA y jue-sáb en una obra de Ergodinova).
--
-- El campo sueldo_semanal NO vive en `personal` -- vive en `contrataciones`
-- (20260821090004), porque un contrato por tiempo determinado se renueva y
-- el sueldo puede cambiar entre una renovación y otra; `personal` es el
-- registro de identidad de la persona, no de un contrato específico.
--
-- Los campos de este archivo (curp, rfc, domicilios, INE, INFONAVIT,
-- contacto de emergencia, beneficiario) están tomados del formulario real
-- "Requisitos para alta y accesos de personal" de Ergodinova y de los
-- documentos de ejemplo compartidos (INE, CURP, contrato) -- no son
-- inventados.
--
-- Lo que NO incluye todavía esta migración, a propósito:
--   - la generación automática del contrato/documentos (falta la cláusula
--     inter-empresa que el usuario pidió agregar al machote, y los datos
--     legales/notariales de las 7 empresas restantes -- ver
--     20260821090005_rh_perfil_legal_documentos.sql, que solo trae los
--     datos de Ergodinova por ahora)
--   - el "listado de pagos" de los jueves para tesorería (el usuario mismo
--     dijo que eso se configura más adelante)
--   - qué pasa con el día de descanso cuando la semana no se trabajó
--     completa (ausencias) -- el usuario confirmó que el sueldo semanal se
--     divide entre 7 y que el 7° día (descanso) se reparte proporcional a
--     los días trabajados en cada empresa, pero eso se validó para una
--     semana COMPLETA (6 días trabajados, y de hecho el contrato real de
--     Ergodinova lo confirma textualmente: "dicho salario incluye el
--     importe de la parte proporcional del séptimo día"). Qué pasa con una
--     semana con ausencias no está confirmado, así que la vista de abajo
--     solo calcula el monto de los días efectivamente asignados -- NO
--     intenta repartir el séptimo día, para no introducir una regla de
--     pago no confirmada.

create table public.personal (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  puesto text,

  -- Identidad / demográficos -- necesarios para el llenado automático del
  -- contrato (sexo determina la redacción "EL/LA TRABAJADOR(A)").
  fecha_nacimiento date,
  sexo text check (sexo in ('M', 'F')),
  estado_civil text,
  nacionalidad text not null default 'Mexicana',
  telefono text,
  correo text,

  curp text,
  rfc text,
  domicilio_particular text,
  domicilio_notificaciones text, -- frecuentemente distinto al particular (confirmado con el usuario) -- nunca copiar uno del otro por default.

  ine_numero_identificacion text,
  ine_clave_elector text,

  infonavit_tiene_credito boolean not null default false,
  infonavit_numero_credito text,

  contacto_emergencia_nombre text,
  contacto_emergencia_telefono text,
  contacto_emergencia_parentesco text,

  -- Beneficiario Art. 25 fracción X / Art. 501 LFT (salarios y prestaciones
  -- devengadas no cobradas en caso de fallecimiento) -- conceptualmente
  -- distinto del contacto de emergencia aunque en la práctica suele ser la
  -- misma persona; se capturan por separado porque no siempre coinciden.
  beneficiario_nombre text,
  beneficiario_parentesco text,

  -- Fecha de la PRIMERA contratación real -- base para calcular antigüedad
  -- a través de renovaciones de contrato (la antigüedad legal se acumula
  -- aunque el contrato por tiempo determinado se renueve, no se reinicia
  -- por cada contratación nueva en `contrataciones`).
  fecha_ingreso date not null,
  activo boolean not null default true,

  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.personal is 'Personal del grupo (RH). No está ligado a una sola empresa -- su costo se reparte día a día vía asignaciones_diarias, y su empleador formal por contrato vive en contrataciones.';

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

comment on table public.asignaciones_diarias is 'Un renglón por persona+día trabajado y la empresa/obra a la que se le asigna ese día -- la base del prorrateo inter-empresa. empresa_id aquí es dónde trabajó ESE día, independiente de qué empresa firma como patrón en contrataciones.';
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
