-- Candado para terminar tareas (5-nov-2026, Mario: "vamos a meter un candado
-- para mover las tarjetas de en proceso a hecho únicamente con autorización
-- de su jefe directo, porque están haciéndolo de manera mañosa para saltarse
-- el proceso"). Mismo molde que la fecha compromiso (28-sep-2026):
--   · Pasar una tarjeta a la ÚLTIMA columna de su tablero (Hecho) lo hace
--     directo el jefe inmediato (`auth_es_jefe_de_tarjeta`: supervisor de la
--     tarjeta, jefe RH de la persona, responsable del proyecto, rol empresa,
--     admin/corporativo/dirección) o quien la asignó a OTRA persona.
--   · Quien la hace (responsable, corresponsable o cualquiera más) pide
--     terminarla con una nota (`fn_tarjeta_terminar_solicitar`); el jefe recibe
--     el aviso y la autoriza o rechaza (`fn_tarjeta_terminar_resolver`), y solo
--     entonces la tarjeta pasa a Hecho. Queda registrado quién la terminó y
--     quién lo autorizó (`tarjetas.terminada_por/_en`, `tarjeta_cierres`).
--   · Los cierres automáticos (Adquira, recurrentes) y los procesos sin usuario
--     siguen igual (triggers anidados y cron pasan).
-- Sacar una tarjeta de Hecho no cambia.

alter table public.tarjetas add column if not exists terminada_en timestamptz;
alter table public.tarjetas add column if not exists terminada_por uuid references public.profiles (id);
alter table public.tarjetas add column if not exists terminada_autorizada_por uuid references public.profiles (id);

create table if not exists public.tarjeta_cierres (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references public.tarjetas (id) on delete cascade,
  columna_origen uuid,
  nota text,
  solicitado_por uuid not null references public.profiles (id),
  solicitante_nombre text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  resuelto_por uuid references public.profiles (id),
  resuelto_por_nombre text,
  resuelto_en timestamptz,
  comentario text,
  created_at timestamptz not null default now()
);
create index if not exists tarjeta_cierres_tarjeta_idx on public.tarjeta_cierres (tarjeta_id, created_at desc);
create index if not exists tarjeta_cierres_pendientes_idx on public.tarjeta_cierres (estado) where estado = 'pendiente';
create index if not exists tarjeta_cierres_solicitado_idx on public.tarjeta_cierres (solicitado_por);
create index if not exists tarjeta_cierres_resuelto_idx on public.tarjeta_cierres (resuelto_por);
alter table public.tarjeta_cierres enable row level security;

drop policy if exists frontera_organizacion on public.tarjeta_cierres;
create policy frontera_organizacion on public.tarjeta_cierres as restrictive for all
  using (exists (select 1 from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = tarjeta_cierres.tarjeta_id and (t.empresa_id is null or t.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))))
  with check (exists (select 1 from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = tarjeta_cierres.tarjeta_id and (t.empresa_id is null or t.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))));
drop policy if exists tarjeta_cierres_select on public.tarjeta_cierres;
create policy tarjeta_cierres_select on public.tarjeta_cierres
  for select using (exists (select 1 from public.tarjetas ta where ta.id = tarjeta_cierres.tarjeta_id));
drop policy if exists espectador_sin_datos on public.tarjeta_cierres;
create policy espectador_sin_datos on public.tarjeta_cierres as restrictive for select using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.tarjeta_cierres;
create policy director_general on public.tarjeta_cierres for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
drop trigger if exists solo_consulta on public.tarjeta_cierres;
create trigger solo_consulta before insert or update on public.tarjeta_cierres for each statement execute function public.bloquear_solo_consulta();
grant select on public.tarjeta_cierres to authenticated;
-- Escritura solo por las RPC (definer) y el trigger.

-- Columnas de cierre del tablero: las que se llaman Hecho / Terminado / Listo /
-- Completado / Finalizado y la última (la que cuentan los KPIs). En "RH ·
-- Actividades" hay Hecho → Archivados: entrar a cualquiera de las dos es
-- terminar; moverse entre ellas es libre.
create or replace function public.fn_tablero_columnas_cierre(p_tablero uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) from (
    select c.id from public.tablero_columnas c where c.tablero_id = p_tablero
       and lower(public.normalizar_texto_sql(c.nombre)) ~ '(hech|termin|listo|complet|finaliz)'
    union all
    (select c.id from public.tablero_columnas c where c.tablero_id = p_tablero order by c.orden desc, c.id limit 1)
  ) x
