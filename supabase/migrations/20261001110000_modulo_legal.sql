-- Módulo Legal (Mario, 1-oct-2026): "necesito que esté Belén con el rol para
-- poderlo tener y dar seguimiento, al igual que Eréndira" + "este contrato
-- (propuesto por nuestros abogados) tenerlo como machote para llenarlo de
-- manera automática cuando el cliente esté autorizado para crédito".
--
-- Diseño:
--   * Módulo 'legal' (grupo_modulos: abierto a LOMA). Es un PERMISO por
--     persona (permisos_modulo), no un rol: Belén (corporativo) y Eréndira
--     (rh) lo reciben sin cambiar su rol. El admin siempre entra.
--   * Asuntos y juicios: legal_asuntos (folio LEG-<empresa>-0001, tipo,
--     contraparte, autoridad, expediente, abogado, monto en riesgo, estatus,
--     próxima fecha/actuación), bitácora legal_seguimiento (al registrar una
--     próxima fecha se actualiza el asunto) y legal_documentos (archivos en
--     el bucket privado "cargas" bajo legal/<empresa>/…, por la edge
--     legal-documentos).
--   * Crédito a clientes: clientes_credito (línea, días, interés moratorio,
--     datos legales del cliente para el contrato, obligado solidario).
--     Capturan legal y dirección; AUTORIZAN solo admin y dirección (trigger).
--   * Contratos: legal_contratos guarda cada contrato generado (folio
--     CTO-<empresa>-0001, monto, fecha de firma y la foto de los datos con
--     que se llenó). Solo se genera con el crédito del cliente autorizado.
--     El texto del machote vive en web/src/lib/contratoCredito.ts.
--   * empresas_perfil_legal: datos del PROVEEDOR para el contrato (volumen,
--     notaría del poder, objeto social, RFC, correo, teléfono…); legal la
--     lee y la captura además de RH.
--
-- Ya aplicado en producción.

-- 1. Módulo y permiso -----------------------------------------------------------
insert into public.modulos (clave, nombre, descripcion, orden)
select 'legal', 'Legal', 'Asuntos y juicios, contratos de crédito a clientes', 55
where not exists (select 1 from public.modulos where clave = 'legal');

insert into public.grupo_modulos (grupo_id, modulo_clave, habilitado, habilitado_at)
select g.id, 'legal', g.codigo = 'LOMA', case when g.codigo = 'LOMA' then now() end
from public.grupos g
where not exists (select 1 from public.grupo_modulos gm where gm.grupo_id = g.id and gm.modulo_clave = 'legal');

alter table public.permisos_modulo drop constraint if exists permisos_modulo_modulo_check;
alter table public.permisos_modulo add constraint permisos_modulo_modulo_check
  check (modulo in ('inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva', 'comedor', 'legal'));

-- Quién opera legal: admin o con el permiso 'legal' (cualquier rol).
create or replace function public.auth_opera_legal()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.rol = 'admin'
           or exists (select 1 from public.permisos_modulo pm where pm.profile_id = p.id and pm.modulo = 'legal'))
  )
$$;

-- Crédito a clientes: legal captura; dirección captura y autoriza.
create or replace function public.auth_credito_clientes()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_opera_legal() or public.auth_rol() = 'direccion'
$$;

create or replace function public.auth_autoriza_credito()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_rol() in ('admin', 'direccion')
$$;

-- 2. Asuntos y juicios ------------------------------------------------------------
create table if not exists public.legal_asuntos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  folio text,
  tipo text not null default 'otro'
    check (tipo in ('laboral', 'civil', 'mercantil', 'fiscal', 'administrativo', 'penal', 'contrato', 'otro')),
  titulo text not null check (length(trim(titulo)) > 0),
  contraparte text,
  autoridad text,
  expediente text,
  abogado text,
  responsable_nombre text,
  monto_en_riesgo numeric(14,2),
  prioridad text not null default 'media' check (prioridad in ('alta', 'media', 'baja')),
  estatus text not null default 'abierto'
    check (estatus in ('abierto', 'en_tramite', 'suspendido', 'convenio', 'cerrado_favorable', 'cerrado_desfavorable')),
  fecha_inicio date,
  proxima_fecha date,
  proxima_actuacion text,
  descripcion text,
  cerrado_en date,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio)
);
create index if not exists legal_asuntos_empresa_idx on public.legal_asuntos (empresa_id, estatus);
create index if not exists legal_asuntos_proxima_idx on public.legal_asuntos (proxima_fecha);

