-- ── Multi-organización: Acumulado como plataforma maestra ────────────────
--
-- Hasta aquí el proyecto asumía UNA sola organización (Grupo Loma y sus 8
-- entidades). A partir de esta migración Acumulado es el maestro y cada
-- cliente entra como una organización ("grupo") propia -- la primera además
-- de Loma es ARSSA, la marca comercial del nuevo grupo que se va a operar.
--
-- Dos ideas, nada más:
--   1. `grupos` es el tenant. Toda tabla que antes era global (empresas,
--      reglas, excepciones, personal, tipos de documento) o que no colgaba
--      de una empresa (archivos_cargados sin empresa, audit_log) gana
--      `grupo_id`. Todo lo demás ya cuelga de `empresa_id`, y empresa
--      pertenece a un grupo -- con eso basta para aislar.
--   2. `modulos` + `grupo_modulos` es el interruptor por organización: un
--      grupo nuevo arranca solo con la base (organización, empresas,
--      usuarios y panel de admin) y se le van abriendo módulos conforme se
--      ocupen. Loma queda con los tres módulos abiertos, tal como opera hoy.
--
-- Las policies que usan todo esto están en 20260923090002_grupos_rls.sql.

create table public.grupos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  codigo text not null unique,
  marca_comercial text,
  es_maestro boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.grupos is
  'Organizaciones (tenants) que viven en Acumulado. es_maestro marca la organización operadora de la plataforma: sus admins administran las demás.';

-- Un solo maestro: la organización que opera la plataforma es una, no varias.
create unique index grupos_un_solo_maestro_idx on public.grupos (es_maestro) where es_maestro;

insert into public.grupos (nombre, codigo, marca_comercial, es_maestro) values
  ('Grupo Loma', 'LOMA', 'Grupo Loma', true),
  ('ARSSA', 'ARSSA', 'ARSSA', false);

comment on column public.grupos.marca_comercial is
  'Nombre con el que se identifica al grupo en la interfaz. ARSSA es marca comercial: las razones sociales del grupo se dan de alta en `empresas` cuando el cliente las defina.';

-- ── empresas: ahora pertenecen a una organización ───────────────────────
-- Las 8 entidades existentes son de Loma. nombre/codigo dejan de ser únicos
-- globalmente y pasan a ser únicos DENTRO del grupo: dos organizaciones
-- distintas pueden tener una empresa con el mismo código sin pisarse.
alter table public.empresas add column grupo_id uuid references public.grupos (id);
update public.empresas set grupo_id = (select id from public.grupos where codigo = 'LOMA');
alter table public.empresas alter column grupo_id set not null;

alter table public.empresas drop constraint empresas_nombre_key;
alter table public.empresas drop constraint empresas_codigo_key;
create unique index empresas_grupo_nombre_key on public.empresas (grupo_id, nombre);
create unique index empresas_grupo_codigo_key on public.empresas (grupo_id, codigo);
create index empresas_grupo_idx on public.empresas (grupo_id);

comment on table public.empresas is
  'Entidades (razones sociales) de cada organización. codigo es el identificador corto usado para casar la columna "Empresa" de las cargas, único dentro del grupo.';

-- ── profiles: cada usuario pertenece a una organización ─────────────────
-- Un usuario recién registrado sigue entrando en rol 'pendiente'; ahora
-- además entra SIN organización, y el admin le asigna ambas cosas.
alter table public.profiles add column grupo_id uuid references public.grupos (id);
update public.profiles set grupo_id = (select id from public.grupos where codigo = 'LOMA') where rol <> 'pendiente';
create index profiles_grupo_idx on public.profiles (grupo_id);

alter table public.profiles
  add constraint profiles_grupo_rol_check
  check (rol = 'pendiente' or grupo_id is not null);

comment on column public.profiles.grupo_id is
  'Organización del usuario. NULL solo mientras el rol es pendiente. empresa_id, si existe, SIEMPRE tiene que ser una empresa de este grupo (lo fuerza el trigger profiles_valida_empresa_grupo).';

