-- Laura desactiva y reactiva obras (27-nov-2026, Laura: "habilitar botón de
-- desactivar proyectos a Laura"). Dirección no tiene update en `proyectos`
-- (solo admin, corporativo y empresa); en vez de abrirle toda la obra, una
-- función que solo cambia `activo`. Los triggers de siempre archivan o
-- regresan el tablero de la obra. Ya aplicado en producción
-- (proyecto_cambiar_activo_direccion).

create or replace function public.fn_proyecto_cambiar_activo(p_proyecto uuid, p_activo boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid;
  v_rol text := public.auth_rol_definer()::text;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  if public.auth_solo_consulta() then raise exception 'Solo consulta: no puedes cambiar obras.'; end if;
  select empresa_id into v_empresa from public.proyectos where id = p_proyecto;
  if v_empresa is null then raise exception 'Obra no encontrada.'; end if;
  if not (public.auth_admin_global_definer()
          or (v_rol in ('admin', 'corporativo', 'direccion', 'empresa')
              and v_empresa = any (public.auth_empresas_alcance()))) then
    raise exception 'Solo dirección, corporativo, empresa o admin desactivan obras de su alcance.';
  end if;
  update public.proyectos set activo = p_activo, updated_at = now() where id = p_proyecto;
end;
$$;

revoke all on function public.fn_proyecto_cambiar_activo(uuid, boolean) from public, anon;
grant execute on function public.fn_proyecto_cambiar_activo(uuid, boolean) to authenticated;
