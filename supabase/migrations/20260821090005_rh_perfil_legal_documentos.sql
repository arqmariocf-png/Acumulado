-- Datos legales/notariales de cada empresa, necesarios para llenar el
-- machote real de contrato (declaraciones I y III del CONTRATO INDIVIDUAL
-- DE TRABAJO POR TIEMPO DETERMINADO compartido por el usuario). Solo se
-- sabe con certeza el de Ergodinova -- las otras 7 empresas quedan sin
-- perfil legal (y por lo tanto sin poder generar contrato) hasta que el
-- usuario comparta sus datos notariales reales; el edge function de
-- generación de contrato debe validar que exista el perfil antes de
-- intentar llenar el documento, nunca inventar estos datos.
create table public.empresas_perfil_legal (
  empresa_id uuid primary key references public.empresas (id),

  razon_social text not null, -- puede llevar el "S.A. DE C.V." exacto que trae el machote, distinto del nombre corto en empresas.nombre
  representante_legal_nombre text not null,
  representante_legal_puesto text not null default 'Administrador Único',

  escritura_constitucion_numero text,
  escritura_constitucion_fecha date,
  escritura_constitucion_notario text,
  escritura_constitucion_notaria_numero text,
  escritura_constitucion_distrito_judicial text,

  escritura_poderes_numero text,
  escritura_poderes_fecha date,
  escritura_poderes_notario text,

  domicilio_legal text not null,
  ciudad_firma text not null default 'Puebla, Pue.',

  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.empresas_perfil_legal is 'Datos notariales/legales por empresa para llenar el machote de contrato. Sin este registro, esa empresa no puede generar contratos -- nunca se debe inventar esta información.';

create trigger empresas_perfil_legal_set_updated_at
  before update on public.empresas_perfil_legal
  for each row
  execute function public.set_updated_at();

alter table public.empresas_perfil_legal enable row level security;

create policy empresas_perfil_legal_all on public.empresas_perfil_legal
  for all
  using (public.auth_rol() in ('rh', 'admin'))
  with check (public.auth_rol() in ('rh', 'admin'));

-- Dato real confirmado por el usuario (contrato + RFC visible en el pie del
-- formulario "Requisitos para alta y accesos de personal").
insert into public.empresas_perfil_legal (
  empresa_id, razon_social, representante_legal_nombre, representante_legal_puesto,
  escritura_constitucion_numero, escritura_constitucion_fecha, escritura_constitucion_notario,
  escritura_constitucion_notaria_numero, escritura_constitucion_distrito_judicial,
  escritura_poderes_numero, escritura_poderes_fecha, escritura_poderes_notario,
  domicilio_legal, ciudad_firma
)
select
  id, '"ERGODINOVA" S.A. DE C.V.', 'MARIO CONTRERAS FARFÁN', 'Administrador Único',
  '15,074', date '2008-05-12', 'LIC. ENRIQUE RAMÍREZ GUYOT',
  '13', 'Puebla',
  '20,489', date '2021-09-22', 'LIC. ENRIQUE RAMÍREZ GUYOT',
  'CALLE PROLONGACION 13 ORIENTE NO. 1823, SAN BERNARDINO TLAXCALANCINGO, SAN ANDRES CHOLULA, PUEBLA, C.P. 72820',
  'Puebla, Pue.'
from public.empresas where nombre = 'Ergodinova'
on conflict (empresa_id) do nothing;

-- ── Catálogo de documentos requeridos ───────────────────────────────────
-- Tomado literal del formulario real "Requisitos para alta y accesos de
-- personal" de Ergodinova (9 puntos + vigencias donde el formulario las
-- marca explícitamente). Catálogo, no hardcodeado en código, para poder
-- ajustar vigencias o agregar un documento nuevo sin migración.
create table public.tipos_documento_personal (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  vigencia_meses integer, -- NULL = no expira (ej. solicitud de empleo, CURP)
  aplica_a text not null default 'todos' check (aplica_a in ('todos', 'chofer')),
  orden integer not null,
  activo boolean not null default true
);

