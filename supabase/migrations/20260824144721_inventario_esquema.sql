-- Módulo de Inventario: entradas/salidas de almacén, con lectura de código
-- de barras y "match" contra el catálogo de OC (compras) y OV (ventas) que
-- ya existe para la conciliación bancaria. Decisiones del cliente
-- (2026-08-24): un almacén por empresa por ahora (el esquema ya soporta
-- varios si se necesita después), y el match aplica tanto a entradas (vs
-- OC) como a salidas (vs OV).

create type public.tipo_movimiento_inventario as enum ('entrada', 'salida');

-- Un almacén por empresa hoy, pero modelado como tabla propia (no una
-- columna en empresas) para no tener que migrar el esquema el día que se
-- necesite más de uno por empresa (varias obras/sucursales).
create table public.almacenes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  nombre text not null default 'Almacén principal',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create index almacenes_empresa_idx on public.almacenes (empresa_id);

-- Catálogo de productos. codigo_barras es opcional (no todo lo que entra a
-- un almacén de construcción trae barras de fábrica) pero cuando existe
-- debe ser único dentro de la empresa, para que el escaneo resuelva sin
-- ambigüedad a un solo producto.
create table public.productos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  sku text not null,
  codigo_barras text,
  nombre text not null,
  descripcion text,
  unidad_medida text not null default 'PZA',
  costo_referencia numeric(14, 2),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, sku)
);

create index productos_empresa_idx on public.productos (empresa_id);

-- Único parcial (ignora NULL) en vez de UNIQUE de columna: varios productos
-- de la misma empresa pueden no tener código de barras todavía.
create unique index productos_codigo_barras_idx on public.productos (empresa_id, codigo_barras) where codigo_barras is not null;

create trigger productos_set_updated_at
  before update on public.productos
  for each row
  execute function public.set_updated_at();

-- Historial de entradas/salidas de almacén -- la existencia (stock) NUNCA
-- se guarda como contador aparte, siempre se calcula de este historial (ver
-- vista `existencias` en la siguiente migración), mismo criterio que ya usa
-- este proyecto para `saldo` en cuentas bancarias.
--
-- El "match" con el acumulado es la referencia opcional a una orden de
-- compra (entradas) o de venta (salidas) ya cargada en `ordenes_compra` /
-- `ordenes_venta`. Como esos catálogos hoy solo traen el total en dinero de
-- la orden (no detalle de línea por producto -- ver TODO en
-- _shared/ingesta/oc-ov.ts sobre `api_ocs_det_aut`), el match se hace por
-- monto acumulado (cantidad × costo_unitario de los movimientos vinculados)
-- contra el total de la orden, no por línea -- de ahí que costo_unitario
-- sea obligatorio en cualquier movimiento que sí se vincule a una orden.
create table public.movimientos_inventario (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  almacen_id uuid not null references public.almacenes (id),
  producto_id uuid not null references public.productos (id),
  tipo public.tipo_movimiento_inventario not null,
  cantidad numeric(14, 3) not null check (cantidad > 0),
  costo_unitario numeric(14, 2),
  fecha date not null default current_date,
  orden_compra_id uuid references public.ordenes_compra (id),
  orden_venta_id uuid references public.ordenes_venta (id),
  es_ajuste boolean not null default false,
  codigo_escaneado text,
  comentario text,
  registrado_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  -- Una entrada solo puede casar con una OC (nunca con una OV) y viceversa.
  constraint movimientos_inventario_match_tipo_check check (
    (tipo = 'entrada' and orden_venta_id is null)
    or (tipo = 'salida' and orden_compra_id is null)
  ),
  -- Un ajuste (conteo físico, merma, etc.) nunca representa una compra/venta
  -- real, así que no debe quedar vinculado a ninguna orden.
  constraint movimientos_inventario_ajuste_check check (
    not es_ajuste or (orden_compra_id is null and orden_venta_id is null)
  ),
  -- El match es por monto -- sin costo_unitario no se puede acumular contra
  -- el total de la orden, así que se exige en cuanto se vincula una.
  constraint movimientos_inventario_costo_para_match_check check (
    (orden_compra_id is null and orden_venta_id is null) or costo_unitario is not null
  )
);

create index movimientos_inventario_producto_idx on public.movimientos_inventario (producto_id, fecha);
create index movimientos_inventario_empresa_idx on public.movimientos_inventario (empresa_id, fecha);
create index movimientos_inventario_oc_idx on public.movimientos_inventario (orden_compra_id) where orden_compra_id is not null;
create index movimientos_inventario_ov_idx on public.movimientos_inventario (orden_venta_id) where orden_venta_id is not null;

-- Blinda el aislamiento por empresa a nivel de dato (no solo RLS): un
-- movimiento nunca debe poder apuntar a un almacén/producto/OC/OV de otra
-- empresa, ni aunque quien lo capture tenga rol corporativo/admin y por lo
-- tanto RLS lo dejaría escribir en cualquier empresa.
create or replace function public.validar_empresa_movimiento_inventario()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.almacenes where id = new.almacen_id and empresa_id = new.empresa_id) then
    raise exception 'El almacén no pertenece a la empresa del movimiento';
  end if;
  if not exists (select 1 from public.productos where id = new.producto_id and empresa_id = new.empresa_id) then
    raise exception 'El producto no pertenece a la empresa del movimiento';
  end if;
  if new.orden_compra_id is not null
    and not exists (select 1 from public.ordenes_compra where id = new.orden_compra_id and empresa_id = new.empresa_id) then
    raise exception 'La orden de compra no pertenece a la empresa del movimiento';
  end if;
  if new.orden_venta_id is not null
    and not exists (select 1 from public.ordenes_venta where id = new.orden_venta_id and empresa_id = new.empresa_id) then
    raise exception 'La orden de venta no pertenece a la empresa del movimiento';
  end if;
  return new;
end;
$$;

create trigger movimientos_inventario_validar_empresa
  before insert or update on public.movimientos_inventario
  for each row
  execute function public.validar_empresa_movimiento_inventario();
