-- Mario, 26-sep-2026: el rol 'empresa' (Jorge en Ergodinova) crea los
-- tableros de avance y activa el control de obra de los proyectos de SU
-- empresa. admin y corporativo siguen con todas. La frontera de
-- organización y el módulo 'proyectos' se siguen evaluando aparte.
-- Ya aplicado en producción (26-sep-2026).

create or replace function public.auth_administra_tableros_de(p_empresa_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_puede_administrar_tableros()
      or (public.auth_rol() = 'empresa' and p_empresa_id is not null and p_empresa_id = public.auth_empresa_id())
$$;

create or replace function public.auth_administra_proyecto(p_proyecto_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_rol() in ('admin', 'corporativo')
      or (public.auth_rol() = 'empresa' and exists (
            select 1 from public.proyectos p where p.id = p_proyecto_id and p.empresa_id = public.auth_empresa_id()))
$$;

drop policy if exists tableros_insert on public.tableros;
create policy tableros_insert on public.tableros
  for insert
  with check (public.auth_administra_tableros_de(empresa_id) and creado_por = (select auth.uid()));

drop policy if exists tableros_update on public.tableros;
create policy tableros_update on public.tableros
  for update
  using (public.auth_administra_tableros_de(empresa_id))
  with check (public.auth_administra_tableros_de(empresa_id));

drop policy if exists tablero_columnas_write on public.tablero_columnas;
create policy tablero_columnas_write on public.tablero_columnas
  for all
  using (exists (select 1 from public.tableros t where t.id = tablero_columnas.tablero_id and public.auth_administra_tableros_de(t.empresa_id)))
  with check (exists (select 1 from public.tableros t where t.id = tablero_columnas.tablero_id and public.auth_administra_tableros_de(t.empresa_id)));

drop policy if exists proyecto_controles_insert on public.proyecto_controles;
create policy proyecto_controles_insert on public.proyecto_controles
  for insert
  with check (public.auth_administra_proyecto(proyecto_id) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
drop policy if exists proyecto_controles_update on public.proyecto_controles;
create policy proyecto_controles_update on public.proyecto_controles
  for update
  using (public.auth_administra_proyecto(proyecto_id) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'))
  with check (public.auth_administra_proyecto(proyecto_id) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
drop policy if exists proyecto_controles_delete on public.proyecto_controles;
create policy proyecto_controles_delete on public.proyecto_controles
  for delete
  using (public.auth_administra_proyecto(proyecto_id) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));

drop policy if exists proyecto_control_compras_insert on public.proyecto_control_compras;
create policy proyecto_control_compras_insert on public.proyecto_control_compras
  for insert
  with check (exists (select 1 from public.proyecto_controles c where c.id = proyecto_control_compras.control_id and public.auth_administra_proyecto(c.proyecto_id)) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
drop policy if exists proyecto_control_compras_update on public.proyecto_control_compras;
create policy proyecto_control_compras_update on public.proyecto_control_compras
  for update
  using (exists (select 1 from public.proyecto_controles c where c.id = proyecto_control_compras.control_id and public.auth_administra_proyecto(c.proyecto_id)) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'))
  with check (exists (select 1 from public.proyecto_controles c where c.id = proyecto_control_compras.control_id and public.auth_administra_proyecto(c.proyecto_id)) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
drop policy if exists proyecto_control_compras_delete on public.proyecto_control_compras;
create policy proyecto_control_compras_delete on public.proyecto_control_compras
  for delete
  using (exists (select 1 from public.proyecto_controles c where c.id = proyecto_control_compras.control_id and public.auth_administra_proyecto(c.proyecto_id)) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));

drop policy if exists proyecto_control_nomina_insert on public.proyecto_control_nomina;
create policy proyecto_control_nomina_insert on public.proyecto_control_nomina
  for insert
  with check (exists (select 1 from public.proyecto_controles c where c.id = proyecto_control_nomina.control_id and public.auth_administra_proyecto(c.proyecto_id)) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
drop policy if exists proyecto_control_nomina_update on public.proyecto_control_nomina;
create policy proyecto_control_nomina_update on public.proyecto_control_nomina
  for update
  using (exists (select 1 from public.proyecto_controles c where c.id = proyecto_control_nomina.control_id and public.auth_administra_proyecto(c.proyecto_id)) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'))
  with check (exists (select 1 from public.proyecto_controles c where c.id = proyecto_control_nomina.control_id and public.auth_administra_proyecto(c.proyecto_id)) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
drop policy if exists proyecto_control_nomina_delete on public.proyecto_control_nomina;
create policy proyecto_control_nomina_delete on public.proyecto_control_nomina
  for delete
  using (exists (select 1 from public.proyecto_controles c where c.id = proyecto_control_nomina.control_id and public.auth_administra_proyecto(c.proyecto_id)) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
