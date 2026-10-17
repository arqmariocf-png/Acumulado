-- CRM de ventas por WhatsApp y redes (17-oct-2026, Mario: "armemos el módulo
-- de ventas a través de redes sociales y de WhatsApp; un CRM de atención que
-- genere las cotizaciones de manera automática"). Decisiones de Mario: la
-- cotización la revisa una persona antes de enviarse; todavía no hay cuenta
-- de Meta (la conversación se registra pegando el mensaje; la conexión con
-- la API de WhatsApp/Facebook/Instagram se agrega después usando
-- `crm_mensajes.externo_id`); se empieza con Clavicón y AEP.
--
--   * crm_prospectos: contacto por empresa (nombre, teléfono, canal), etapa
--     del embudo (nuevo → cotizado → en negociación → ganado | perdido),
--     vendedor asignado, cliente registrado si ya existe, y cuándo fue el
--     último mensaje del cliente y nuestro (para "espera respuesta").
--   * crm_mensajes: la conversación (entrante / saliente), opcionalmente
--     ligada a la cotización que se mandó.
--   * cotizaciones_produccion.crm_prospecto_id: la cotización sale del mismo
--     cotizador (folio COT-<empresa>, membrete, convertir en OV).
-- Operan quienes cotizan (`auth_opera_cotizador`) en su alcance de empresas.
-- Ya aplicado en producción.

create table if not exists public.crm_prospectos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  nombre text not null check (btrim(nombre) <> ''),
  telefono text,
  correo text,
  canal text not null default 'whatsapp' check (canal in ('whatsapp', 'facebook', 'instagram', 'telefono', 'otro')),
  etapa text not null default 'nuevo' check (etapa in ('nuevo', 'cotizado', 'negociacion', 'ganado', 'perdido')),
  motivo_perdida text,
  cliente_id uuid references public.clientes (id) on delete set null,
  asignado_a uuid references public.profiles (id) on delete set null,
  asignado_nombre text,
  notas text,
  ultimo_entrante_en timestamptz,
  ultimo_saliente_en timestamptz,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_prospectos_empresa_idx on public.crm_prospectos (empresa_id, etapa);
create index if not exists crm_prospectos_cliente_idx on public.crm_prospectos (cliente_id);
create index if not exists crm_prospectos_asignado_idx on public.crm_prospectos (asignado_a);
create index if not exists crm_prospectos_created_by_idx on public.crm_prospectos (created_by);

create table if not exists public.crm_mensajes (
  id uuid primary key default gen_random_uuid(),
  prospecto_id uuid not null references public.crm_prospectos (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),
  direccion text not null check (direccion in ('entrante', 'saliente')),
  texto text not null check (btrim(texto) <> ''),
  canal text,
  cotizacion_id uuid references public.cotizaciones_produccion (id) on delete set null,
  externo_id text unique,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_by_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists crm_mensajes_prospecto_idx on public.crm_mensajes (prospecto_id, created_at);
create index if not exists crm_mensajes_empresa_idx on public.crm_mensajes (empresa_id);
create index if not exists crm_mensajes_cotizacion_idx on public.crm_mensajes (cotizacion_id);
create index if not exists crm_mensajes_created_by_idx on public.crm_mensajes (created_by);

alter table public.cotizaciones_produccion add column if not exists crm_prospecto_id uuid references public.crm_prospectos (id) on delete set null;
create index if not exists cotizaciones_produccion_crm_idx on public.cotizaciones_produccion (crm_prospecto_id);

create or replace function public.crm_prospectos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.nombre := btrim(new.nombre);
  if new.asignado_a is distinct from (case when tg_op = 'UPDATE' then old.asignado_a end) then
    select nullif(btrim(nombre), '') into new.asignado_nombre from public.profiles where id = new.asignado_a;
  end if;
  if new.etapa <> 'perdido' then new.motivo_perdida := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists crm_prospectos_antes on public.crm_prospectos;
create trigger crm_prospectos_antes before insert or update on public.crm_prospectos
  for each row execute function public.crm_prospectos_antes();

-- El mensaje hereda la empresa; al registrarlo se mueve la última fecha del
-- prospecto y, si sale con cotización, el prospecto pasa a "cotizado".
create or replace function public.crm_mensajes_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select empresa_id, coalesce(new.canal, canal) into new.empresa_id, new.canal from public.crm_prospectos where id = new.prospecto_id;
  if new.empresa_id is null then raise exception 'Contacto no encontrado.'; end if;
  select nullif(btrim(nombre), '') into new.created_by_nombre from public.profiles where id = new.created_by;
  return new;
end;
$$;
drop trigger if exists crm_mensajes_antes on public.crm_mensajes;
create trigger crm_mensajes_antes before insert on public.crm_mensajes
  for each row execute function public.crm_mensajes_antes();

create or replace function public.crm_mensajes_despues()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.crm_prospectos
     set ultimo_entrante_en = case when new.direccion = 'entrante' then greatest(coalesce(ultimo_entrante_en, new.created_at), new.created_at) else ultimo_entrante_en end,
         ultimo_saliente_en = case when new.direccion = 'saliente' then greatest(coalesce(ultimo_saliente_en, new.created_at), new.created_at) else ultimo_saliente_en end,
         etapa = case when new.direccion = 'saliente' and new.cotizacion_id is not null and etapa = 'nuevo' then 'cotizado' else etapa end
   where id = new.prospecto_id;
  return null;
end;
$$;
drop trigger if exists crm_mensajes_despues on public.crm_mensajes;
create trigger crm_mensajes_despues after insert on public.crm_mensajes
  for each row execute function public.crm_mensajes_despues();

-- RLS -------------------------------------------------------------------------
alter table public.crm_prospectos enable row level security;
alter table public.crm_mensajes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['crm_prospectos', 'crm_mensajes'] loop
    execute format('drop policy if exists frontera_organizacion on public.%I', t);
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
      with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))$p$, t);
    execute format('drop policy if exists espectador_sin_datos on public.%I', t);
    execute format($p$create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()))$p$, t);
    execute format('drop policy if exists director_general on public.%I', t);
    execute format($p$create policy director_general on public.%I for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()))$p$, t);
    execute format('drop policy if exists %I on public.%I', t || '_opera', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using ((select public.auth_opera_cotizador()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
      with check ((select public.auth_opera_cotizador()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_opera', t);
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
