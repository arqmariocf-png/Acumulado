-- Producción (Clavicón, pedido de Mario 23-sep-2026): cada orden de
-- producción puede ligarse a un proyecto del catálogo de la empresa, y la
-- planta puede dar de alta un proyecto nuevo desde la misma pantalla (el
-- rol produccion no podía escribir en proyectos).
alter table public.ordenes_produccion add column proyecto_id uuid references public.proyectos (id);
create index ordenes_produccion_proyecto_idx on public.ordenes_produccion (proyecto_id) where proyecto_id is not null;

create policy proyectos_select_produccion on public.proyectos
  for select using (
    public.auth_rol() = 'produccion'
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );

create policy proyectos_insert_produccion on public.proyectos
  for insert with check (
    public.auth_rol() = 'produccion'
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );
