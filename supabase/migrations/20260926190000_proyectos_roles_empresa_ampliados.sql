-- Mario, 26-sep-2026: "al rol de Mauro y Jonathan ante el panel de proyecto
-- también". Mauro es 'responsable' y Jonathan 'supervisor' (rol básico) en
-- Ergodinova: ven y administran (tableros de avance, control de obra,
-- planos) los proyectos de SU empresa, igual que el rol 'empresa'. Los roles
-- básicos además necesitan el módulo 'proyectos' asignado por RH
-- (permisos_modulo). Ya aplicado en producción (26-sep-2026).

create or replace function public.auth_opera_proyectos_empresa()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_empresa_id() is not null and (
    public.auth_rol() in ('empresa', 'responsable')
    or (public.auth_rol() in ('supervisor', 'directivo', 'administrativo') and public.auth_tiene_modulo('proyectos'))
  )
$$;

create or replace function public.auth_ve_proyecto(p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.proyectos p
    where p.id = p_proyecto_id
      and public.auth_rol() <> 'pendiente'
      and (
        public.auth_ve_todas_empresas()
        or (public.auth_rol() in ('empresa', 'direccion') and p.empresa_id = public.auth_empresa_id())
        or (public.auth_opera_proyectos_empresa() and p.empresa_id = public.auth_empresa_id())
        or p.responsable_id = auth.uid()
        or p.comprador_id = auth.uid()
      )
  )
$$;

create or replace function public.auth_administra_tableros_de(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_puede_administrar_tableros()
      or (p_empresa_id is not null and p_empresa_id = public.auth_empresa_id()
          and (public.auth_rol() = 'empresa' or public.auth_opera_proyectos_empresa()))
$$;

create or replace function public.auth_administra_proyecto(p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_rol() in ('admin', 'corporativo')
      or ((public.auth_rol() = 'empresa' or public.auth_opera_proyectos_empresa()) and exists (
            select 1 from public.proyectos p where p.id = p_proyecto_id and p.empresa_id = public.auth_empresa_id()))
$$;

drop policy if exists proyectos_select on public.proyectos;
create policy proyectos_select on public.proyectos
  for select
  using (public.auth_rol() <> 'pendiente' and public.auth_modulo_habilitado('proyectos') and (
    public.auth_ve_todas_empresas()
    or (public.auth_rol() in ('empresa', 'direccion') and empresa_id = public.auth_empresa_id())
    or (public.auth_opera_proyectos_empresa() and empresa_id = public.auth_empresa_id())
    or responsable_id = (select auth.uid())
    or comprador_id = (select auth.uid())
  ));

drop policy if exists proyecto_planos_select on public.proyecto_planos;
create policy proyecto_planos_select on public.proyecto_planos
  for select
  using (public.auth_modulo_habilitado('proyectos') and public.auth_ve_proyecto(proyecto_id));

drop policy if exists proyecto_planos_insert on public.proyecto_planos;
create policy proyecto_planos_insert on public.proyecto_planos
  for insert
  with check (subido_por = (select auth.uid()) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos') and public.auth_ve_proyecto(proyecto_id));
