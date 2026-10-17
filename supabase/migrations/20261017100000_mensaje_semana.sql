-- Mensaje de la semana de Mario (17-oct-2026, Mario: "programados, pero el
-- mensaje mándame primero a mí para escribirles el agradecimiento de la
-- semana; genérame frases de este tipo y las elijo semana con semana").
--
--   * mensajes_semana: un mensaje por organización y sábado (texto que Mario
--     elige o escribe, cuándo se programó, cuándo salió y a cuántos).
--   * El viernes 17:00 y el sábado 10:00 (hora de México) le llega a Mario un
--     aviso para elegirlo si todavía no lo hace; el sábado 13:00 sale por
--     notificación a todas las personas de la organización que tienen push
--     (edge `push-mensaje-semana`, con x-cron-secret). México no tiene
--     horario de verano desde 2022: UTC-6 fijo.
-- Solo el director general (admin de la organización maestra) lo ve y lo
-- programa. Ya aplicado en producción.

create table if not exists public.mensajes_semana (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  fecha date not null check (extract(isodow from fecha) = 6),
  titulo text not null default 'Mensaje de Mario',
  texto text not null check (btrim(texto) <> ''),
  programado_por uuid references public.profiles (id) default auth.uid(),
  programado_en timestamptz not null default now(),
  enviado_en timestamptz,
  enviados integer,
  fallidos integer,
  unique (grupo_id, fecha)
);
create index if not exists mensajes_semana_programado_idx on public.mensajes_semana (programado_por);

alter table public.mensajes_semana enable row level security;
drop policy if exists frontera_organizacion on public.mensajes_semana;
create policy frontera_organizacion on public.mensajes_semana as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
drop policy if exists espectador_sin_datos on public.mensajes_semana;
create policy espectador_sin_datos on public.mensajes_semana as restrictive for select to authenticated
  using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.mensajes_semana;
create policy director_general on public.mensajes_semana for all to authenticated
  using ((select public.auth_admin_global_definer()))
  with check ((select public.auth_admin_global_definer()));
drop trigger if exists solo_consulta on public.mensajes_semana;
create trigger solo_consulta before insert or update or delete on public.mensajes_semana
  for each statement execute function public.bloquear_solo_consulta();
grant select, insert, update, delete on public.mensajes_semana to authenticated;

-- Programa (o corrige) el mensaje de un sábado mientras no haya salido.
create or replace function public.fn_mensaje_semana_programar(p_fecha date, p_texto text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_grupo uuid;
begin
  if not public.auth_admin_global() then raise exception 'Solo el director general programa el mensaje.' using errcode = '42501'; end if;
  if extract(isodow from p_fecha) <> 6 then raise exception 'El mensaje sale los sábados.'; end if;
  if nullif(btrim(p_texto), '') is null then raise exception 'Escribe el mensaje.'; end if;
  if length(p_texto) > 300 then raise exception 'Máximo 300 caracteres (la notificación los recorta).'; end if;
  if p_fecha < (now() at time zone 'America/Mexico_City')::date then raise exception 'Ese sábado ya pasó.'; end if;
  v_grupo := public.auth_grupo_id();
  insert into public.mensajes_semana (grupo_id, fecha, texto, programado_por, programado_en)
  values (v_grupo, p_fecha, btrim(p_texto), auth.uid(), now())
  on conflict (grupo_id, fecha) do update
    set texto = excluded.texto, programado_por = excluded.programado_por, programado_en = now()
    where mensajes_semana.enviado_en is null
  returning id into v_id;
  if v_id is null then raise exception 'El mensaje de ese sábado ya se envió.'; end if;
  return v_id;
end;
$$;
revoke all on function public.fn_mensaje_semana_programar(date, text) from public, anon;
grant execute on function public.fn_mensaje_semana_programar(date, text) to authenticated;

-- La llama pg_cron: modo 'recordatorio' (aviso a Mario si falta elegir) o
-- 'enviar' (sale a todos).
create or replace function public.disparar_mensaje_semana(p_modo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_secreto text;
begin
  select valor into v_secreto from public.config_sistema where clave = 'cron_secret';
  if v_secreto is null then raise exception 'cron_secret no está configurado en config_sistema'; end if;
  perform net.http_post(
    url := 'https://zdqahpzijkkcnfehbggs.supabase.co/functions/v1/push-mensaje-semana',
    headers := jsonb_build_object('x-cron-secret', v_secreto, 'Content-Type', 'application/json'),
    body := jsonb_build_object('modo', p_modo),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function public.disparar_mensaje_semana(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mensaje-semana-recordatorio-viernes', '0 23 * * 5', $c$select public.disparar_mensaje_semana('recordatorio');$c$);
    perform cron.schedule('mensaje-semana-recordatorio-sabado', '0 16 * * 6', $c$select public.disparar_mensaje_semana('recordatorio');$c$);
    perform cron.schedule('mensaje-semana-envio-sabado', '0 19 * * 6', $c$select public.disparar_mensaje_semana('enviar');$c$);
  end if;
end $$;

-- Cuántas personas de la organización recibirían hoy el mensaje (con push).
create or replace function public.fn_mensaje_semana_destinatarios()
returns integer language sql stable security definer set search_path = public as $$
  select case when public.auth_admin_global() then (
    select count(distinct s.profile_id)::integer
      from public.push_subscripciones s
      join public.profiles p on p.id = s.profile_id
     where p.grupo_id = public.auth_grupo_id() and p.activo and not p.espectador and p.rol <> 'pendiente')
  end
$$;
revoke all on function public.fn_mensaje_semana_destinatarios() from public, anon;
grant execute on function public.fn_mensaje_semana_destinatarios() to authenticated;