comment on table public.tipos_documento_personal is 'Catálogo de documentos requeridos para el expediente de personal, tomado del checklist real de Ergodinova.';

insert into public.tipos_documento_personal (nombre, vigencia_meses, aplica_a, orden) values
  ('INE (copia del original, no fotos)', null, 'todos', 1),
  ('Constancia de situación fiscal (SAT), régimen de sueldos y salarios', 3, 'todos', 2),
  ('CURP', null, 'todos', 3),
  ('NSS (Número de Seguridad Social)', null, 'todos', 4),
  ('Carta de antecedentes no penales', 24, 'todos', 5),
  ('Comprobante de domicilio', 3, 'todos', 6),
  ('Solicitud de empleo', null, 'todos', 7),
  ('Licencia de chofer (particular y/o servicio mercantil, copia del original)', null, 'chofer', 8);

-- ── Documentos entregados por cada persona ──────────────────────────────
-- Historial, no un solo registro por tipo: un documento con vigencia (ej.
-- comprobante de domicilio) se vuelve a subir cada vez que se renueva, y se
-- quiere conservar el histórico -- "el vigente" se calcula tomando el más
-- reciente por (personal_id, tipo_documento_id) en tiempo de consulta.
create table public.documentos_personal (
  id uuid primary key default gen_random_uuid(),
  personal_id uuid not null references public.personal (id) on delete cascade,
  tipo_documento_id uuid not null references public.tipos_documento_personal (id),
  fecha_entrega date not null default current_date,
  fecha_vigencia date, -- fecha_entrega + tipos_documento_personal.vigencia_meses, calculado por la app al insertar (no se puede generar en SQL: depende de otra tabla)
  storage_path text,
  verificado boolean not null default false,
  verificado_por uuid references auth.users (id),
  verificado_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.documentos_personal is 'Historial de documentos entregados por persona. El documento "vigente" de cada tipo es el más reciente por fecha_entrega.';

create index documentos_personal_personal_idx on public.documentos_personal (personal_id, tipo_documento_id, fecha_entrega desc);

alter table public.tipos_documento_personal enable row level security;
alter table public.documentos_personal enable row level security;

create policy tipos_documento_personal_select on public.tipos_documento_personal
  for select
  using (public.auth_rol() in ('rh', 'admin'));

create policy tipos_documento_personal_write on public.tipos_documento_personal
  for all
  using (public.auth_rol() = 'admin')
  with check (public.auth_rol() = 'admin');

create policy documentos_personal_all on public.documentos_personal
  for all
  using (public.auth_rol() in ('rh', 'admin'))
  with check (public.auth_rol() in ('rh', 'admin'));

-- ── Vista: expediente incompleto ────────────────────────────────────────
-- Para cada persona activa, qué tipos de documento (aplicables a su caso)
-- no tienen un documento vigente (nunca entregado, o entregado pero ya
-- venció) -- es lo que bloquea poder generar su contrato. El documento de
-- chofer solo aplica si el puesto de la persona contiene "chofer" -- sin
-- este filtro, a todo el personal le saldría como faltante ese documento.
create view public.v_documentos_faltantes_personal with (security_invoker = true) as
select
  p.id as personal_id,
  p.nombre as personal_nombre,
  td.id as tipo_documento_id,
  td.nombre as tipo_documento_nombre
from public.personal p
cross join public.tipos_documento_personal td
where p.activo
  and td.activo
  and (td.aplica_a = 'todos' or (td.aplica_a = 'chofer' and p.puesto ilike '%chofer%'))
  and not exists (
    select 1 from public.documentos_personal dp
    where dp.personal_id = p.id
      and dp.tipo_documento_id = td.id
      and (dp.fecha_vigencia is null or dp.fecha_vigencia >= current_date)
  );
