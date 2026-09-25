-- 25-sep-2026: otra sesión aplicó en producción la migración "grupos_modulos"
-- (frontera entre organizaciones) y al recrear las policies de inventario y
-- de OC/OV las dejó solo con auth_puede_escribir() (corporativo/empresa/
-- admin). Se quedaron fuera direccion (Laura), almacen, produccion (Jaime) y
-- los roles básicos con módulo inventario: "new row violates row-level
-- security policy for table productos" al guardar una entrada/salida.
--
-- Aquí se agregan policies PERMISIVAS adicionales (se evalúan en OR con las
-- existentes) que devuelven esos permisos, respetando el módulo habilitado y
-- el alcance de organización que introdujo esa migración. Ya aplicado en
-- producción.

drop policy if exists productos_inventario_write on public.productos;
create policy productos_inventario_write on public.productos
  for all to authenticated
  using (
    public.auth_puede_escribir_inventario()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir_inventario()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

drop policy if exists almacenes_inventario_write on public.almacenes;
create policy almacenes_inventario_write on public.almacenes
  for all to authenticated
  using (
    public.auth_puede_escribir_inventario()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir_inventario()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

drop policy if exists movimientos_inventario_inventario_insert on public.movimientos_inventario;
create policy movimientos_inventario_inventario_insert on public.movimientos_inventario
  for insert to authenticated
  with check (
    public.auth_puede_escribir_inventario()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
    and registrado_por = (select auth.uid())
  );

-- OC pendientes de autorización dadas de alta a mano desde inventario
-- (fuente 'excel'); ver 20260923160000_ordenes_compra_alta_manual_inventario.
drop policy if exists ordenes_compra_inventario_insert on public.ordenes_compra;
create policy ordenes_compra_inventario_insert on public.ordenes_compra
  for insert to authenticated
  with check (
    public.auth_puede_escribir_inventario()
    and fuente = 'excel'
    and public.empresa_en_alcance(empresa_id)
  );

-- Producción (Jaime) ve y da de alta OC/OV de sus plantas; ver
-- 20260916150000_produccion_planta_carpinteria.
drop policy if exists ordenes_compra_produccion_select on public.ordenes_compra;
create policy ordenes_compra_produccion_select on public.ordenes_compra
  for select to authenticated
  using (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB', 'CSC'))
    and public.empresa_en_alcance(empresa_id)
  );
drop policy if exists ordenes_compra_produccion_insert on public.ordenes_compra;
create policy ordenes_compra_produccion_insert on public.ordenes_compra
  for insert to authenticated
  with check (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB', 'CSC'))
    and public.empresa_en_alcance(empresa_id)
  );
drop policy if exists ordenes_venta_produccion_select on public.ordenes_venta;
create policy ordenes_venta_produccion_select on public.ordenes_venta
  for select to authenticated
  using (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB', 'CSC'))
    and public.empresa_en_alcance(empresa_id)
  );
drop policy if exists ordenes_venta_produccion_insert on public.ordenes_venta;
create policy ordenes_venta_produccion_insert on public.ordenes_venta
  for insert to authenticated
  with check (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB', 'CSC'))
    and public.empresa_en_alcance(empresa_id)
  );
