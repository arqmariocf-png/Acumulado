-- RLS de Requisiciones. A diferencia del resto del proyecto (acceso por
-- empresa completa), un 'responsable' solo ve/escribe SUS proyectos y las
-- requisiciones que cuelgan de ellos -- nunca el resto de su empresa.
-- corporativo/admin siguen viendo todo; empresa/dirección conservan
-- visibilidad de tesorería sobre su empresa (no escritura, salvo admin).

alter table public.proyectos enable row level security;

create policy proyectos_select on public.proyectos
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (
      public.auth_ve_todas_empresas()
      or (public.auth_rol() in ('empresa', 'direccion') and empresa_id = public.auth_empresa_id())
      or responsable_id = auth.uid()
      or comprador_id = auth.uid()
    )
  );

-- proyectos es catálogo maestro (se carga desde el Excel del backoffice) --
-- solo admin/corporativo lo mantienen, ni siquiera 'empresa' lo edita
-- directo (a diferencia de productos/almacenes).
create policy proyectos_write on public.proyectos
  for all
  using (public.auth_rol() in ('admin', 'corporativo'))
  with check (public.auth_rol() in ('admin', 'corporativo'));

alter table public.requisiciones enable row level security;

create policy requisiciones_select on public.requisiciones
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (
      public.auth_ve_todas_empresas()
      or (public.auth_rol() in ('empresa', 'direccion') and empresa_id = public.auth_empresa_id())
      or exists (
        select 1 from public.proyectos p
        where p.id = requisiciones.proyecto_id
          and (p.responsable_id = auth.uid() or p.comprador_id = auth.uid())
      )
    )
  );

-- Un responsable solo crea requisiciones para un proyecto donde él mismo
-- está asignado, y siempre a su propio nombre (solicitado_por = auth.uid())
-- -- admin/corporativo pueden capturar a nombre de alguien más mientras no
-- todos los responsables tengan cuenta todavía.
create policy requisiciones_insert on public.requisiciones
  for insert
  with check (
    public.auth_rol() in ('admin', 'corporativo')
    or (
      public.auth_rol() = 'responsable'
      and solicitado_por = auth.uid()
      and exists (select 1 from public.proyectos p where p.id = proyecto_id and p.responsable_id = auth.uid())
    )
  );

-- Editar (folio/estado/comentario) -- admin/corporativo en cualquier
-- momento; el responsable que la creó, solo mientras sigue en 'enviada'
-- (antes de que alguien empiece a resolverla).
create policy requisiciones_update on public.requisiciones
  for update
  using (
    public.auth_rol() in ('admin', 'corporativo')
    or (solicitado_por = auth.uid() and estado = 'enviada')
  )
  with check (
    public.auth_rol() in ('admin', 'corporativo')
    or (solicitado_por = auth.uid() and estado = 'enviada')
  );

alter table public.requisicion_lineas enable row level security;

create policy requisicion_lineas_select on public.requisicion_lineas
  for select
  using (
    exists (
      select 1 from public.requisiciones r
      where r.id = requisicion_lineas.requisicion_id
        and (
          public.auth_ve_todas_empresas()
          or (public.auth_rol() in ('empresa', 'direccion') and r.empresa_id = public.auth_empresa_id())
          or exists (
            select 1 from public.proyectos p
            where p.id = r.proyecto_id and (p.responsable_id = auth.uid() or p.comprador_id = auth.uid())
          )
        )
    )
  );

create policy requisicion_lineas_write on public.requisicion_lineas
  for all
  using (
    exists (
      select 1 from public.requisiciones r
      where r.id = requisicion_lineas.requisicion_id
        and (
          public.auth_rol() in ('admin', 'corporativo')
          or (r.solicitado_por = auth.uid() and r.estado = 'enviada')
        )
    )
  )
  with check (
    exists (
      select 1 from public.requisiciones r
      where r.id = requisicion_lineas.requisicion_id
        and (
          public.auth_rol() in ('admin', 'corporativo')
          or (r.solicitado_por = auth.uid() and r.estado = 'enviada')
        )
    )
  );

-- necesidades_compra / necesidades_entrega: la resolución (split
-- compra/entrega) es tarea de admin/corporativo (ver decisión del cliente
-- 2026-08-27 -- "el sistema sugiere, un admin confirma"), el responsable
-- del proyecto solo puede consultarlas para ver el estatus de lo que pidió.
alter table public.necesidades_compra enable row level security;

create policy necesidades_compra_select on public.necesidades_compra
  for select
  using (
    exists (
      select 1
      from public.requisicion_lineas rl
      join public.requisiciones r on r.id = rl.requisicion_id
      where rl.id = necesidades_compra.requisicion_linea_id
        and (
          public.auth_ve_todas_empresas()
          or (public.auth_rol() in ('empresa', 'direccion') and r.empresa_id = public.auth_empresa_id())
          or exists (
            select 1 from public.proyectos p
            where p.id = r.proyecto_id and (p.responsable_id = auth.uid() or p.comprador_id = auth.uid())
          )
        )
    )
  );

create policy necesidades_compra_write on public.necesidades_compra
  for all
  using (public.auth_rol() in ('admin', 'corporativo'))
  with check (public.auth_rol() in ('admin', 'corporativo'));

alter table public.necesidades_entrega enable row level security;

create policy necesidades_entrega_select on public.necesidades_entrega
  for select
  using (
    exists (
      select 1
      from public.requisicion_lineas rl
      join public.requisiciones r on r.id = rl.requisicion_id
      where rl.id = necesidades_entrega.requisicion_linea_id
        and (
          public.auth_ve_todas_empresas()
          or (public.auth_rol() in ('empresa', 'direccion') and r.empresa_id = public.auth_empresa_id())
          or exists (
            select 1 from public.proyectos p
            where p.id = r.proyecto_id and (p.responsable_id = auth.uid() or p.comprador_id = auth.uid())
          )
        )
    )
  );

create policy necesidades_entrega_write on public.necesidades_entrega
  for all
  using (public.auth_rol() in ('admin', 'corporativo'))
  with check (public.auth_rol() in ('admin', 'corporativo'));