-- Impide el estado incoherente "usuario de ARSSA con empresa de Loma".
-- Si el admin asigna empresa sin grupo, el grupo se deduce de la empresa.
create or replace function public.profiles_valida_empresa_grupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  grupo_de_la_empresa uuid;
begin
  if new.empresa_id is null then
    return new;
  end if;

  select grupo_id into grupo_de_la_empresa from public.empresas where id = new.empresa_id;

  if new.grupo_id is null then
    new.grupo_id := grupo_de_la_empresa;
  elsif new.grupo_id is distinct from grupo_de_la_empresa then
    raise exception 'La empresa asignada pertenece a otra organización que la del usuario';
  end if;

  return new;
end;
$$;

create trigger profiles_valida_empresa_grupo
  before insert or update on public.profiles
  for each row
  execute function public.profiles_valida_empresa_grupo();

revoke execute on function public.profiles_valida_empresa_grupo() from public;

-- ── Catálogo de módulos y qué tiene abierto cada organización ───────────
-- La base (organización, empresas, usuarios, panel de admin) no es un
-- módulo: siempre está disponible. Aquí solo viven los módulos operativos
-- que se abren conforme se ocupen.
create table public.modulos (
  clave text primary key,
  nombre text not null,
  descripcion text,
  orden integer not null default 0
);

comment on table public.modulos is
  'Catálogo de módulos operativos de la plataforma. Fijo a nivel de datos (lo siembra la migración); lo que sí es configurable por organización es cuáles están habilitados, en grupo_modulos.';

insert into public.modulos (clave, nombre, descripcion, orden) values
  ('conciliacion', 'Conciliación bancaria', 'Movimientos, carga de estados de cuenta y CFDI, motor de conciliación, dashboard, reportes especiales y pendientes.', 10),
  ('inventario', 'Inventario', 'Entradas y salidas de almacén, existencias, productos y match de recepción/embarque contra OC/OV.', 20),
  ('rh', 'Recursos Humanos', 'Personal, asignaciones diarias inter-empresa, contrataciones y expediente documental.', 30);

create table public.grupo_modulos (
  grupo_id uuid not null references public.grupos (id) on delete cascade,
  modulo_clave text not null references public.modulos (clave) on delete cascade,
  habilitado boolean not null default false,
  habilitado_at timestamptz,
  habilitado_por uuid references auth.users (id),
  primary key (grupo_id, modulo_clave)
);

create index grupo_modulos_habilitado_por_idx on public.grupo_modulos (habilitado_por);
create index grupo_modulos_modulo_idx on public.grupo_modulos (modulo_clave);

comment on table public.grupo_modulos is
  'Interruptor de módulos por organización. Una organización nueva arranca con todo en false (solo la base) y se le abren módulos conforme los ocupe.';

-- Loma conserva exactamente lo que opera hoy: los tres módulos abiertos.
-- ARSSA arranca solo con la base.
insert into public.grupo_modulos (grupo_id, modulo_clave, habilitado, habilitado_at)
select g.id, m.clave, g.codigo = 'LOMA', case when g.codigo = 'LOMA' then now() end
from public.grupos g
cross join public.modulos m;

-- ── Helpers de organización ─────────────────────────────────────────────
-- Mismo patrón que los helpers de 20260816090003: SECURITY DEFINER + STABLE
-- + search_path fijo, para que Postgres los evalúe una vez por consulta
-- (initplan) y no por fila.
--
-- Igual que auth_rol()/auth_empresa_id(), estos quedan llamables vía RPC y el
-- advisor de seguridad los va a marcar: NO se les puede revocar EXECUTE
-- porque las policies que los usan corren como `authenticated` y Postgres
-- exige ese privilegio (misma discusión y misma decisión que en
-- 20260817090001_fix_advisors.sql). Tampoco filtran nada: solo devuelven
-- datos derivados del propio auth.uid() de quien llama.
create or replace function public.auth_grupo_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select grupo_id from public.profiles where id = (select auth.uid())
$$;

-- Admin de la organización maestra = operador de la plataforma. Es el único
-- que cruza organizaciones (da de alta clientes nuevos y les abre módulos).
-- Un admin de una organización cliente es admin SOLO de la suya.
create or replace function public.auth_admin_global()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_rol() = 'admin'
     and exists (
       select 1 from public.grupos g
       where g.id = public.auth_grupo_id() and g.es_maestro
     )