create table if not exists public.legal_seguimiento (
  id uuid primary key default gen_random_uuid(),
  asunto_id uuid not null references public.legal_asuntos(id) on delete cascade,
  fecha date not null default current_date,
  tipo text not null default 'nota'
    check (tipo in ('audiencia', 'promocion', 'notificacion', 'acuerdo', 'reunion', 'pago', 'nota')),
  nota text not null check (length(trim(nota)) > 0),
  proxima_fecha date,
  proxima_actuacion text,
  autor_id uuid references auth.users(id) default auth.uid(),
  autor_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists legal_seguimiento_asunto_idx on public.legal_seguimiento (asunto_id, fecha desc);

create table if not exists public.legal_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  asunto_id uuid references public.legal_asuntos(id) on delete cascade,
  contrato_id uuid,
  storage_path text not null,
  nombre text,
  descripcion text,
  subido_por uuid references auth.users(id),
  subido_por_nombre text,
  created_at timestamptz not null default now(),
  check (asunto_id is not null or contrato_id is not null)
);
create index if not exists legal_documentos_asunto_idx on public.legal_documentos (asunto_id);
create index if not exists legal_documentos_contrato_idx on public.legal_documentos (contrato_id);
create index if not exists legal_documentos_empresa_idx on public.legal_documentos (empresa_id);

-- Folio y updated_at del asunto.
create or replace function public.legal_asuntos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and nullif(trim(new.folio), '') is null then
    new.folio := public.fn_siguiente_folio(new.empresa_id, 'LEG');
  end if;
  if new.estatus in ('cerrado_favorable', 'cerrado_desfavorable') and new.cerrado_en is null then
    new.cerrado_en := current_date;
  elsif new.estatus not in ('cerrado_favorable', 'cerrado_desfavorable') then
    new.cerrado_en := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists legal_asuntos_antes on public.legal_asuntos;
create trigger legal_asuntos_antes before insert or update on public.legal_asuntos
  for each row execute function public.legal_asuntos_antes();

-- Autor del seguimiento y próxima fecha al asunto.
create or replace function public.legal_seguimiento_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.autor_id := coalesce(new.autor_id, auth.uid());
  select p.nombre into new.autor_nombre from public.profiles p where p.id = new.autor_id;
  return new;
end;
$$;
drop trigger if exists legal_seguimiento_antes on public.legal_seguimiento;
create trigger legal_seguimiento_antes before insert on public.legal_seguimiento
  for each row execute function public.legal_seguimiento_antes();

create or replace function public.legal_seguimiento_despues()
returns trigger language plpgsql as $$
begin
  if new.proxima_fecha is not null then
    update public.legal_asuntos
       set proxima_fecha = new.proxima_fecha,
           proxima_actuacion = coalesce(nullif(trim(new.proxima_actuacion), ''), proxima_actuacion)
     where id = new.asunto_id;
  end if;
  return new;
end;
$$;
drop trigger if exists legal_seguimiento_despues on public.legal_seguimiento;
create trigger legal_seguimiento_despues after insert on public.legal_seguimiento
  for each row execute function public.legal_seguimiento_despues();

-- 3. Datos del proveedor (la empresa) para los contratos --------------------------
alter table public.empresas_perfil_legal
  add column if not exists rfc text,
  add column if not exists objeto_social text,
  add column if not exists representante_tratamiento text,
  add column if not exists representante_titulo text,
  add column if not exists escritura_constitucion_volumen text,
  add column if not exists escritura_poderes_volumen text,
  add column if not exists escritura_poderes_notaria_numero text,
  add column if not exists escritura_poderes_distrito_judicial text,
  add column if not exists correo text,
  add column if not exists telefono text;

drop policy if exists empresas_perfil_legal_legal_select on public.empresas_perfil_legal;
create policy empresas_perfil_legal_legal_select on public.empresas_perfil_legal for select to authenticated
  using ((select public.auth_credito_clientes()) and 'legal' = any ((select public.auth_modulos_habilitados())::text[]));
drop policy if exists empresas_perfil_legal_legal_insert on public.empresas_perfil_legal;
create policy empresas_perfil_legal_legal_insert on public.empresas_perfil_legal for insert to authenticated
  with check ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
              and 'legal' = any ((select public.auth_modulos_habilitados())::text[]));
drop policy if exists empresas_perfil_legal_legal_update on public.empresas_perfil_legal;
create policy empresas_perfil_legal_legal_update on public.empresas_perfil_legal for update to authenticated
  using ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer()))
  with check ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer()));

-- AEP, tal como viene en el contrato que propusieron los abogados (solo si no existe).
insert into public.empresas_perfil_legal (
  empresa_id, razon_social, representante_legal_nombre, representante_legal_puesto,
  representante_tratamiento, representante_titulo, objeto_social, rfc,
  escritura_constitucion_numero, escritura_constitucion_volumen, escritura_constitucion_fecha,
  escritura_constitucion_notario, escritura_constitucion_notaria_numero, escritura_constitucion_distrito_judicial,
  escritura_poderes_numero, escritura_poderes_volumen, escritura_poderes_fecha, escritura_poderes_notario,
  escritura_poderes_notaria_numero, escritura_poderes_distrito_judicial,
  domicilio_legal, ciudad_firma, correo, telefono)
select e.id, 'ACEROS Y ENVASADOS DE PUEBLA, S.A. DE C.V.', 'ERENDIRA SOLIS TECUATL', 'ADMINISTRADOR ÚNICO',
  'LA C.', 'LICENCIADA',
  'comercialización, distribución, importación, exportación, arrendamiento y adquisición de equipo y maquinaria de construcción así como la comercialización, distribución, importación, exportación y adquisición de materiales para construcción así como de muebles y enseres en general entre otros',
  'AEL131023CS1',
  '7354', '1126', date '2013-10-23', 'Licenciado Arturo Díaz González', '43', 'Puebla',
  '43752', '500', date '2018-05-08', 'Licenciada María Emilia Sesma Téllez', '3', 'Cholula, Puebla',
  'Prolongación 13 oriente número 1823, San Bernardino Tlaxcalancingo, San Andrés Cholula, Puebla, código postal 72820',
  'Heroica Puebla de Zaragoza, Estado de Puebla', 'arq.mariocf@gmail.com', '222 136 65 80'
from public.empresas e
where e.codigo = 'AEP'
on conflict (empresa_id) do nothing;

-- 4. Crédito a clientes -------------------------------------------------------------
create table if not exists public.clientes_credito (
  cliente_id uuid primary key references public.clientes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  autorizado boolean not null default false,
  autorizado_en timestamptz,
  autorizado_por uuid references auth.users(id),
  autorizado_por_nombre text,
  linea_credito numeric(14,2) check (linea_credito is null or linea_credito > 0),
  dias_credito integer check (dias_credito is null or dias_credito >= 0),
  interes_moratorio_pct numeric(5,2) not null default 3 check (interes_moratorio_pct >= 0),
  tipo_persona text not null default 'moral' check (tipo_persona in ('moral', 'fisica')),
  representante_nombre text,
  representante_cargo text,
  representante_tratamiento text,
  domicilio_legal text,
  correos text,
  telefonos text,
  obligado_solidario_nombre text,
  -- Escritura constitutiva y poder del representante (número, volumen, fecha,
  -- notario, notaría, ciudad, registro, otorgante, facultades) o el párrafo
  -- tal cual lo redactó el abogado ("constitutiva_texto" / "poder_texto").
  legales jsonb not null default '{}'::jsonb,
  notas text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);
