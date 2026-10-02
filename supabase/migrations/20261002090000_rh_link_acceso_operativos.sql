-- RH manda el link de acceso / contraseña temporal también a cuentas
-- operativas que no son de la familia básica (Fernando, 2-oct-2026: "al
-- querer enviar el link a Carlos de BBVA me aparece: RH solo puede dar
-- acceso a personal contratado con rol básico"; Carlos Sánchez Xilot es
-- supervisor_bbva).
--
-- rh_administra_perfil() sigue igual (decide rol, módulos y supervisor:
-- solo familia básica). Esta función es más amplia y SOLO la usa la edge
-- generar-link-acceso: personal contratado con cualquier rol que no maneje
-- dinero ni administre (nunca admin, direccion, corporativo, rh ni empresa).
--
-- Ya aplicado en producción.

create or replace function public.rh_puede_mandar_acceso(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    join public.personal pe on pe.profile_id = p.id
    where p.id = p_profile_id
      and p.rol in ('pendiente', 'operativo', 'administrativo', 'supervisor', 'directivo',
                    'supervisor_bbva', 'responsable', 'almacen', 'produccion', 'rh_documentos')
  )
$$;

revoke all on function public.rh_puede_mandar_acceso(uuid) from public, anon, authenticated;
grant execute on function public.rh_puede_mandar_acceso(uuid) to service_role;