$$;

create or replace function public.grupo_en_alcance(p_grupo_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_admin_global()
      or (p_grupo_id is not null and p_grupo_id = public.auth_grupo_id())
$$;

-- Alcance completo sobre una empresa: primero la frontera de organización,
-- después el alcance de empresa que ya existía (corporativo/admin ven todas
-- las de SU grupo; rol 'empresa' solo la suya).
create or replace function public.empresa_en_alcance(p_empresa_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_admin_global()
      or exists (
        select 1
        from public.empresas e
        where e.id = p_empresa_id
          and e.grupo_id = public.auth_grupo_id()
          and (public.auth_ve_todas_empresas() or e.id = public.auth_empresa_id())
      )
$$;

-- ¿El módulo está abierto para la organización de quien consulta? El admin
-- global lo tiene siempre abierto: es quien los abre y quien da soporte.
create or replace function public.auth_modulo_habilitado(p_clave text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_admin_global()
      or exists (
        select 1 from public.grupo_modulos gm
        where gm.grupo_id = public.auth_grupo_id()
          and gm.modulo_clave = p_clave
          and gm.habilitado
      )
$$;

-- Extrae la organización del primer folder de una ruta de Storage. Devolver
-- NULL en vez de castear directo es lo seguro: una policy sobre
-- storage.objects se evalúa contra objetos de TODOS los buckets, y Postgres no
-- garantiza evaluar antes la condición de bucket_id -- un cast a uuid
-- reventaría la consulta con cualquier objeto cuya ruta no empiece por uno.
create or replace function public.grupo_de_ruta(p_nombre text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  primer_folder text := split_part(coalesce(p_nombre, ''), '/', 1);
begin
  if primer_folder ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return primer_folder::uuid;
  end if;
  return null;
end;
$$;

-- ── grupo_id en las tablas que no cuelgan de una empresa ────────────────
-- archivos_cargados.empresa_id es nullable (una carga que falló antes de
-- resolver la empresa), así que necesita su propio grupo_id para no quedar
-- fuera de toda frontera.
alter table public.archivos_cargados add column grupo_id uuid references public.grupos (id);
update public.archivos_cargados set grupo_id = (select id from public.grupos where codigo = 'LOMA');
alter table public.archivos_cargados alter column grupo_id set not null;
create index archivos_cargados_grupo_idx on public.archivos_cargados (grupo_id);

-- Las funciones de ingesta insertan con la service_role key (sin sesión), así
-- que el grupo se deduce de la empresa del archivo; auth_grupo_id() es solo
-- el respaldo para inserciones hechas con sesión de usuario.
create or replace function public.archivos_cargados_set_grupo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.grupo_id is null and new.empresa_id is not null then
    select grupo_id into new.grupo_id from public.empresas where id = new.empresa_id;
  end if;
  if new.grupo_id is null then
    new.grupo_id := public.auth_grupo_id();
  end if;
  if new.grupo_id is null then
    raise exception 'No se pudo determinar la organización del archivo cargado';
  end if;
  return new;
end;
$$;

create trigger archivos_cargados_set_grupo
  before insert on public.archivos_cargados
  for each row
  execute function public.archivos_cargados_set_grupo();

revoke execute on function public.archivos_cargados_set_grupo() from public;

-- Reglas y excepciones dejan de ser globales: cada organización clasifica con
-- las suyas. Las 13 reglas y 3 excepciones ya sembradas son de Loma; ARSSA
-- sembrará las suyas cuando se le abra el módulo de conciliación.
alter table public.reglas_clasificacion add column grupo_id uuid references public.grupos (id);
update public.reglas_clasificacion set grupo_id = (select id from public.grupos where codigo = 'LOMA');
alter table public.reglas_clasificacion alter column grupo_id set not null;
create index reglas_clasificacion_grupo_idx on public.reglas_clasificacion (grupo_id);

alter table public.excepciones_proveedor add column grupo_id uuid references public.grupos (id);
update public.excepciones_proveedor set grupo_id = (select id from public.grupos where codigo = 'LOMA');
alter table public.excepciones_proveedor alter column grupo_id set not null;
create index excepciones_proveedor_grupo_idx on public.excepciones_proveedor (grupo_id);

-- La unicidad de estas dos también era global, y eso dejaba a la primera
-- organización que llegara dueña de cada palabra clave y de cada proveedor:
-- ARSSA no podría tener su propia regla 'TRASPASO' ni su propia excepción de
-- 'CEMEX'. Pasa a ser unicidad dentro del grupo, igual que en empresas.
alter table public.reglas_clasificacion drop constraint reglas_clasificacion_palabra_clave_key;
create unique index reglas_clasificacion_grupo_palabra_key on public.reglas_clasificacion (grupo_id, palabra_clave);

alter table public.excepciones_proveedor drop constraint excepciones_proveedor_proveedor_key;
create unique index excepciones_proveedor_grupo_proveedor_key on public.excepciones_proveedor (grupo_id, proveedor);

-- personal no cuelga de una empresa a propósito (una persona rota entre
-- empresas del grupo, ver 20260821090003), así que el tenant es el grupo.
alter table public.personal add column grupo_id uuid references public.grupos (id);
update public.personal set grupo_id = (select id from public.grupos where codigo = 'LOMA');
alter table public.personal alter column grupo_id set not null;
create index personal_grupo_idx on public.personal (grupo_id);

alter table public.tipos_documento_personal add column grupo_id uuid references public.grupos (id);
update public.tipos_documento_personal set grupo_id = (select id from public.grupos where codigo = 'LOMA');
alter table public.tipos_documento_personal alter column grupo_id set not null;
create index tipos_documento_personal_grupo_idx on public.tipos_documento_personal (grupo_id);

create or replace function public.set_grupo_id_del_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.grupo_id is null then
    new.grupo_id := public.auth_grupo_id();
  end if;
  if new.grupo_id is null then
    raise exception 'No se pudo determinar la organización del registro: el usuario no tiene organización asignada';
  end if;
  return new;
end;
$$;

create trigger reglas_clasificacion_set_grupo
  before insert on public.reglas_clasificacion
  for each row execute function public.set_grupo_id_del_usuario();

create trigger excepciones_proveedor_set_grupo
  before insert on public.excepciones_proveedor
  for each row execute function public.set_grupo_id_del_usuario();

create trigger personal_set_grupo
  before insert on public.personal
  for each row execute function public.set_grupo_id_del_usuario();

create trigger tipos_documento_personal_set_grupo
  before insert on public.tipos_documento_personal
  for each row execute function public.set_grupo_id_del_usuario();

revoke execute on function public.set_grupo_id_del_usuario() from public;

-- ── audit_log ───────────────────────────────────────────────────────────
-- La bitácora no tenía frontera propia: sin grupo_id, un corporativo de una
-- organización podría leer los cambios de otra (el payload jsonb trae la
-- fila completa del movimiento).
alter table public.audit_log add column grupo_id uuid references public.grupos (id);

update public.audit_log a
set grupo_id = e.grupo_id
from public.empresas e
where e.id = coalesce(
  (a.datos_nuevos ->> 'empresa_id')::uuid,
  (a.datos_previos ->> 'empresa_id')::uuid
);

create index audit_log_grupo_idx on public.audit_log (grupo_id);

create or replace function public.audit_movimientos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (tabla, registro_id, accion, usuario_id, grupo_id, datos_previos, datos_nuevos)
  values (
    'movimientos',
    coalesce(new.id, old.id),
    lower(tg_op),
    auth.uid(),
    (select grupo_id from public.empresas where id = coalesce(new.empresa_id, old.empresa_id)),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

revoke execute on function public.audit_movimientos() from public;

-- Misma corrección para la bitácora de inventario (20260824090005): sin
-- grupo_id, sus filas quedarían fuera de toda organización y nadie más que
-- el admin maestro podría leerlas.
create or replace function public.audit_movimientos_inventario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (tabla, registro_id, accion, usuario_id, grupo_id, datos_previos, datos_nuevos)
  values (
    'movimientos_inventario',
    coalesce(new.id, old.id),
    lower(tg_op),
    auth.uid(),
    (select grupo_id from public.empresas where id = coalesce(new.empresa_id, old.empresa_id)),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

revoke execute on function public.audit_movimientos_inventario() from public;