create index if not exists clientes_credito_empresa_idx on public.clientes_credito (empresa_id);

-- empresa = la del cliente; autorizar, cambiar línea/días/interés de un
-- crédito autorizado o quitar la autorización: solo admin y dirección.
create or replace function public.clientes_credito_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_autoriza boolean := public.auth_autoriza_credito() or auth.uid() is null;
begin
  select c.empresa_id into new.empresa_id from public.clientes c where c.id = new.cliente_id;
  if new.empresa_id is null then raise exception 'Cliente no encontrado'; end if;
  if tg_op = 'INSERT' then
    if new.autorizado and not v_autoriza then
      raise exception 'Solo dirección o el administrador autorizan el crédito';
    end if;
  else
    if new.autorizado is distinct from old.autorizado and not v_autoriza then
      raise exception 'Solo dirección o el administrador autorizan el crédito';
    end if;
    if old.autorizado and new.autorizado and not v_autoriza
       and (new.linea_credito is distinct from old.linea_credito
            or new.dias_credito is distinct from old.dias_credito
            or new.interes_moratorio_pct is distinct from old.interes_moratorio_pct) then
      raise exception 'El crédito ya está autorizado: la línea, los días y el interés solo los cambia dirección';
    end if;
  end if;
  if new.autorizado and (tg_op = 'INSERT' or not old.autorizado) then
    if new.linea_credito is null then raise exception 'Captura el monto de la línea de crédito antes de autorizar'; end if;
    new.autorizado_en := now();
    new.autorizado_por := auth.uid();
    select p.nombre into new.autorizado_por_nombre from public.profiles p where p.id = auth.uid();
  elsif not new.autorizado then
    new.autorizado_en := null;
    new.autorizado_por := null;
    new.autorizado_por_nombre := null;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists clientes_credito_antes on public.clientes_credito;
create trigger clientes_credito_antes before insert or update on public.clientes_credito
  for each row execute function public.clientes_credito_antes();

-- Legal y dirección también ven y dan de alta clientes (el contrato los necesita).
drop policy if exists clientes_legal_select on public.clientes;
create policy clientes_legal_select on public.clientes for select to authenticated
  using ((select public.auth_credito_clientes()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists clientes_legal_insert on public.clientes;
create policy clientes_legal_insert on public.clientes for insert to authenticated
  with check ((select public.auth_credito_clientes()) and (select public.auth_suscripcion_permite_escribir_definer())
              and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists clientes_legal_update on public.clientes;
create policy clientes_legal_update on public.clientes for update to authenticated
  using ((select public.auth_credito_clientes()) and (select public.auth_suscripcion_permite_escribir_definer())
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
  with check ((select public.auth_credito_clientes()) and (select public.auth_suscripcion_permite_escribir_definer())
              and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));

-- 5. Contratos generados ------------------------------------------------------------
create table if not exists public.legal_contratos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  cliente_id uuid not null references public.clientes(id),
  folio text,
  tipo text not null default 'suministro_credito' check (tipo in ('suministro_credito')),
  monto numeric(14,2) not null check (monto > 0),
  fecha_firma date not null default current_date,
  ciudad_firma text,
  datos jsonb not null default '{}'::jsonb,
  estatus text not null default 'borrador' check (estatus in ('borrador', 'firmado', 'cancelado')),
  firmado_en date,
  notas text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio)
);
create index if not exists legal_contratos_cliente_idx on public.legal_contratos (cliente_id);
create index if not exists legal_contratos_empresa_idx on public.legal_contratos (empresa_id, created_at desc);

alter table public.legal_documentos drop constraint if exists legal_documentos_contrato_fk;
alter table public.legal_documentos add constraint legal_documentos_contrato_fk
  foreign key (contrato_id) references public.legal_contratos(id) on delete cascade;

create or replace function public.legal_contratos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select c.empresa_id into new.empresa_id from public.clientes c where c.id = new.cliente_id;
    if not exists (select 1 from public.clientes_credito cc where cc.cliente_id = new.cliente_id and cc.autorizado) then
      raise exception 'El crédito de este cliente no está autorizado: dirección lo autoriza antes de generar el contrato';
    end if;
    if nullif(trim(new.folio), '') is null then
      new.folio := public.fn_siguiente_folio(new.empresa_id, 'CTO');
    end if;
  end if;
  if new.estatus = 'firmado' and new.firmado_en is null then new.firmado_en := current_date; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists legal_contratos_antes on public.legal_contratos;
create trigger legal_contratos_antes before insert or update on public.legal_contratos
  for each row execute function public.legal_contratos_antes();

-- 6. RLS ------------------------------------------------------------------------------
alter table public.legal_asuntos enable row level security;
alter table public.legal_seguimiento enable row level security;
alter table public.legal_documentos enable row level security;
alter table public.clientes_credito enable row level security;
alter table public.legal_contratos enable row level security;

drop policy if exists frontera_organizacion on public.legal_asuntos;
create policy frontera_organizacion on public.legal_asuntos as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
drop policy if exists frontera_organizacion on public.legal_seguimiento;
create policy frontera_organizacion on public.legal_seguimiento as restrictive for all
  using (exists (select 1 from public.legal_asuntos a where a.id = legal_seguimiento.asunto_id))
  with check (exists (select 1 from public.legal_asuntos a where a.id = legal_seguimiento.asunto_id));
drop policy if exists frontera_organizacion on public.legal_documentos;
create policy frontera_organizacion on public.legal_documentos as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
drop policy if exists frontera_organizacion on public.clientes_credito;
create policy frontera_organizacion on public.clientes_credito as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
drop policy if exists frontera_organizacion on public.legal_contratos;
create policy frontera_organizacion on public.legal_contratos as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));

