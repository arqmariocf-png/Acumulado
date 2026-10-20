-- Respaldo en Dropbox de lo que sirve para cotizar obras (21-oct-2026,
-- Mario: "la biblioteca de archivos en Dropbox como respaldo, para que pueda
-- leerse desde otras secciones de Claude"; luego "lo haría únicamente por
-- ahora de los proyectos a cotizar, para poder hacer más rápido esta
-- dinámica").
--
-- La edge `respaldo-dropbox` (cron cada hora, minuto 25, o el director
-- general con "Respaldar ahora") escribe en la carpeta de Dropbox que se
-- conectó:
--   * Tablas/<tabla>.csv: una vez al día por tabla (hora de México), solo si
--     cambió (hash); Dropbox guarda las versiones anteriores.
--   * LEEME.md: índice para que Claude sepa qué hay en cada archivo.
--   * Archivos/<ruta en Storage>: los archivos del bucket `cargas`, nuevos o
--     cambiados, hasta donde alcance el tiempo de cada corrida.
-- Solo va lo de cotizar: proyectos, sus planos (tabla y archivos `planos/`),
-- presupuesto del cliente, precios unitarios (análisis, partidas, insumos,
-- precios, factores, aprobaciones), cotizaciones y los catálogos de empresas y
-- clientes, de la organización maestra (LOMA). Nada de bancos, CFDI, OC/OV,
-- inventario, RH ni secretos; para agregar algo se suma a la lista de
-- fn_respaldo_tablas y, si son archivos, a archivoRespaldable de la edge.
--
-- La llave de Dropbox (app key, app secret y refresh token) vive en
-- config_sistema (solo service_role). Ya aplicado en producción
-- (respaldo_dropbox y respaldo_dropbox_solo_cotizar).

create table if not exists public.respaldo_dropbox_items (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  tipo text not null check (tipo in ('tabla', 'archivo')),
  nombre text not null,
  version text,
  bytes bigint,
  renglones integer,
  copiado_en timestamptz,
  error text,
  unique (grupo_id, tipo, nombre)
);

create table if not exists public.respaldos_dropbox (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  inicio timestamptz not null default now(),
  fin timestamptz,
  origen text not null default 'cron' check (origen in ('cron', 'manual')),
  tablas integer not null default 0,
  renglones integer not null default 0,
  archivos integer not null default 0,
  bytes bigint not null default 0,
  pendientes integer,
  errores integer not null default 0,
  mensaje text
);
create index if not exists respaldos_dropbox_inicio_idx on public.respaldos_dropbox (grupo_id, inicio desc);

do $$
declare t text;
begin
  foreach t in array array['respaldo_dropbox_items', 'respaldos_dropbox'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists frontera_organizacion on public.%I', t);
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))$p$, t);
    execute format('drop policy if exists espectador_sin_datos on public.%I', t);
    execute format($p$create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()))$p$, t);
    execute format('drop policy if exists director_general on public.%I', t);
    execute format($p$create policy director_general on public.%I for select to authenticated
      using ((select public.auth_admin_global_definer()))$p$, t);
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I
      for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Qué tablas van al respaldo (lista cerrada) y cómo se acotan a la organización maestra.
create or replace function public.fn_respaldo_tablas()
returns table (tabla text, filtro text, llave text, columnas text[], descripcion text)
language sql stable security definer set search_path = public as $$
  select t.table_name::text,
         case when exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = t.table_name and k.column_name = 'grupo_id') then 'grupo'
              when exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = t.table_name and k.column_name = 'empresa_id') then 'empresa'
              else 'todas' end,
         (select u.column_name::text from information_schema.table_constraints tc
            join information_schema.key_column_usage u on u.constraint_name = tc.constraint_name and u.table_schema = tc.table_schema
           where tc.table_schema = 'public' and tc.table_name = t.table_name and tc.constraint_type = 'PRIMARY KEY'
           order by u.ordinal_position limit 1),
         array(select k.column_name::text from information_schema.columns k
                where k.table_schema = 'public' and k.table_name = t.table_name
                  and k.column_name !~* '(secret|token|password|contrasena|vault|avatar|firma_png|p256dh|auth_key)'
                order by k.ordinal_position),
         obj_description(format('public.%I', t.table_name)::regclass, 'pg_class')
    from information_schema.tables t
   where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
     and t.table_name in ('proyectos', 'proyecto_planos', 'proyecto_presupuesto_cliente',
                          'pu_analisis', 'pu_analisis_items', 'pu_insumos', 'pu_insumo_precios',
                          'pu_factores', 'pu_precios_cliente', 'pu_aprobaciones',
                          'cotizaciones_produccion', 'cotizaciones_produccion_lineas',
                          'empresas', 'clientes')
   order by t.table_name;
$$;
revoke all on function public.fn_respaldo_tablas() from public, anon, authenticated;

-- Archivos de planos del bucket `cargas` (la edge vuelve a filtrar con archivoRespaldable).
create or replace function public.fn_respaldo_archivos()
returns table (nombre text, tam bigint, actualizado text)
language sql stable security definer set search_path = public, storage as $$
  select o.name, coalesce((to_jsonb(o)->'metadata'->>'size')::bigint, 0),
         coalesce(to_jsonb(o)->>'updated_at', to_jsonb(o)->>'created_at', '')
    from storage.objects o
   where o.bucket_id = 'cargas' and o.name like 'planos/%'
   order by o.name;
$$;
revoke all on function public.fn_respaldo_archivos() from public, anon, authenticated;

-- Llama a la edge con el secreto del cron.
create or replace function public.disparar_respaldo_dropbox()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secreto text;
begin
  select valor into v_secreto from public.config_sistema where clave = 'cron_secret';
  if v_secreto is null then
    raise exception 'cron_secret no está configurado en config_sistema';
  end if;
  if not exists (select 1 from public.config_sistema where clave = 'dropbox_refresh_token') then
    return;
  end if;
  perform net.http_post(
    url := 'https://zdqahpzijkkcnfehbggs.supabase.co/functions/v1/respaldo-dropbox',
    headers := jsonb_build_object('x-cron-secret', v_secreto, 'Content-Type', 'application/json'),
    body := '{"accion":"respaldar"}'::jsonb,
    timeout_milliseconds := 300000
  );
end;
$$;
revoke all on function public.disparar_respaldo_dropbox() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('respaldo-dropbox-horario', '25 * * * *', 'select public.disparar_respaldo_dropbox();');
  end if;
end $$;
