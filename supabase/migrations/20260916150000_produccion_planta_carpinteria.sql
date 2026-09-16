-- Tercera planta en el módulo de Producción y Costeo: el taller de
-- carpintería. En el grupo ese negocio se lleva bajo Constructora,
-- Supervisión y Consultoría LOMA (CSC) -- es el proyecto "TALLER
-- CARPINTERIA" de esa empresa -- así que la planta usa empresa_id = CSC
-- sin necesidad de dar de alta una empresa nueva.
--
-- Lo que cambia respecto a 20260916140000_produccion_por_planta_balken:
-- 1. Tipos de producto propios de carpintería.
-- 2. Las políticas de OC/OV para el rol produccion aceptan también CSC
--    (siguen acotadas a la empresa del usuario vía auth_empresa_id()).
-- auth_ve_planta()/auth_opera_planta() no listan códigos de empresa, así
-- que las tablas materias_primas/productos_produccion/ordenes_produccion
-- ya funcionan para CSC sin tocar nada más.

-- ============================================================
-- 1. Tipos de producto de carpintería
-- ============================================================
alter table public.productos_produccion drop constraint productos_produccion_tipo_check;
alter table public.productos_produccion
  add constraint productos_produccion_tipo_check
  check (tipo in (
    'malla_armex', 'clavo',                  -- Clavicón
    'vigueta', 'bovedilla', 'bloque',        -- Balken
    'puerta', 'closet', 'cocina', 'mueble'   -- Carpintería
  ));

-- ============================================================
-- 2. OC/OV compartidas: ahora para las tres plantas
-- ============================================================
drop policy ordenes_compra_produccion_insert on public.ordenes_compra;
drop policy ordenes_compra_produccion_select on public.ordenes_compra;
drop policy ordenes_venta_produccion_insert on public.ordenes_venta;
drop policy ordenes_venta_produccion_select on public.ordenes_venta;

create policy ordenes_compra_produccion_insert on public.ordenes_compra
  for insert with check (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB', 'CSC'))
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );
create policy ordenes_compra_produccion_select on public.ordenes_compra
  for select using (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB', 'CSC'))
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );
create policy ordenes_venta_produccion_insert on public.ordenes_venta
  for insert with check (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB', 'CSC'))
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );
create policy ordenes_venta_produccion_select on public.ordenes_venta
  for select using (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB', 'CSC'))
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );
