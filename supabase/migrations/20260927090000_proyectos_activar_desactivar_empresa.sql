-- Desactivar / reactivar proyectos (Mario, 27-sep-2026): "dejar únicamente
-- los que siguen vivos". admin y corporativo ya podían editar; el rol
-- empresa puede en los proyectos de SU empresa (misma familia que los
-- tableros y el control de obra). Ya aplicado en producción.
drop policy if exists proyectos_update_empresa on public.proyectos;
create policy proyectos_update_empresa on public.proyectos
  for update
  using (public.auth_rol() = 'empresa' and empresa_id = public.auth_empresa_id() and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'))
  with check (public.auth_rol() = 'empresa' and empresa_id = public.auth_empresa_id() and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
