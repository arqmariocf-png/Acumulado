-- Integración "OC/OV compartidas" (punto confirmado con el usuario): la
-- planta NO crea su propio catálogo de compras/ventas -- usa las MISMAS
-- filas de ordenes_compra/ordenes_venta que ya concilia el motor de
-- bancos (sección 4.1 del SPEC.md), solo se les agrega a qué materia
-- prima/producto corresponden. Columnas nullable: las otras 7 empresas
-- del grupo las dejan en NULL, no rompe nada existente.
alter table public.ordenes_compra
  add column materia_prima_id uuid references public.materias_primas (id);

alter table public.ordenes_venta
  add column producto_id uuid references public.productos_produccion (id);

comment on column public.ordenes_compra.materia_prima_id is 'Solo aplica a la empresa Mallas y Clavos Clavicón (MCC) -- a qué materia prima corresponde esta compra, para poder registrar la entrada de inventario contra una OC real en vez de capturarla dos veces.';
comment on column public.ordenes_venta.producto_id is 'Solo aplica a la empresa Mallas y Clavos Clavicón (MCC) -- a qué producto terminado corresponde esta venta, para poder registrar la salida de inventario contra una OV real en vez de capturarla dos veces.';

-- rol='produccion' puede INSERTAR en ordenes_compra/ordenes_venta, pero
-- SOLO para la empresa Clavicón -- no se toca el helper compartido
-- auth_puede_escribir() porque eso le daría a producción permiso de
-- editar movimientos bancarios y CFDI de las 8 empresas, cosa que no se
-- pidió (mismo aislamiento financiero que ya tiene 'rh', sección 6 del
-- spec). Sigue sin poder ver/editar movimientos ni cfdi de ninguna
-- empresa: esas tablas no tienen policy para 'produccion'.
create policy ordenes_compra_produccion_insert on public.ordenes_compra
  for insert
  with check (
    public.auth_rol() = 'produccion'
    and empresa_id = (select id from public.empresas where codigo = 'MCC')
  );

create policy ordenes_venta_produccion_insert on public.ordenes_venta
  for insert
  with check (
    public.auth_rol() = 'produccion'
    and empresa_id = (select id from public.empresas where codigo = 'MCC')
  );

-- rol='produccion' también necesita LEER el catálogo de OC/OV de Clavicón
-- para poder vincular una compra/venta ya cargada por tesorería (vía API
-- o Excel) en vez de crear una nueva -- evita el doble registro que pide
-- la integración.
create policy ordenes_compra_produccion_select on public.ordenes_compra
  for select
  using (
    public.auth_rol() = 'produccion'
    and empresa_id = (select id from public.empresas where codigo = 'MCC')
  );

create policy ordenes_venta_produccion_select on public.ordenes_venta
  for select
  using (
    public.auth_rol() = 'produccion'
    and empresa_id = (select id from public.empresas where codigo = 'MCC')
  );
