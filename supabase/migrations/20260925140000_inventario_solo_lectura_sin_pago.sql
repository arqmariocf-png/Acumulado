-- Las policies que restituyeron los permisos de inventario
-- (20260925130000) quedaron sin la tercera frontera: la suscripción. Son
-- PERMISIVAS, así que se evalúan en OR con las de 20260923090004 -- y un OR
-- con una condición que no pregunta por el pago vuelve inútil la regla
-- "gracia y luego solo lectura": una organización suspendida seguiría dando
-- de alta productos, almacenes y movimientos con solo tener el módulo de
-- inventario abierto.
--
-- Loma no lo nota (la organización maestra nunca se bloquea), pero el primer
-- cliente al que se le abra inventario sí, y sería en el peor momento: el mes
-- que deje de pagar.
--
-- De paso, `for all` se parte en insert/update/delete. La lectura la cubren
-- productos_select / almacenes_select, que no dependen del pago: quien no
-- pagó sigue pudiendo consultar y exportar lo suyo. Ese es justo el trato.

drop policy if exists productos_inventario_write on public.productos;

create policy productos_inventario_insert on public.productos
  for insert to authenticated
  with check (
    public.auth_puede_escribir_inventario()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

create policy productos_inventario_update on public.productos
  for update to authenticated
  using (
    public.auth_puede_escribir_inventario()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir_inventario()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

create policy productos_inventario_delete on public.productos
  for delete to authenticated
  using (
    public.auth_puede_escribir_inventario()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

drop policy if exists almacenes_inventario_write on public.almacenes;

create policy almacenes_inventario_insert on public.almacenes
  for insert to authenticated
  with check (
    public.auth_puede_escribir_inventario()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

create policy almacenes_inventario_update on public.almacenes
  for update to authenticated
  using (
    public.auth_puede_escribir_inventario()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir_inventario()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

create policy almacenes_inventario_delete on public.almacenes
  for delete to authenticated
  using (
    public.auth_puede_escribir_inventario()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

drop policy if exists movimientos_inventario_inventario_insert on public.movimientos_inventario;

create policy movimientos_inventario_inventario_insert on public.movimientos_inventario
  for insert to authenticated
  with check (
    public.auth_puede_escribir_inventario()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
    and registrado_por = (select auth.uid())
  );

-- Mismo hueco en las de OC/OV que agregó esa migración.
drop policy if exists ordenes_compra_inventario_insert on public.ordenes_compra;
create policy ordenes_compra_inventario_insert on public.ordenes_compra
  for insert to authenticated
  with check (
    public.auth_puede_escribir_inventario()
    and public.auth_suscripcion_permite_escribir()
    and fuente = 'excel'
    and public.empresa_en_alcance(empresa_id)
  );

drop policy if exists ordenes_compra_produccion_insert on public.ordenes_compra;
create policy ordenes_compra_produccion_insert on public.ordenes_compra
  for insert to authenticated
  with check (
    public.auth_rol() = 'produccion'
    and public.auth_suscripcion_permite_escribir()
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB', 'CSC'))
    and public.empresa_en_alcance(empresa_id)
  );

drop policy if exists ordenes_venta_produccion_insert on public.ordenes_venta;
create policy ordenes_venta_produccion_insert on public.ordenes_venta
  for insert to authenticated
  with check (
    public.auth_rol() = 'produccion'
    and public.auth_suscripcion_permite_escribir()
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB', 'CSC'))
    and public.empresa_en_alcance(empresa_id)
  );
