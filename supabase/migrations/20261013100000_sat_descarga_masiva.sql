-- Descarga masiva automática de CFDI del SAT (13-oct-2026). Belén subió la
-- e.firma de las 8 empresas; con ella la edge `sat-descarga-masiva` pide al
-- web service del SAT (versión 1.5: SolicitaDescargaEmitidos /
-- SolicitaDescargaRecibidos) los CFDI vigentes de cada empresa, verifica
-- hasta que el SAT los tiene listos, baja los paquetes ZIP, lee cada XML y
-- los guarda en `cfdi` (misma forma que la carga manual de Compac: UUID como
-- folio, RFC de la contraparte, total o lo pagado en un complemento de pago).
--
-- `sat_descargas` es la bitácora de cada solicitud (una por empresa, tipo y
-- rango de fechas). La escribe solo la edge con service_role; la leen
-- contabilidad (permiso 'contabilidad') y el admin. Ya aplicado en
-- producción.

create table if not exists public.sat_descargas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('emitido', 'recibido')),
  tipo_solicitud text not null default 'CFDI' check (tipo_solicitud in ('CFDI', 'Metadata')),
  -- Hora de México, sin zona (así la pide el SAT).
  fecha_inicial timestamp not null,
  fecha_final timestamp not null,
  id_solicitud text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'solicitada', 'en_proceso', 'descargada', 'vacia', 'error', 'rechazada', 'vencida')),
  numero_cfdis integer,
  paquetes text[] not null default '{}',
  paquetes_descargados text[] not null default '{}',
  cfdi_guardados integer not null default 0,
  mensaje text,
  intentos integer not null default 0,
  solicitada_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminada_en timestamptz
);
create index if not exists sat_descargas_empresa_idx on public.sat_descargas (empresa_id, tipo, created_at desc);
create index if not exists sat_descargas_solicitada_por_idx on public.sat_descargas (solicitada_por);

alter table public.sat_descargas enable row level security;
drop policy if exists frontera_organizacion on public.sat_descargas;
create policy frontera_organizacion on public.sat_descargas as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
drop policy if exists sat_descargas_select on public.sat_descargas;
create policy sat_descargas_select on public.sat_descargas for select
  using ((select public.auth_opera_sat()));
drop policy if exists espectador_sin_datos on public.sat_descargas;
create policy espectador_sin_datos on public.sat_descargas as restrictive for select using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.sat_descargas;
create policy director_general on public.sat_descargas for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
drop trigger if exists solo_consulta on public.sat_descargas;
create trigger solo_consulta before insert or update or delete on public.sat_descargas
  for each statement execute function public.bloquear_solo_consulta();

-- El cron llama a la edge con el secreto propio (mismo patrón que los
-- recordatorios de tareas).
create or replace function public.disparar_descarga_sat()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secreto text;
begin
  select valor into v_secreto from public.config_sistema where clave = 'cron_secret';
  if v_secreto is null then
    raise exception 'cron_secret no está configurado en config_sistema';
  end if;
  perform net.http_post(
    url := 'https://zdqahpzijkkcnfehbggs.supabase.co/functions/v1/sat-descarga-masiva',
    headers := jsonb_build_object('x-cron-secret', v_secreto, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
end;
$$;
revoke all on function public.disparar_descarga_sat() from public, anon, authenticated;

-- Cada hora (minuto 40): verifica, descarga lo listo y, una vez al día por
-- empresa y tipo, pide lo nuevo. Aplicado en producción con cron.schedule.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sat-descarga-masiva-horaria', '40 * * * *', 'select public.disparar_descarga_sat();');
  end if;
end $$;
