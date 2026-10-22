-- Requisiciones por permiso de la persona (22-oct-2026, Mario: "activa
-- requisiciones en Clavicón para Jaime"). Jaime Sierra es rol `produccion`:
-- `auth_opera_proyectos_empresa` (la que deja crear requisiciones) solo toma
-- empresa, responsable y básicos con Proyectos, y cambiarle el rol movería lo
-- de producción. Igual que Christian (14-oct), el permiso por persona
-- `permisos_modulo` 'requisiciones' ya abre el menú en cualquier rol; aquí se
-- abre también la base: con ese permiso se crean requisiciones a nombre propio
-- SOLO en obras de su empresa principal o de las que maneja ("Maneja
-- también"), no en todas las del grupo aunque vea todas. Renglones, edición y
-- cancelación ya van por quien la pidió (`auth_requisiciones_editables`).
--
-- Ya aplicado en producción (requisiciones_por_permiso).

create or replace function public.auth_empresas_requisicion_permiso()
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct e), '{}'::uuid[])
    from public.profiles p
    cross join lateral unnest(array[p.empresa_id]
      || coalesce((select array_agg(pe.empresa_id) from public.profile_empresas pe where pe.profile_id = p.id), '{}'::uuid[])) e
   where p.id = auth.uid() and p.activo and not p.espectador and p.rol <> 'pendiente'
     and e is not null
     and exists (select 1 from public.permisos_modulo pm where pm.profile_id = p.id and pm.modulo = 'requisiciones')
$$;
revoke all on function public.auth_empresas_requisicion_permiso() from public, anon;
grant execute on function public.auth_empresas_requisicion_permiso() to authenticated;

drop policy if exists requisiciones_insert_permiso on public.requisiciones;
create policy requisiciones_insert_permiso on public.requisiciones for insert to authenticated
  with check (
    solicitado_por = (select auth.uid())
    and empresa_id = any ((select public.auth_empresas_requisicion_permiso())::uuid[])
    and exists (select 1 from public.proyectos p where p.id = requisiciones.proyecto_id and p.empresa_id = requisiciones.empresa_id)
  );
