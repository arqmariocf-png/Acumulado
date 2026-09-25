-- `kpis_organigrama` (20260925090000) nació sin organización. No es un
-- catálogo de plataforma: guarda QUÉ indicadores ve cada área y con qué
-- umbrales, que es configuración de negocio -- cada cliente querrá los suyos,
-- y sus umbrales no le importan a nadie más. Tal como estaba, el admin de una
-- organización cliente veía y editaba la configuración de Loma.
--
-- Se arregla igual que reglas_clasificacion: grupo_id con trigger que lo pone
-- solo, unicidad por organización (dos organizaciones pueden configurar el
-- mismo indicador en la misma área) y la restrictiva de frontera.

alter table public.kpis_organigrama add column grupo_id uuid references public.grupos (id);
update public.kpis_organigrama set grupo_id = (select id from public.grupos where es_maestro);
alter table public.kpis_organigrama alter column grupo_id set not null;

alter table public.kpis_organigrama drop constraint kpis_organigrama_area_indicador_key;
alter table public.kpis_organigrama add constraint kpis_organigrama_grupo_area_indicador_key
  unique (grupo_id, area, indicador);

create index kpis_organigrama_grupo_idx on public.kpis_organigrama (grupo_id);

create trigger kpis_organigrama_set_grupo before insert on public.kpis_organigrama
  for each row execute function public.set_grupo_id_del_usuario();

create policy frontera_organizacion on public.kpis_organigrama as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
