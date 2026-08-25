-- Excluye explícitamente al rol 'rh' de todos los datos financieros
-- existentes. Las políticas de SELECT de cuentas_bancarias, ordenes_compra,
-- ordenes_venta, cfdi, movimientos, archivos_cargados, reglas_clasificacion
-- y excepciones_proveedor usan hoy `auth_rol() <> 'pendiente'` -- un patrón
-- de "cualquier rol aprobado puede leer" que, sin este cambio, le daría a
-- 'rh' acceso de lectura a todo lo bancario en cuanto se le asigne el rol
-- (mismo bug que si se le asignara 'direccion' por accidente). Las
-- políticas de escritura (auth_puede_escribir()) ya son una lista blanca
-- que no incluye 'rh', así que esas no necesitan cambio.
--
-- empresas_select y profiles_select_self NO se tocan: RH sí necesita ver el
-- catálogo de las 8 empresas (nombre/código, para asignar personal a una
-- empresa) y su propio profile -- ninguno de los dos expone datos
-- financieros.

create or replace function public.auth_ve_datos_financieros()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_rol() not in ('pendiente', 'rh')
$$;

alter policy cuentas_bancarias_select on public.cuentas_bancarias
  using (
    public.auth_ve_datos_financieros()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy ordenes_compra_select on public.ordenes_compra
  using (
    public.auth_ve_datos_financieros()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy ordenes_venta_select on public.ordenes_venta
  using (
    public.auth_ve_datos_financieros()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy cfdi_select on public.cfdi
  using (
    public.auth_ve_datos_financieros()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy movimientos_select on public.movimientos
  using (
    public.auth_ve_datos_financieros()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy archivos_cargados_select on public.archivos_cargados
  using (
    public.auth_ve_datos_financieros()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy reglas_clasificacion_select on public.reglas_clasificacion
  using (public.auth_ve_datos_financieros());

alter policy excepciones_proveedor_select on public.excepciones_proveedor
  using (public.auth_ve_datos_financieros());
