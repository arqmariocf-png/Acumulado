-- Jonathan (supervisor con módulo proyectos, Ergodinova) no podía crear
-- requerimientos (Mario, 28-sep-2026): requisiciones_insert solo dejaba a
-- admin/corporativo y al responsable asignado al proyecto. Misma regla que
-- los tableros (26-sep): quien opera los proyectos de su empresa
-- (auth_opera_proyectos_empresa: empresa, responsable y básicos con módulo
-- proyectos) crea requerimientos de los proyectos de SU empresa, a su
-- nombre. El responsable sigue pudiendo en los suyos aunque el proyecto
-- sea de otra empresa. Ya aplicado en producción.
drop policy if exists requisiciones_insert on public.requisiciones;
create policy requisiciones_insert on public.requisiciones for insert
  with check (
    public.auth_rol() in ('admin', 'corporativo')
    or (
      solicitado_por = (select auth.uid())
      and exists (
        select 1 from public.proyectos p
        where p.id = requisiciones.proyecto_id
          and p.empresa_id = requisiciones.empresa_id
          and (
            (public.auth_rol() = 'responsable' and p.responsable_id = (select auth.uid()))
            or (public.auth_opera_proyectos_empresa() and p.empresa_id = public.auth_empresa_id())
          )
      )
    )
  );