-- Asuntos: quien opera legal, en las empresas de su alcance.
drop policy if exists legal_asuntos_select on public.legal_asuntos;
create policy legal_asuntos_select on public.legal_asuntos for select to authenticated
  using ((select public.auth_opera_legal()) and 'legal' = any ((select public.auth_modulos_habilitados())::text[])
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists legal_asuntos_insert on public.legal_asuntos;
create policy legal_asuntos_insert on public.legal_asuntos for insert to authenticated
  with check ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
              and 'legal' = any ((select public.auth_modulos_habilitados())::text[])
              and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists legal_asuntos_update on public.legal_asuntos;
create policy legal_asuntos_update on public.legal_asuntos for update to authenticated
  using ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
  with check ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
              and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists legal_asuntos_delete on public.legal_asuntos;
create policy legal_asuntos_delete on public.legal_asuntos for delete to authenticated
  using ((select public.auth_rol_definer()) = 'admin');

-- Seguimiento y documentos heredan del asunto (o del contrato).
drop policy if exists legal_seguimiento_select on public.legal_seguimiento;
create policy legal_seguimiento_select on public.legal_seguimiento for select to authenticated
  using (exists (select 1 from public.legal_asuntos a where a.id = legal_seguimiento.asunto_id));
drop policy if exists legal_seguimiento_insert on public.legal_seguimiento;
create policy legal_seguimiento_insert on public.legal_seguimiento for insert to authenticated
  with check ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
              and exists (select 1 from public.legal_asuntos a where a.id = legal_seguimiento.asunto_id));
drop policy if exists legal_seguimiento_update on public.legal_seguimiento;
create policy legal_seguimiento_update on public.legal_seguimiento for update to authenticated
  using (autor_id = (select auth.uid()) and (select public.auth_suscripcion_permite_escribir_definer()))
  with check (autor_id = (select auth.uid()) and (select public.auth_suscripcion_permite_escribir_definer()));
drop policy if exists legal_seguimiento_delete on public.legal_seguimiento;
create policy legal_seguimiento_delete on public.legal_seguimiento for delete to authenticated
  using ((autor_id = (select auth.uid()) or (select public.auth_rol_definer()) = 'admin')
         and (select public.auth_suscripcion_permite_escribir_definer()));

