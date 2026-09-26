-- Tareas con más de un responsable (Mario, 26-sep-2026): además del
-- responsable principal (`asignado_a`, el que cuenta en cumplimiento y
-- recibe el recordatorio) una tarjeta lleva un supervisor a cargo y una
-- lista de corresponsables. Sin tabla nueva: van en la misma fila, así la
-- frontera de organización y las policies de `tarjetas` ya los cubren.
-- Ya aplicado en producción (26-sep-2026).

alter table public.tarjetas
  add column if not exists supervisor_id uuid references public.profiles (id),
  add column if not exists corresponsables uuid[] not null default '{}';

comment on column public.tarjetas.asignado_a is 'Responsable principal: cuenta en cumplimiento y recibe el recordatorio.';
comment on column public.tarjetas.supervisor_id is 'Supervisor a cargo de la tarea (recibe también el recordatorio).';
comment on column public.tarjetas.corresponsables is 'Otros responsables además del principal.';

create index if not exists tarjetas_supervisor_idx on public.tarjetas (supervisor_id) where supervisor_id is not null;
create index if not exists tarjetas_corresponsables_idx on public.tarjetas using gin (corresponsables);
