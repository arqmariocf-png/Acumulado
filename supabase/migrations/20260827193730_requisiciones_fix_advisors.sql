-- Corrige auth_rls_initplan (auth.uid() sin `select`, fuerza reevaluación
-- por fila) en las políticas de Requisiciones, mismo hallazgo y mismo
-- arreglo que ya se aplicó una vez para Inventario
-- (20260824145020_inventario_fix_advisors.sql). También agrega los índices
-- de FK que faltaron (resuelto_por/vinculado_por/entregado_por/orden_venta_id).

alter policy proyectos_select on public.proyectos
  using (
    public.auth_rol() <> 'pendiente'
    and (
      public.auth_ve_todas_empresas()
      or (public.auth_rol() in ('empresa', 'direccion') and empresa_id = public.auth_empresa_id())
      or responsable_id = (select auth.uid())
      or comprador_id = (select auth.uid())
    )
  );

alter policy requisiciones_select on public.requisiciones
  using (
    public.auth_rol() <> 'pendiente'
    and (
      public.auth_ve_todas_empresas()
      or (public.auth_rol() in ('empresa', 'direccion') and empresa_id = public.auth_empresa_id())
      or exists (
        select 1 from public.proyectos p
        where p.id = requisiciones.proyecto_id
          and (p.responsable_id = (select auth.uid()) or p.comprador_id = (select auth.uid()))
      )
    )
  );

alter policy requisiciones_insert on public.requisiciones
  with check (
    public.auth_rol() in ('admin', 'corporativo')
    or (
      public.auth_rol() = 'responsable'
      and solicitado_por = (select auth.uid())
      and exists (select 1 from public.proyectos p where p.id = proyecto_id and p.responsable_id = (select auth.uid()))
    )
  );

alter policy requisiciones_update on public.requisiciones
  using (
    public.auth_rol() in ('admin', 'corporativo')
    or (solicitado_por = (select auth.uid()) and estado = 'enviada')
  )
  with check (
    public.auth_rol() in ('admin', 'corporativo')
    or (solicitado_por = (select auth.uid()) and estado = 'enviada')
  );

alter policy requisicion_lineas_select on public.requisicion_lineas
  using (
    exists (
      select 1 from public.requisiciones r
      where r.id = requisicion_lineas.requisicion_id
        and (
          public.auth_ve_todas_empresas()
          or (public.auth_rol() in ('empresa', 'direccion') and r.empresa_id = public.auth_empresa_id())
          or exists (
            select 1 from public.proyectos p
            where p.id = r.proyecto_id and (p.responsable_id = (select auth.uid()) or p.comprador_id = (select auth.uid()))
          )
        )
    )
  );

alter policy requisicion_lineas_write on public.requisicion_lineas
  using (
    exists (
      select 1 from public.requisiciones r
      where r.id = requisicion_lineas.requisicion_id
        and (
          public.auth_rol() in ('admin', 'corporativo')
          or (r.solicitado_por = (select auth.uid()) and r.estado = 'enviada')
        )
    )
  )
  with check (
    exists (
      select 1 from public.requisiciones r
      where r.id = requisicion_lineas.requisicion_id
        and (
          public.auth_rol() in ('admin', 'corporativo')
          or (r.solicitado_por = (select auth.uid()) and r.estado = 'enviada')
        )
    )
  );

alter policy necesidades_compra_select on public.necesidades_compra
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
            where p.id = r.proyecto_id and (p.responsable_id = (select auth.uid()) or p.comprador_id = (select auth.uid()))
          )
        )
    )
  );

alter policy necesidades_entrega_select on public.necesidades_entrega
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
            where p.id = r.proyecto_id and (p.responsable_id = (select auth.uid()) or p.comprador_id = (select auth.uid()))
          )
        )
    )
  );

create index necesidades_compra_resuelto_por_idx on public.necesidades_compra (resuelto_por);
create index necesidades_compra_vinculado_por_idx on public.necesidades_compra (vinculado_por) where vinculado_por is not null;
create index necesidades_entrega_resuelto_por_idx on public.necesidades_entrega (resuelto_por);
create index necesidades_entrega_entregado_por_idx on public.necesidades_entrega (entregado_por) where entregado_por is not null;
create index necesidades_entrega_orden_venta_idx on public.necesidades_entrega (orden_venta_id) where orden_venta_id is not null;
