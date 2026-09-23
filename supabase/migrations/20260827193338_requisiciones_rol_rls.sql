-- Excluye 'responsable' de los datos financieros existentes, mismo criterio
-- que 20260821090002_rh_rol_rls.sql usó para 'rh': sin esto, en cuanto se le
-- asigne empresa_id a un responsable (necesario para que vea el catálogo de
-- productos/existencias de su empresa), las políticas de SELECT basadas en
-- `auth_rol() <> 'pendiente' + empresa_id = auth_empresa_id()` le darían
-- acceso de lectura a movimientos bancarios, CFDI y OC/OV de esa empresa.
create or replace function public.auth_ve_datos_financieros()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_rol() not in ('pendiente', 'rh', 'responsable')
$$;