drop policy if exists legal_documentos_select on public.legal_documentos;
create policy legal_documentos_select on public.legal_documentos for select to authenticated
  using (exists (select 1 from public.legal_asuntos a where a.id = legal_documentos.asunto_id)
         or exists (select 1 from public.legal_contratos c where c.id = legal_documentos.contrato_id));
drop policy if exists legal_documentos_delete on public.legal_documentos;
create policy legal_documentos_delete on public.legal_documentos for delete to authenticated
  using ((subido_por = (select auth.uid()) or (select public.auth_rol_definer()) = 'admin')
         and (select public.auth_suscripcion_permite_escribir_definer()));

-- Crédito y contratos: legal y dirección.
drop policy if exists clientes_credito_select on public.clientes_credito;
create policy clientes_credito_select on public.clientes_credito for select to authenticated
  using ((select public.auth_credito_clientes()) and 'legal' = any ((select public.auth_modulos_habilitados())::text[])
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists clientes_credito_insert on public.clientes_credito;
create policy clientes_credito_insert on public.clientes_credito for insert to authenticated
  with check ((select public.auth_credito_clientes()) and (select public.auth_suscripcion_permite_escribir_definer())
              and 'legal' = any ((select public.auth_modulos_habilitados())::text[])
              and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists clientes_credito_update on public.clientes_credito;
create policy clientes_credito_update on public.clientes_credito for update to authenticated
  using ((select public.auth_credito_clientes()) and (select public.auth_suscripcion_permite_escribir_definer())
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
  with check ((select public.auth_credito_clientes()) and (select public.auth_suscripcion_permite_escribir_definer())
              and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists clientes_credito_delete on public.clientes_credito;
create policy clientes_credito_delete on public.clientes_credito for delete to authenticated
  using ((select public.auth_autoriza_credito()) and (select public.auth_suscripcion_permite_escribir_definer()));

drop policy if exists legal_contratos_select on public.legal_contratos;
create policy legal_contratos_select on public.legal_contratos for select to authenticated
  using ((select public.auth_credito_clientes()) and 'legal' = any ((select public.auth_modulos_habilitados())::text[])
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists legal_contratos_insert on public.legal_contratos;
create policy legal_contratos_insert on public.legal_contratos for insert to authenticated
  with check ((select public.auth_credito_clientes()) and (select public.auth_suscripcion_permite_escribir_definer())
              and 'legal' = any ((select public.auth_modulos_habilitados())::text[])
              and exists (select 1 from public.clientes c where c.id = legal_contratos.cliente_id
                          and c.empresa_id = any ((select public.auth_empresas_alcance())::uuid[])));
drop policy if exists legal_contratos_update on public.legal_contratos;
create policy legal_contratos_update on public.legal_contratos for update to authenticated
  using ((select public.auth_credito_clientes()) and (select public.auth_suscripcion_permite_escribir_definer())
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
  with check ((select public.auth_credito_clientes()) and (select public.auth_suscripcion_permite_escribir_definer())
              and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists legal_contratos_delete on public.legal_contratos;
create policy legal_contratos_delete on public.legal_contratos for delete to authenticated
  using ((select public.auth_rol_definer()) = 'admin');

grant select, insert, update, delete on public.legal_asuntos, public.legal_seguimiento, public.clientes_credito, public.legal_contratos to authenticated;
grant select, delete on public.legal_documentos to authenticated;

-- Solo consulta (espectadores y organizaciones sin pago).
do $$
declare t text;
begin
  foreach t in array array['legal_asuntos', 'legal_seguimiento', 'legal_documentos', 'clientes_credito', 'legal_contratos'] loop
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
  end loop;
end $$;

-- 7. Siembra -------------------------------------------------------------------------
-- Permiso 'legal' para Belén Vergara (corporativo) y Eréndira Solís (rh), sin
-- cambiar su rol (Mario, 1-oct-2026). Solo si las cuentas existen.
insert into public.permisos_modulo (profile_id, modulo)
select p.id, 'legal' from public.profiles p
where p.id in ('83a81024-5ae6-45a1-ad83-738be2971d78', '0488e7c4-0418-429a-b470-46b2e99088d6')
  and not exists (select 1 from public.permisos_modulo pm where pm.profile_id = p.id and pm.modulo = 'legal');

-- RAMSICON, el cliente del contrato que mandaron los abogados, como cliente de
-- AEP con su crédito autorizado (línea de 150,000) y sus datos legales.
insert into public.clientes (empresa_id, razon_social, rfc, domicilio, email, telefono, codigo_postal)
select e.id, 'RAMSICON, S.A. DE C.V.', 'RAM0210042V9',
  'Vía Atlixcayotl número 6511, interior 38, Colonia San Bernardino Tlaxcalancingo, San Andrés Cholula, Puebla',
  'marthazm@ramsicon.com', '222 263 7762', '72820'
from public.empresas e
where e.codigo = 'AEP'
  and not exists (select 1 from public.clientes c where c.empresa_id = e.id and upper(c.rfc) = 'RAM0210042V9');

insert into public.clientes_credito (
  cliente_id, empresa_id, autorizado, linea_credito, interes_moratorio_pct, tipo_persona,
  representante_nombre, representante_cargo, representante_tratamiento, domicilio_legal, correos, telefonos,
  obligado_solidario_nombre, legales, notas)
select c.id, c.empresa_id, true, 150000, 3, 'moral',
  'MANUEL RAMÍREZ SAINZ', 'APODERADO LEGAL', 'EL C.',
  'Vía Atlixcayotl número 6511, interior 38, Colonia San Bernardino Tlaxcalancingo, entre calle Bernardino y calle De los Ángeles, San Andrés Cholula, Puebla, Código Postal 72820',
  'marthazm@ramsicon.com ; manuelrs@ramsicon.com', '222 263 7762 / 222 263 7749',
  'MANUEL RAMÍREZ SAINZ',
  jsonb_build_object(
    'constitutiva_numero', '12652', 'constitutiva_volumen', '182', 'constitutiva_fecha', '2002-10-04',
    'constitutiva_notario', '', 'constitutiva_notaria', '33', 'constitutiva_ciudad', 'Puebla, Puebla',
    'registro_numero', '1,862', 'registro_tomo', '2002', 'registro_fecha', '2002-11-11',
    'registro_lugar', 'Puebla',
    'poder_numero', '71040', 'poder_volumen', '1454', 'poder_fecha', '2018-09-06',
    'poder_notario', 'MARIO SALAZAR MARTÍNEZ', 'poder_notaria', '42',
    'poder_ciudad', 'la Heroica Ciudad de Puebla de Zaragoza, Puebla',
    'poder_otorgante', 'el Ingeniero MANUEL RAMÍREZ IBAÑEZ, en su carácter de Administrador Único de "RAMSICON", S.A. DE C.V.',
    'poder_facultades', 'Poder General para Pleitos y Cobranzas, Actos de Administración y para Actos de Administración en materia laboral, así como Poder General Limitado para ejercitar Actos de Dominio y para otorgar y suscribir títulos de crédito a nombre de la sociedad'),
  'Datos tomados del contrato propuesto por los abogados (1-oct-2026).'
from public.clientes c
join public.empresas e on e.id = c.empresa_id and e.codigo = 'AEP'
where upper(c.rfc) = 'RAM0210042V9'
on conflict (cliente_id) do nothing;

-- Director general (admin maestro) en las tablas nuevas: la misma policy que
-- pone fn_director_general_policies(), solo en estas cinco (correr la función
-- completa toma candados en todas las tablas y se atoraba en producción).
do $$
declare t text;
begin
  foreach t in array array['legal_asuntos', 'legal_seguimiento', 'legal_documentos', 'clientes_credito', 'legal_contratos'] loop
    execute format('drop policy if exists director_general on public.%I', t);
    execute format($p$create policy director_general on public.%I for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()))$p$, t);
  end loop;
end $$;
