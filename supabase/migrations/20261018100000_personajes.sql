-- Personajes (18-oct-2026, Mario: "ponernos a todos un avatar; que tengan que
-- tomarse su foto de frente para generarlo; una especie de NPC de videojuego
-- con skills y trabajos pendientes, muy dinámico, de lo que deben avanzar
-- durante el día").
--
--   * personajes: un avatar por persona. La foto NUNCA se guarda: el
--     navegador la vuelve pixel-art (lib/personaje.ts) y aquí solo queda el
--     PNG chico (data URL, ~40×40). Lo ve su organización; lo cambia solo
--     su dueño.
--   * fn_personajes_stats(grupo, persona): experiencia y habilidades con lo
--     que ya hay en el sistema: tareas terminadas (última columna de su
--     tablero), días con entrada en el checador, tarjetas creadas y
--     comentarios. Interna (revocada).
--   * fn_mi_personaje(): la hoja del personaje + las misiones del día
--     (tareas vencidas o que vencen hoy, marcas del checador de hoy, lo que
--     ya terminó hoy).
--   * fn_equipo_personajes(): el equipo de la organización con avatar,
--     experiencia y avance de hoy (cuántas misiones lleva / tiene).
-- Ya aplicado en producción.

create table if not exists public.personajes (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  grupo_id uuid not null references public.grupos (id),
  avatar text not null check (avatar like 'data:image/png;base64,%' and length(avatar) <= 60000),
  fondo text,
  titulo text check (titulo is null or length(titulo) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists personajes_grupo_idx on public.personajes (grupo_id);

create or replace function public.personajes_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select grupo_id into new.grupo_id from public.profiles where id = new.profile_id;
  if new.grupo_id is null then raise exception 'La cuenta no tiene organización.'; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists personajes_antes on public.personajes;
create trigger personajes_antes before insert or update on public.personajes
  for each row execute function public.personajes_antes();

alter table public.personajes enable row level security;
drop policy if exists frontera_organizacion on public.personajes;
create policy frontera_organizacion on public.personajes as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
drop policy if exists espectador_sin_datos on public.personajes;
create policy espectador_sin_datos on public.personajes as restrictive for select to authenticated
  using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.personajes;
create policy director_general on public.personajes for all to authenticated
  using ((select public.auth_admin_global_definer()))
  with check ((select public.auth_admin_global_definer()));
drop policy if exists personajes_ver on public.personajes;
create policy personajes_ver on public.personajes for select to authenticated
  using ((select public.auth_rol_definer()) <> 'pendiente');
drop policy if exists personajes_propio on public.personajes;
create policy personajes_propio on public.personajes for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()) and (select public.auth_rol_definer()) <> 'pendiente');
drop trigger if exists solo_consulta on public.personajes;
create trigger solo_consulta before insert or update or delete on public.personajes
  for each statement execute function public.bloquear_solo_consulta();
grant select, insert, update, delete on public.personajes to authenticated;

-- Experiencia y habilidades de las personas de una organización (o de una).
create or replace function public.fn_personajes_stats(p_grupo uuid, p_profile uuid default null)
returns table (
  profile_id uuid,
  tareas_terminadas integer,
  dias_checados integer,
  tarjetas_creadas integer,
  comentarios integer,
  xp integer,
  cumplimiento_30 integer,
  constancia_30 integer,
  iniciativa_30 integer,
  colaboracion_30 integer,
  racha integer,
  checa boolean,
  hechas_hoy integer,
  pendientes_hoy integer,
  vencidas integer
)
language sql stable security definer set search_path = public as $$
  with hoy as (select (now() at time zone 'America/Mexico_City')::date as d),
  gente as (
    select p.id from public.profiles p
     where p.grupo_id = p_grupo and p.activo and not p.espectador and p.rol <> 'pendiente'
       and (p_profile is null or p.id = p_profile)
  ),
  ultima as (select tablero_id, max(orden) as orden from public.tablero_columnas group by tablero_id),
  tarjetas_vivas as (
    select t.id, t.asignado_a, t.corresponsables, t.creado_por, t.fecha_limite, t.updated_at,
           (c.orden = u.orden) as terminada
      from public.tarjetas t
      join public.tableros tb on tb.id = t.tablero_id and not coalesce(tb.archivado, false)
      join public.tablero_columnas c on c.id = t.columna_id
      join ultima u on u.tablero_id = t.tablero_id
     where not coalesce(t.archivada, false) and t.eliminada_en is null
  ),
  mias as (
    select g.id as profile_id, tv.*
      from gente g join tarjetas_vivas tv on tv.asignado_a = g.id or g.id = any (coalesce(tv.corresponsables, '{}'))
  ),
  t_stats as (
    select m.profile_id,
           count(*) filter (where m.terminada) as terminadas,
           count(*) filter (where m.fecha_limite between (select d from hoy) - 30 and (select d from hoy)) as con_fecha_30,
           count(*) filter (where m.terminada and m.fecha_limite between (select d from hoy) - 30 and (select d from hoy)) as cumplidas_30,
           count(*) filter (where m.terminada and (m.updated_at at time zone 'America/Mexico_City')::date = (select d from hoy)) as hechas_hoy,
           count(*) filter (where not m.terminada and m.fecha_limite <= (select d from hoy)) as pendientes_hoy,
           count(*) filter (where not m.terminada and m.fecha_limite < (select d from hoy)) as vencidas
      from mias m group by m.profile_id
  ),
  creadas as (
    select t.creado_por as profile_id, count(*) as total,
           count(*) filter (where t.created_at >= now() - interval '30 days') as ult30
      from public.tarjetas t join gente g on g.id = t.creado_por
     where t.eliminada_en is null group by t.creado_por
  ),
  coms as (
    select c.autor_id as profile_id, count(*) as total,
           count(*) filter (where c.created_at >= now() - interval '30 days') as ult30
      from public.tarjeta_comentarios c join gente g on g.id = c.autor_id group by c.autor_id
  ),
  dias as (
    select distinct r.profile_id, (coalesce(r.marcada_en, r.created_at) at time zone 'America/Mexico_City')::date as d
      from public.checador_registros r join gente g on g.id = r.profile_id
     where r.tipo = 'entrada' and r.anulada_en is null
  ),
  d_stats as (
    select dd.profile_id, count(*) as total,
           count(*) filter (where dd.d > (select d from hoy) - 30) as ult30
      from dias dd group by dd.profile_id
  ),
  habiles_30 as (
    select count(*)::numeric as n from generate_series((select d from hoy) - 29, (select d from hoy), interval '1 day') s
     where extract(isodow from s) < 7
  ),
  rachas as (
    -- Días hábiles seguidos con entrada, contando hacia atrás desde hoy (si
    -- hoy aún no checa, desde ayer). El domingo no rompe la racha.
    select g.id as profile_id,
           (select count(*) from (
              select s::date as d,
                     bool_and(exists (select 1 from dias dd where dd.profile_id = g.id and dd.d = s::date)) over (order by s desc rows between unbounded preceding and current row) as seguido
                from generate_series(
                       (select d from hoy) - case when exists (select 1 from dias dd where dd.profile_id = g.id and dd.d = (select d from hoy)) then 0 else 1 end,
                       (select d from hoy) - 120, interval '-1 day') s
               where extract(isodow from s) < 7
            ) x where x.seguido) as racha
      from gente g
  )
  select g.id,
         coalesce(ts.terminadas, 0)::int,
         coalesce(ds.total, 0)::int,
         coalesce(cr.total, 0)::int,
         coalesce(cm.total, 0)::int,
         (coalesce(ts.terminadas, 0) * 10 + coalesce(ds.total, 0) * 3 + coalesce(cr.total, 0) * 2 + coalesce(cm.total, 0))::int,
         case when coalesce(ts.con_fecha_30, 0) = 0 then null else round(100.0 * ts.cumplidas_30 / ts.con_fecha_30)::int end,
         case when coalesce(ds.total, 0) = 0 then null else least(100, round(100.0 * ds.ult30 / (select n from habiles_30)))::int end,
         least(100, coalesce(cr.ult30, 0) * 10)::int,
         least(100, coalesce(cm.ult30, 0) * 5)::int,
         coalesce(ra.racha, 0)::int,
         coalesce(ds.total, 0) > 0,
         coalesce(ts.hechas_hoy, 0)::int,
         coalesce(ts.pendientes_hoy, 0)::int,
         coalesce(ts.vencidas, 0)::int
    from gente g
    left join t_stats ts on ts.profile_id = g.id
    left join creadas cr on cr.profile_id = g.id
    left join coms cm on cm.profile_id = g.id
    left join d_stats ds on ds.profile_id = g.id
    left join rachas ra on ra.profile_id = g.id
$$;
revoke all on function public.fn_personajes_stats(uuid, uuid) from public, anon, authenticated;

-- La hoja de mi personaje y mis misiones de hoy.
create or replace function public.fn_mi_personaje()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_yo uuid := auth.uid();
  v_grupo uuid;
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_stats jsonb;
  v_misiones jsonb;
  v_hechas jsonb;
  v_marcas jsonb;
  v_proximas int;
  v_sin_fecha int;
begin
  select grupo_id into v_grupo from public.profiles where id = v_yo and activo and not espectador and rol <> 'pendiente';
  if v_grupo is null then return null; end if;

  select to_jsonb(s) into v_stats from public.fn_personajes_stats(v_grupo, v_yo) s;

  with ultima as (select tablero_id, max(orden) as orden from public.tablero_columnas group by tablero_id),
  mias as (
    select t.id, t.titulo, t.tablero_id, tb.nombre as tablero, t.fecha_limite, t.updated_at, c.nombre as columna,
           (c.orden = u.orden) as terminada,
           case when t.asignado_a = v_yo then 'responsable' else 'corresponsable' end as papel
      from public.tarjetas t
      join public.tableros tb on tb.id = t.tablero_id and not coalesce(tb.archivado, false)
      join public.tablero_columnas c on c.id = t.columna_id
      join ultima u on u.tablero_id = t.tablero_id
     where not coalesce(t.archivada, false) and t.eliminada_en is null
       and (t.asignado_a = v_yo or v_yo = any (coalesce(t.corresponsables, '{}')))
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'titulo', m.titulo, 'tablero_id', m.tablero_id, 'tablero', m.tablero,
                                                  'fecha_limite', m.fecha_limite, 'columna', m.columna, 'papel', m.papel,
                                                  'vencida', m.fecha_limite < v_hoy) order by m.fecha_limite, m.titulo)
                from (select * from mias where not terminada and fecha_limite <= v_hoy order by fecha_limite limit 20) m), '[]'),
    coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'titulo', m.titulo, 'tablero_id', m.tablero_id) order by m.updated_at desc)
                from (select * from mias where terminada and (updated_at at time zone 'America/Mexico_City')::date = v_hoy order by updated_at desc limit 10) m), '[]'),
    (select count(*) from mias where not terminada and fecha_limite > v_hoy and fecha_limite <= v_hoy + 7),
    (select count(*) from mias where not terminada and fecha_limite is null)
  into v_misiones, v_hechas, v_proximas, v_sin_fecha;

  select coalesce(jsonb_agg(distinct r.tipo), '[]') into v_marcas
    from public.checador_registros r
   where r.profile_id = v_yo and r.anulada_en is null
     and (coalesce(r.marcada_en, r.created_at) at time zone 'America/Mexico_City')::date = v_hoy;

  return jsonb_build_object(
    'hoy', v_hoy,
    'stats', v_stats,
    'misiones', v_misiones,
    'hechas_hoy', v_hechas,
    'proximas_7', v_proximas,
    'sin_fecha', v_sin_fecha,
    'marcas_hoy', v_marcas);
end;
$$;
grant execute on function public.fn_mi_personaje() to authenticated;

-- El equipo: avatar, nivel y avance de hoy de la gente de mi organización.
create or replace function public.fn_equipo_personajes()
returns table (profile_id uuid, nombre text, rol text, avatar text, titulo text, xp integer, racha integer,
               hechas_hoy integer, pendientes_hoy integer, vencidas integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.rol::text, pj.avatar, pj.titulo, s.xp, s.racha, s.hechas_hoy, s.pendientes_hoy, s.vencidas
    from public.profiles yo
    join public.profiles p on p.grupo_id = yo.grupo_id
    join public.fn_personajes_stats(yo.grupo_id) s on s.profile_id = p.id
    left join public.personajes pj on pj.profile_id = p.id
   where yo.id = auth.uid() and yo.activo and not yo.espectador and yo.rol <> 'pendiente'
   order by s.xp desc, p.nombre
$$;
grant execute on function public.fn_equipo_personajes() to authenticated;
