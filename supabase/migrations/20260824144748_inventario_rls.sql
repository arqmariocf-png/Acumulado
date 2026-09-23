-- RLS de inventario -- mismo patrón que cuentas_bancarias/ordenes_compra
-- (20260816090009_rls_policies.sql): 'pendiente' sin acceso, corporativo/
-- admin/dirección-sin-empresa ven las 8 empresas, 'empresa' solo la suya.

alter table public.almacenes enable row level security;

create policy almacenes_select on public.almacenes
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy almacenes_write on public.almacenes
  for all
  using (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  )
  with check (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter table public.productos enable row level security;

create policy productos_select on public.productos
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy productos_write on public.productos
  for all
  using (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  )
  with check (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter table public.movimientos_inventario enable row level security;

create policy movimientos_inventario_select on public.movimientos_inventario
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

-- Igual que archivos_cargados: además del alcance de empresa, un movimiento
-- solo se puede insertar a nombre de quien lo captura (nunca a nombre de
-- otro usuario), y no se permite update/delete directo desde el cliente --
-- es historial de almacén, una corrección se hace con un movimiento nuevo
-- (ajuste), no reescribiendo el pasado.
create policy movimientos_inventario_insert on public.movimientos_inventario
  for insert
  with check (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
    and registrado_por = auth.uid()
  );
