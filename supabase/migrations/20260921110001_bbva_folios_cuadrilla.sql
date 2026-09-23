-- Indicador de cuadrillas BBVA: cada supervisor registra los folios que
-- trae su cuadrilla y los va moviendo de pendiente (rojo) a en ejecución
-- (amarillo) y atendido (verde). Es una tabla propia, separada del maestro
-- de folios del Excel (bbva_mantenimiento_snapshots), porque el supervisor
-- captura desde la obra y el maestro llega después por Belén.
create table public.bbva_folios_cuadrilla (
  id uuid primary key default gen_random_uuid(),
  folio text not null,
  estatus text not null default 'pendiente' check (estatus in ('pendiente', 'en_ejecucion', 'atendido')),
  sucursal text,
  descripcion text,
  nota text,
  supervisor_id uuid not null default auth.uid() references public.profiles (id),
  en_ejecucion_en timestamptz,
  atendido_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (folio)
);

comment on table public.bbva_folios_cuadrilla is 'Folios BBVA capturados por los supervisores de cuadrilla con su semáforo: pendiente (rojo), en_ejecucion (amarillo), atendido (verde).';

create index bbva_folios_cuadrilla_supervisor_idx on public.bbva_folios_cuadrilla (supervisor_id, estatus);

-- Fechas de cambio de estatus y actualizado_en se llenan solas.
create or replace function public.bbva_folios_cuadrilla_marcar()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  if new.estatus = 'en_ejecucion' and (tg_op = 'INSERT' or old.estatus is distinct from 'en_ejecucion') then
    new.en_ejecucion_en := now();
  end if;
  if new.estatus = 'atendido' and (tg_op = 'INSERT' or old.estatus is distinct from 'atendido') then
    new.atendido_en := now();
  end if;
  if new.estatus = 'pendiente' then
    new.en_ejecucion_en := null;
    new.atendido_en := null;
  end if;
  return new;
end $$;

create trigger bbva_folios_cuadrilla_marcar
  before insert or update on public.bbva_folios_cuadrilla
  for each row execute function public.bbva_folios_cuadrilla_marcar();

alter table public.bbva_folios_cuadrilla enable row level security;

-- El supervisor ve y mueve solo sus folios; quien lleva el mantenimiento
-- BBVA (corporativo, dirección, admin o el permiso acotado) ve todos.
create policy bbva_folios_cuadrilla_select on public.bbva_folios_cuadrilla
  for select
  using (
    supervisor_id = auth.uid()
    or public.auth_rol() in ('corporativo', 'direccion', 'admin')
    or public.auth_bbva_mantenimiento()
  );

create policy bbva_folios_cuadrilla_insert on public.bbva_folios_cuadrilla
  for insert
  with check (
    (public.auth_rol() = 'supervisor_bbva' and supervisor_id = auth.uid())
    or public.auth_rol() = 'admin'
  );

create policy bbva_folios_cuadrilla_update on public.bbva_folios_cuadrilla
  for update
  using ((public.auth_rol() = 'supervisor_bbva' and supervisor_id = auth.uid()) or public.auth_rol() = 'admin')
  with check ((public.auth_rol() = 'supervisor_bbva' and supervisor_id = auth.uid()) or public.auth_rol() = 'admin');

create policy bbva_folios_cuadrilla_delete on public.bbva_folios_cuadrilla
  for delete
  using ((public.auth_rol() = 'supervisor_bbva' and supervisor_id = auth.uid()) or public.auth_rol() = 'admin');
