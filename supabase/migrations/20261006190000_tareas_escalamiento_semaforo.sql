-- Escalamiento del semáforo de tareas (Mario, 6-oct-2026: "cuando la alerta
-- llegue a amarillo debe notificarse al jefe inmediato, y una vez llegando
-- el vencimiento o el rojo, una notificación a RH").
--
-- Mismo semáforo que la pantalla (pages/tareas/semaforo.ts): amarillo = vence
-- hoy o en los próximos 3 días; rojo = ya venció. Solo tareas sin terminar
-- (fuera de la última columna de su tablero), no archivadas ni eliminadas.
-- - Amarillo → jefe inmediato: el supervisor de la tarjeta; si no tiene, el
--   jefe de RH de la persona (personal.supervisor_profile_id); si tampoco,
--   quien asignó la tarea.
-- - Rojo → RH de la organización (rol rh activo).
-- Una sola vez por tarjeta, nivel y fecha límite (si se mueve la fecha y
-- vuelve a ponerse amarilla o roja, se avisa de nuevo): tarjeta_alertas.
-- Lo manda push-enviar-recordatorios (cron 14:00 UTC = 8:00 Puebla), que
-- llama fn_tarjetas_escalamientos() con la service_role.
--
-- Ya aplicado en producción.

create table if not exists public.tarjeta_alertas (
  tarjeta_id uuid not null references public.tarjetas(id) on delete cascade,
  nivel text not null check (nivel in ('amarillo', 'rojo')),
  fecha_limite date not null,
  destinatarios uuid[] not null default '{}',
  enviada_en timestamptz not null default now(),
  primary key (tarjeta_id, nivel, fecha_limite)
);

alter table public.tarjeta_alertas enable row level security;
drop policy if exists frontera_organizacion on public.tarjeta_alertas;
create policy frontera_organizacion on public.tarjeta_alertas as restrictive for all
  using (exists (select 1 from public.tarjetas t where t.id = tarjeta_id))
  with check (exists (select 1 from public.tarjetas t where t.id = tarjeta_id));
drop policy if exists tarjeta_alertas_select on public.tarjeta_alertas;
create policy tarjeta_alertas_select on public.tarjeta_alertas for select
  using ((select public.auth_rol_definer()) = any (array['admin', 'rh', 'direccion']::app_rol[])
         or (select auth.uid()) = any (destinatarios));
drop policy if exists espectador_sin_datos on public.tarjeta_alertas;
create policy espectador_sin_datos on public.tarjeta_alertas as restrictive for select using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.tarjeta_alertas;
create policy director_general on public.tarjeta_alertas for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
drop trigger if exists solo_consulta on public.tarjeta_alertas;
create trigger solo_consulta before insert or update or delete on public.tarjeta_alertas
  for each statement execute function public.bloquear_solo_consulta();

create or replace function public.fn_tarjetas_escalamientos()
returns table (tarjeta_id uuid, tablero_id uuid, titulo text, nivel text, fecha_limite date, responsable text, destinatarios uuid[])
language sql volatile security definer set search_path = public as $$
  with hoy as (select (now() at time zone 'America/Mexico_City')::date as d),
  pendientes as (
    select tj.id, tj.tablero_id, tj.titulo, tj.fecha_limite, tj.asignado_a, tj.supervisor_id, tj.creado_por, pr.grupo_id,
           case when tj.fecha_limite < (select d from hoy) then 'rojo' else 'amarillo' end as nivel
    from public.tarjetas tj
    join public.tableros tb on tb.id = tj.tablero_id and not tb.archivado
    join public.profiles pr on pr.id = tj.creado_por
    where not tj.archivada and tj.eliminada_en is null
      and tj.fecha_limite is not null
      and tj.fecha_limite <= (select d from hoy) + 3
      and tj.columna_id <> (select c.id from public.tablero_columnas c where c.tablero_id = tj.tablero_id order by c.orden desc limit 1)
  ),
  con_destino as (
    select p.*,
           case when p.nivel = 'amarillo' then
             array_remove(array[coalesce(
               p.supervisor_id,
               (select pe.supervisor_profile_id from public.personal pe where pe.profile_id = p.asignado_a and pe.activo and pe.supervisor_profile_id is not null limit 1),
               p.creado_por)], null)
           else
             coalesce((select array_agg(r.id) from public.profiles r where r.rol = 'rh' and r.activo and r.grupo_id = p.grupo_id), '{}')
           end as dest
    from pendientes p
  ),
  nuevas as (
    insert into public.tarjeta_alertas (tarjeta_id, nivel, fecha_limite, destinatarios)
    select c.id, c.nivel, c.fecha_limite, c.dest from con_destino c
    where cardinality(c.dest) > 0
    on conflict do nothing
    returning tarjeta_alertas.tarjeta_id, tarjeta_alertas.nivel
  )
  select c.id, c.tablero_id, c.titulo, c.nivel, c.fecha_limite,
         (select pr.nombre from public.profiles pr where pr.id = c.asignado_a), c.dest
  from con_destino c
  join nuevas n on n.tarjeta_id = c.id and n.nivel = c.nivel
$$;
revoke all on function public.fn_tarjetas_escalamientos() from public, anon, authenticated;
grant execute on function public.fn_tarjetas_escalamientos() to service_role;
