-- Dirección captura el control de obra (Laura, 1-oct-2026: "a mí no me deja
-- subir presupuestos a las obras", en Abarrotes Neto Rio Frio). Solo se
-- amplía auth_administra_proyecto, que únicamente usan proyecto_controles,
-- proyecto_control_compras y proyecto_control_nomina: dirección crea el
-- control (contrato/presupuesto) y captura compras y nómina en los
-- proyectos de las empresas de su alcance. Ya aplicado en producción.

create or replace function public.auth_administra_proyecto(p_proyecto_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select public.auth_rol() in ('admin', 'corporativo')
      or ((public.auth_rol() in ('empresa', 'direccion') or public.auth_opera_proyectos_empresa()) and exists (
            select 1 from public.proyectos p where p.id = p_proyecto_id and public.empresa_en_alcance(p.empresa_id)))
$function$;
