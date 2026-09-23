-- RLS para el rol 'almacen': acceso de lectura/escritura al módulo de
-- inventario (almacenes/productos/movimientos_inventario) en las 8
-- empresas, pero SIN acceso a datos bancarios (cuentas_bancarias,
-- movimientos, cfdi, archivos_cargados, reglas_clasificacion,
-- excepciones_proveedor) -- mismo criterio que 'rh' en
-- 20260821090002_rh_rol_rls.sql.
--
-- A diferencia de 'rh', 'almacen' SÍ necesita ver ordenes_compra y
-- ordenes_venta: la pantalla principal de Inventario (Movimientos.tsx)
-- deja vincular cada entrada/salida a una OC/OV real para el "Match" con
-- backoffice -- por eso ordenes_compra_select/ordenes_venta_select NO se
-- tocan aquí y se quedan en auth_ve_datos_financieros() (que solo excluye
-- pendiente/rh), mientras que las tablas puramente bancarias pasan a una
-- función nueva que además excluye a 'almacen'.

create or replace function public.auth_ve_datos_bancarios()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_ve_datos_financieros() and public.auth_rol() <> 'almacen'
$$;

alter policy cuentas_bancarias_select on public.cuentas_bancarias
  using (
    public.auth_ve_datos_bancarios()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy movimientos_select on public.movimientos
  using (
    public.auth_ve_datos_bancarios()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy cfdi_select on public.cfdi
  using (
    public.auth_ve_datos_bancarios()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy archivos_cargados_select on public.archivos_cargados
  using (
    public.auth_ve_datos_bancarios()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy reglas_clasificacion_select on public.reglas_clasificacion
  using (public.auth_ve_datos_bancarios());

alter policy excepciones_proveedor_select on public.excepciones_proveedor
  using (public.auth_ve_datos_bancarios());

-- Escritura de inventario: 'almacen' se agrega como excepción explícita en
-- una función nueva (mismo patrón de lista blanca que auth_puede_escribir()),
-- sin tocar esa función para no darle sin querer permiso de escritura sobre
-- las tablas financieras que también la usan (cuentas_bancarias_write,
-- ordenes_compra_write, etc.).
create or replace function public.auth_puede_escribir_inventario()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_puede_escribir() or public.auth_rol() = 'almacen'
$$;

alter policy almacenes_write on public.almacenes
  using (
    public.auth_puede_escribir_inventario()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  )
  with check (
    public.auth_puede_escribir_inventario()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy productos_write on public.productos
  using (
    public.auth_puede_escribir_inventario()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  )
  with check (
    public.auth_puede_escribir_inventario()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter policy movimientos_inventario_insert on public.movimientos_inventario
  with check (
    public.auth_puede_escribir_inventario()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
    and registrado_por = auth.uid()
  );