$$;
revoke all on function public.fn_tablero_columnas_cierre(uuid) from public, anon;
grant execute on function public.fn_tablero_columnas_cierre(uuid) to authenticated, service_role;

-- A dónde se manda la tarea al autorizar que termine: la primera columna de
-- cierre por nombre y, si no hay, la última del tablero.
create or replace function public.fn_tablero_columna_hecha(p_tablero uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.id from public.tablero_columnas c where c.tablero_id = p_tablero
       and lower(public.normalizar_texto_sql(c.nombre)) ~ '(hech|termin|listo|complet|finaliz)' order by c.orden, c.id limit 1),
    (select c.id from public.tablero_columnas c where c.tablero_id = p_tablero order by c.orden desc, c.id limit 1))
$$;
grant execute on function public.fn_tablero_columna_hecha(uuid) to authenticated, service_role;

-- Quién puede dar por terminada una tarjeta directo: su jefe inmediato o
-- quien la asignó a otra persona (no a sí mismo).
create or replace function public.auth_puede_cerrar_tarjeta(p_tarjeta_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_es_jefe_de_tarjeta(p_tarjeta_id)
      or exists (select 1 from public.tarjetas ta
                  where ta.id = p_tarjeta_id and ta.creado_por = auth.uid()
                    and ta.asignado_a is distinct from auth.uid()
                    and not (auth.uid() = any (coalesce(ta.corresponsables, '{}'::uuid[]))))
$$;
grant execute on function public.auth_puede_cerrar_tarjeta(uuid) to authenticated, service_role;

create or replace function public.tarjetas_cierre_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_cierre uuid[];
begin
  if new.columna_id is not distinct from old.columna_id then return new; end if;
  v_cierre := public.fn_tablero_columnas_cierre(new.tablero_id);
  if not (new.columna_id = any (v_cierre)) then
    -- Sale de Hecho (o se mueve entre columnas abiertas): se limpia el cierre.
    if old.columna_id = any (v_cierre) then
      new.terminada_en := null; new.terminada_por := null; new.terminada_autorizada_por := null;
    end if;
    return new;
  end if;
  if old.columna_id = any (v_cierre) then return new; end if;   -- Hecho → Archivados: libre
  -- Entra a Hecho.
  if v_uid is null or pg_trigger_depth() > 1 then            -- cron o cierres automáticos por trigger
    new.terminada_en := now();
    return new;
  end if;
  if current_setting('acumulado.cierre_autorizado', true) = '1' then  -- viene de fn_tarjeta_terminar_resolver
    return new;
  end if;
  if public.auth_puede_cerrar_tarjeta(old.id) then
    new.terminada_en := now();
    new.terminada_por := v_uid;
    new.terminada_autorizada_por := v_uid;
    return new;
  end if;
  raise exception 'Dar por terminada una tarea requiere autorización de tu jefe inmediato: pide terminarla desde la tarjeta y él la pasa a Hecho.'
    using errcode = 'P0001';
end;
$$;
drop trigger if exists tarjetas_cierre_guard on public.tarjetas;
create trigger tarjetas_cierre_guard before update of columna_id on public.tarjetas
  for each row execute function public.tarjetas_cierre_guard();

-- A quién se le avisa: supervisor de la tarjeta, jefe RH del responsable,
-- quien la asignó y responsable del proyecto; si no hay nadie, dirección.
create or replace function public.fn_tarjeta_jefes(p_tarjeta_id uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  with ta as (select ta.*, t.proyecto_id, t.empresa_id from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = p_tarjeta_id),
  j as (
    select ta.supervisor_id as id from ta
    union select pe.supervisor_profile_id from ta join public.personal pe on pe.profile_id = ta.asignado_a and pe.activo and pe.fecha_baja is null
    union select ta.creado_por from ta
    union select p.responsable_id from ta join public.proyectos p on p.id = ta.proyecto_id
  )
  select coalesce(array_agg(distinct j.id) filter (where j.id is not null), '{}'::uuid[]) from j
$$;
revoke all on function public.fn_tarjeta_jefes(uuid) from public, anon, authenticated;

create or replace function public.fn_tarjeta_terminar_solicitar(p_tarjeta_id uuid, p_nota text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_yo public.profiles%rowtype; ta public.tarjetas%rowtype; t public.tableros%rowtype;
  v_hecha uuid; v_id uuid; v_avisar uuid[]; v_grupo uuid;
begin
  select * into v_yo from public.profiles where id = v_uid;
  if v_yo.id is null or v_yo.rol = 'pendiente' or coalesce(v_yo.espectador, false) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into ta from public.tarjetas where id = p_tarjeta_id;
  select * into t from public.tableros where id = ta.tablero_id;
  if ta.id is null or not public.tablero_visible(t.empresa_id) then raise exception 'Tarjeta no encontrada o sin acceso' using errcode = '42501'; end if;
  if ta.eliminada_en is not null or ta.archivada then raise exception 'La tarjeta está archivada o eliminada.'; end if;
  if ta.columna_id = any (public.fn_tablero_columnas_cierre(ta.tablero_id)) then raise exception 'La tarea ya está en Hecho.'; end if;
  if exists (select 1 from public.tarjeta_cierres c where c.tarjeta_id = p_tarjeta_id and c.estado = 'pendiente') then
    raise exception 'Ya hay una solicitud pendiente para terminar esta tarea; espera a que tu jefe la resuelva.';
  end if;
  insert into public.tarjeta_cierres (tarjeta_id, columna_origen, nota, solicitado_por, solicitante_nombre)
  values (p_tarjeta_id, ta.columna_id, nullif(btrim(coalesce(p_nota, '')), ''), v_uid, v_yo.nombre) returning id into v_id;
  insert into public.tarjeta_actividad (tarjeta_id, tipo, detalle, actor_id)
  values (p_tarjeta_id, 'editada', jsonb_build_object('accion', 'cierre_solicitud', 'nota', nullif(btrim(coalesce(p_nota, '')), '')), v_uid);
  -- Aviso a los jefes (sin quien pide); si no hay ninguno, a dirección.
  v_avisar := array(select u from unnest(public.fn_tarjeta_jefes(p_tarjeta_id)) u where u <> v_uid);
  if coalesce(array_length(v_avisar, 1), 0) = 0 then
    v_grupo := coalesce((select e.grupo_id from public.empresas e where e.id = t.empresa_id), v_yo.grupo_id);
    v_avisar := public.fn_direccion_de(v_grupo);
  end if;
  if coalesce(array_length(v_avisar, 1), 0) > 0 then
    perform public.fn_push_aviso(v_avisar, 'Tarea por autorizar como terminada',
      v_yo.nombre || ' terminó «' || left(ta.titulo, 60) || '»' || case when nullif(btrim(coalesce(p_nota, '')), '') is not null then ' · ' || left(btrim(p_nota), 80) else '' end || ' · autorízala o recházala',
      '/tareas/' || ta.tablero_id || '?tarjeta=' || ta.id);
  end if;
  return v_id;
end;
$$;

create or replace function public.fn_tarjeta_terminar_resolver(p_solicitud_id uuid, p_aprobar boolean, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_yo public.profiles%rowtype; s public.tarjeta_cierres%rowtype; ta public.tarjetas%rowtype; v_hecha uuid; v_orden int; v_de text; v_a text;
begin
  select * into v_yo from public.profiles where id = v_uid;
  if v_yo.id is null then raise exception 'No autenticado'; end if;
  select * into s from public.tarjeta_cierres where id = p_solicitud_id for update;
  if s.id is null then raise exception 'Solicitud no encontrada'; end if;
  if s.estado <> 'pendiente' then raise exception 'La solicitud ya fue %', case s.estado when 'aprobado' then 'autorizada' else 'rechazada' end; end if;
  if not public.auth_puede_cerrar_tarjeta(s.tarjeta_id) then
    raise exception 'Solo el jefe inmediato (supervisor de la tarjeta, jefe de la persona, responsable del proyecto, quien la asignó o dirección) puede autorizar que se dé por terminada' using errcode = '42501';
  end if;
  if s.solicitado_por = v_uid and v_yo.rol not in ('admin', 'corporativo', 'direccion') then
    raise exception 'No puedes autorizar tu propia solicitud' using errcode = '42501';
  end if;
  select * into ta from public.tarjetas where id = s.tarjeta_id;
  update public.tarjeta_cierres
     set estado = case when p_aprobar then 'aprobado' else 'rechazado' end, resuelto_por = v_uid, resuelto_por_nombre = v_yo.nombre, resuelto_en = now(),
         comentario = nullif(btrim(coalesce(p_comentario, '')), '')
   where id = p_solicitud_id;
  if p_aprobar then
    v_hecha := public.fn_tablero_columna_hecha(ta.tablero_id);
    if not (ta.columna_id = any (public.fn_tablero_columnas_cierre(ta.tablero_id))) then
      select count(*) into v_orden from public.tarjetas where tablero_id = ta.tablero_id and columna_id = v_hecha;
      select c.nombre into v_de from public.tablero_columnas c where c.id = ta.columna_id;
      select c.nombre into v_a from public.tablero_columnas c where c.id = v_hecha;
      perform set_config('acumulado.cierre_autorizado', '1', true);
      update public.tarjetas set columna_id = v_hecha, orden = v_orden, terminada_en = now(), terminada_por = s.solicitado_por, terminada_autorizada_por = v_uid where id = ta.id;
      perform set_config('acumulado.cierre_autorizado', '0', true);
      insert into public.tarjeta_actividad (tarjeta_id, tipo, detalle, actor_id)
      values (ta.id, 'movida', jsonb_build_object('de', v_de, 'a', v_a, 'autorizada', true, 'terminada_por', s.solicitante_nombre, 'comentario', nullif(btrim(coalesce(p_comentario, '')), '')), v_uid);
    end if;
  else
    insert into public.tarjeta_actividad (tarjeta_id, tipo, detalle, actor_id)
    values (ta.id, 'editada', jsonb_build_object('accion', 'cierre_rechazado', 'comentario', nullif(btrim(coalesce(p_comentario, '')), '')), v_uid);
  end if;
  if s.solicitado_por <> v_uid then
    perform public.fn_push_aviso(array[s.solicitado_por],
      case when p_aprobar then 'Tarea autorizada como terminada' else 'Tarea no autorizada como terminada' end,
      '«' || left(ta.titulo, 60) || '» · ' || v_yo.nombre || case when nullif(btrim(coalesce(p_comentario, '')), '') is not null then ': ' || left(btrim(p_comentario), 100) else '' end,
      '/tareas/' || ta.tablero_id || '?tarjeta=' || ta.id);
  end if;
end;
$$;

-- Lo que la persona tiene por resolver (como jefe) y lo que ella pidió y espera.
create or replace function public.fn_tarjeta_cierres_pendientes()
returns table (id uuid, tarjeta_id uuid, tablero_id uuid, tablero text, titulo text, nota text, solicitado_por uuid, solicitante_nombre text,
               created_at timestamptz, puedo_resolver boolean, es_mia boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.tarjeta_id, ta.tablero_id, t.nombre, ta.titulo, c.nota, c.solicitado_por, c.solicitante_nombre, c.created_at,
         public.auth_puede_cerrar_tarjeta(ta.id) and c.solicitado_por <> auth.uid(),
         c.solicitado_por = auth.uid()
    from public.tarjeta_cierres c
    join public.tarjetas ta on ta.id = c.tarjeta_id
    join public.tableros t on t.id = ta.tablero_id
   where c.estado = 'pendiente' and ta.eliminada_en is null
     and (t.empresa_id is null or t.empresa_id = any (public.auth_empresas_organizacion()))
     and (c.solicitado_por = auth.uid() or public.auth_puede_cerrar_tarjeta(ta.id))
   order by c.created_at
$$;

revoke all on function public.fn_tarjeta_terminar_solicitar(uuid, text) from public;
revoke all on function public.fn_tarjeta_terminar_resolver(uuid, boolean, text) from public;
revoke all on function public.fn_tarjeta_cierres_pendientes() from public;
grant execute on function public.fn_tarjeta_terminar_solicitar(uuid, text) to authenticated, service_role;
grant execute on function public.fn_tarjeta_terminar_resolver(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.fn_tarjeta_cierres_pendientes() to authenticated, service_role;
