-- Histórico de la presentación de RH para el director general (5-nov-2026,
-- Mario: "guarda el histórico de la presentación de RH para que se vea la
-- evolución conforme pasa el tiempo"). Cada vez que el director general
-- genera la presentación se guarda la foto de los datos (lo que devolvieron
-- fn_reporte_rh_director y fn_reporte_rh_tiempos sin el detalle por día) y
-- los indicadores clave; con eso la presentación trae la lámina "Evolución"
-- y cualquier reporte guardado se vuelve a abrir tal como salió.
-- Una foto por organización, periodo (días) y fecha de corte: generar dos
-- veces el mismo día la reemplaza. Solo el admin de la organización maestra
-- la lee y la escribe (es el único que ve el reporte).

create table if not exists public.rh_reportes_historico (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos(id),
  desde date not null,
  hasta date not null,
  dias integer not null,
  -- Indicadores clave para la evolución (plantilla, asistencia, tareas, nómina…).
  indicadores jsonb not null,
  -- Lo que devolvió fn_reporte_rh_director.
  datos jsonb not null,
  -- fn_reporte_rh_tiempos sin `detalle` (por persona y por día).
  tiempos jsonb,
  generado_por uuid references auth.users(id) default auth.uid(),
  generado_por_nombre text,
  generado_en timestamptz not null default now(),
  unique (grupo_id, dias, hasta)
);
create index if not exists rh_reportes_historico_grupo_idx on public.rh_reportes_historico (grupo_id, hasta desc);

create or replace function public.rh_reportes_historico_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.grupo_id is null then new.grupo_id := public.auth_grupo_id(); end if;
  if new.generado_por_nombre is null and new.generado_por is not null then
    select nombre into new.generado_por_nombre from public.profiles where id = new.generado_por;
  end if;
  return new;
end;
$$;
create or replace trigger rh_reportes_historico_antes before insert or update on public.rh_reportes_historico
  for each row execute function public.rh_reportes_historico_antes();

alter table public.rh_reportes_historico enable row level security;
create policy frontera_organizacion on public.rh_reportes_historico as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
create policy rh_reportes_historico_select on public.rh_reportes_historico for select
  using ((select public.auth_admin_global_definer()));
create policy rh_reportes_historico_insert on public.rh_reportes_historico for insert
  with check ((select public.auth_admin_global_definer()));
create policy rh_reportes_historico_update on public.rh_reportes_historico for update
  using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
create policy espectador_sin_datos on public.rh_reportes_historico as restrictive for select using (not (select public.auth_es_espectador()));
create policy director_general on public.rh_reportes_historico for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
create trigger solo_consulta before insert or update on public.rh_reportes_historico for each statement execute function public.bloquear_solo_consulta();
grant select, insert, update on public.rh_reportes_historico to authenticated;
