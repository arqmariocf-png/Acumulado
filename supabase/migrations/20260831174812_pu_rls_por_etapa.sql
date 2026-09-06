-- Módulo Precios Unitarios: permisos por etapa.
--
-- RLS decide si puedes tocar el renglón; validar_flujo_pu_analisis decide si la
-- transición de etapa es legal para tu rol. Se separan a propósito: almacén
-- necesita UPDATE sobre el análisis para confirmar material, pero eso no lo
-- convierte en dueño del PU.

drop policy pu_analisis_write on pu_analisis;
drop policy pu_analisis_items_write on pu_analisis_items;
drop policy pu_analisis_items_select on pu_analisis_items;

-- ¿El usuario es el supervisor (responsable) del proyecto de este análisis?
create function auth_es_supervisor_pu(p_proyecto_id uuid) returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.proyectos p
    where p.id = p_proyecto_id
      and p.responsable_id = (select auth.uid())
  )
$$;

comment on function auth_es_supervisor_pu is
  'El supervisor de obra se identifica por proyectos.responsable_id, no por un rol global: la misma persona es dueña de sus obras y ajena a las demás.';

-- ¿Quién puede tocar el análisis, en cualquier etapa? Los dueños del catálogo
-- por empresa, más el supervisor de esa obra, más almacén (que entra solo a
-- confirmar material -- el trigger de flujo le impide cualquier otra etapa).
create function auth_participa_pu(p_empresa_id uuid, p_proyecto_id uuid) returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    (
      public.auth_rol() = any (array['admin', 'corporativo', 'direccion', 'empresa', 'almacen']::app_rol[])
      and (public.auth_ve_todas_empresas() or p_empresa_id = public.auth_empresa_id())
    )
    or public.auth_es_supervisor_pu(p_proyecto_id)
$$;

create policy pu_analisis_insert on pu_analisis
  for insert with check (
    auth_puede_escribir_pu()
    and (auth_ve_todas_empresas() or empresa_id = auth_empresa_id())
    or (auth_rol() = 'responsable' and auth_es_supervisor_pu(proyecto_id))
  );

create policy pu_analisis_update on pu_analisis
  for update
  using (auth_participa_pu(empresa_id, proyecto_id))
  with check (auth_participa_pu(empresa_id, proyecto_id));

create policy pu_analisis_delete on pu_analisis
  for delete using (
    auth_rol() = any (array['admin', 'corporativo']::app_rol[])
    or (estado = 'borrador' and auth_es_supervisor_pu(proyecto_id))
  );

create policy pu_analisis_items_select on pu_analisis_items
  for select using (
    exists (
      select 1 from pu_analisis a
      where a.id = pu_analisis_items.analisis_id
        and auth_rol() <> 'pendiente'
        and (
          auth_ve_todas_empresas()
          or a.empresa_id = auth_empresa_id()
          or auth_es_supervisor_pu(a.proyecto_id)
        )
    )
  );

-- La tarjeta se congela conforme avanza: el supervisor solo edita en borrador,
-- almacén solo mientras revisa material. Después de autorizado nadie mueve
-- cantidades -- si hay que corregir, se rechaza a borrador y queda en bitácora.
create policy pu_analisis_items_write on pu_analisis_items
  for all
  using (
    exists (
      select 1 from pu_analisis a
      where a.id = pu_analisis_items.analisis_id
        and (
          auth_rol() = 'admin'
          or (a.estado = 'borrador' and (
                auth_es_supervisor_pu(a.proyecto_id)
                or (auth_puede_escribir_pu() and (auth_ve_todas_empresas() or a.empresa_id = auth_empresa_id()))
             ))
          or (a.estado = 'en_revision_material' and auth_rol() = 'almacen')
        )
    )
  )
  with check (
    exists (
      select 1 from pu_analisis a
      where a.id = pu_analisis_items.analisis_id
        and (
          auth_rol() = 'admin'
          or (a.estado = 'borrador' and (
                auth_es_supervisor_pu(a.proyecto_id)
                or (auth_puede_escribir_pu() and (auth_ve_todas_empresas() or a.empresa_id = auth_empresa_id()))
             ))
          or (a.estado = 'en_revision_material' and auth_rol() = 'almacen')
        )
    )
  );