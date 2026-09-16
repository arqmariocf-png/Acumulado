-- Producción por planta: segunda planta del grupo, Vigueta Bovedilla y
-- Bloques Balken (empresa VBB), en el MISMO módulo de Producción y Costeo
-- que ya usa Mallas y Clavos Clavicón (MCC). En vez de duplicar tablas y
-- vistas por planta, los catálogos y las órdenes llevan empresa_id y todo
-- lo demás (receta, consumo, mano de obra, indirectos, movimientos) cuelga
-- de ellos -- una sola lógica de costeo para las dos plantas.
--
-- Las tablas estaban vacías al aplicar esto; el backfill a MCC es solo por
-- si acaso, para poder fijar NOT NULL sin condicionar.

-- ============================================================
-- 1. Cada catálogo y cada lote pertenece a una planta
-- ============================================================
alter table public.materias_primas add column empresa_id uuid references public.empresas (id);
alter table public.productos_produccion add column empresa_id uuid references public.empresas (id);
alter table public.ordenes_produccion add column empresa_id uuid references public.empresas (id);

update public.materias_primas set empresa_id = (select id from public.empresas where codigo = 'MCC') where empresa_id is null;
update public.productos_produccion set empresa_id = (select id from public.empresas where codigo = 'MCC') where empresa_id is null;
update public.ordenes_produccion set empresa_id = (select id from public.empresas where codigo = 'MCC') where empresa_id is null;

alter table public.materias_primas alter column empresa_id set not null;
alter table public.productos_produccion alter column empresa_id set not null;
alter table public.ordenes_produccion alter column empresa_id set not null;

create index materias_primas_empresa_idx on public.materias_primas (empresa_id);
create index productos_produccion_empresa_idx on public.productos_produccion (empresa_id);
create index ordenes_produccion_empresa_idx on public.ordenes_produccion (empresa_id);

-- Lo que fabrica Balken: vigueta y bovedilla para losa, y bloque. Sigue
-- siendo texto libre en calibre/presentación (ej. "vigueta 12 cm x 3.00 m",
-- "bovedilla 15x20x56") -- igual que malla/clavo, sin tocar el esquema por
-- cada variante nueva.
alter table public.productos_produccion drop constraint productos_produccion_tipo_check;
alter table public.productos_produccion
  add constraint productos_produccion_tipo_check
  check (tipo in ('malla_armex', 'clavo', 'vigueta', 'bovedilla', 'bloque'));

-- ============================================================
-- 2. Quién ve / opera cada planta
-- ============================================================
-- Un usuario 'produccion' con empresa_id en su perfil solo ve su planta;
-- sin empresa_id ve las dos (mismo criterio que auth_ve_todas_empresas
-- para los roles financieros). admin/corporativo ven todo; corporativo
-- solo lee (el costeo consolidado es reporte financiero, no captura).
create or replace function public.auth_ve_planta(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_rol() in ('admin', 'corporativo')
    or (public.auth_rol() = 'produccion' and (public.auth_empresa_id() is null or public.auth_empresa_id() = p_empresa_id))
$$;

create or replace function public.auth_opera_planta(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_rol() = 'admin'
    or (public.auth_rol() = 'produccion' and (public.auth_empresa_id() is null or public.auth_empresa_id() = p_empresa_id))
$$;

revoke execute on function public.auth_ve_planta(uuid) from anon;
revoke execute on function public.auth_opera_planta(uuid) from anon;

drop policy materias_primas_select on public.materias_primas;
drop policy materias_primas_write on public.materias_primas;
create policy materias_primas_select on public.materias_primas
  for select using (public.auth_ve_planta(empresa_id));
create policy materias_primas_write on public.materias_primas
  for all using (public.auth_opera_planta(empresa_id)) with check (public.auth_opera_planta(empresa_id));

drop policy productos_produccion_select on public.productos_produccion;
drop policy productos_produccion_write on public.productos_produccion;
create policy productos_produccion_select on public.productos_produccion
  for select using (public.auth_ve_planta(empresa_id));
create policy productos_produccion_write on public.productos_produccion
  for all using (public.auth_opera_planta(empresa_id)) with check (public.auth_opera_planta(empresa_id));

drop policy ordenes_produccion_select on public.ordenes_produccion;
drop policy ordenes_produccion_write on public.ordenes_produccion;
create policy ordenes_produccion_select on public.ordenes_produccion
  for select using (public.auth_ve_planta(empresa_id));
create policy ordenes_produccion_write on public.ordenes_produccion
  for all using (public.auth_opera_planta(empresa_id)) with check (public.auth_opera_planta(empresa_id));

-- Las tablas hijas (receta, mano de obra, indirectos, movimientos) siguen
-- con su policy por rol: en la app solo se llega a ellas a través del
-- producto/lote de la planta, que ya filtra arriba.

-- ============================================================
-- 3. OC/OV compartidas: ahora para las dos plantas
-- ============================================================
drop policy ordenes_compra_produccion_insert on public.ordenes_compra;
drop policy ordenes_compra_produccion_select on public.ordenes_compra;
drop policy ordenes_venta_produccion_insert on public.ordenes_venta;
drop policy ordenes_venta_produccion_select on public.ordenes_venta;

create policy ordenes_compra_produccion_insert on public.ordenes_compra
  for insert with check (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB'))
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );
create policy ordenes_compra_produccion_select on public.ordenes_compra
  for select using (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB'))
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );
create policy ordenes_venta_produccion_insert on public.ordenes_venta
  for insert with check (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB'))
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );
create policy ordenes_venta_produccion_select on public.ordenes_venta
  for select using (
    public.auth_rol() = 'produccion'
    and empresa_id in (select id from public.empresas where codigo in ('MCC', 'VBB'))
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );

-- ============================================================
-- 4. Vistas: exponen empresa_id (columna nueva al final, para poder usar
--    create or replace sin recrear dependientes)
-- ============================================================
create or replace view public.v_stock_materia_prima with (security_invoker = true) as
select
  mp.id as materia_prima_id,
  mp.nombre,
  mp.unidad_medida,
  coalesce(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0)
    - coalesce(sum(m.cantidad) filter (where m.tipo = 'salida'), 0) as stock_actual,
  round(
    coalesce(sum(m.cantidad * m.costo_unitario) filter (where m.tipo = 'entrada'), 0)
    / nullif(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0),
    4
  ) as costo_promedio_ponderado,
  mp.empresa_id
from public.materias_primas mp
left join public.movimientos_materia_prima m on m.materia_prima_id = mp.id
group by mp.id, mp.nombre, mp.unidad_medida, mp.empresa_id;

create or replace view public.v_stock_producto_terminado with (security_invoker = true) as
select
  p.id as producto_id,
  p.nombre,
  p.tipo,
  p.calibre,
  p.unidad_medida,
  coalesce(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0)
    - coalesce(sum(m.cantidad) filter (where m.tipo = 'salida'), 0) as stock_actual,
  round(
    coalesce(sum(m.cantidad * m.costo_unitario) filter (where m.tipo = 'entrada'), 0)
    / nullif(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0),
    4
  ) as costo_promedio_ponderado,
  p.empresa_id
from public.productos_produccion p
left join public.movimientos_producto_terminado m on m.producto_id = p.id
group by p.id, p.nombre, p.tipo, p.calibre, p.unidad_medida, p.empresa_id;

create or replace view public.v_costeo_orden_produccion with (security_invoker = true) as
with mp as (
  select orden_produccion_id, sum(cantidad * costo_unitario) as costo_materia_prima
  from public.movimientos_materia_prima
  where tipo = 'salida' and orden_produccion_id is not null
  group by orden_produccion_id
),
mo as (
  select orden_produccion_id, sum(costo_total) as costo_mano_obra
  from public.mano_de_obra_produccion
  group by orden_produccion_id
),
ci as (
  select orden_produccion_id, sum(monto) as costo_indirectos
  from public.costos_indirectos_produccion
  group by orden_produccion_id
)
select
  o.id as orden_produccion_id,
  o.folio,
  o.producto_id,
  o.estado,
  o.fecha_inicio,
  o.fecha_fin,
  o.cantidad_planeada,
  o.cantidad_producida,
  o.cantidad_merma,
  coalesce(mp.costo_materia_prima, 0) as costo_materia_prima,
  coalesce(mo.costo_mano_obra, 0) as costo_mano_obra,
  coalesce(ci.costo_indirectos, 0) as costo_indirectos,
  coalesce(mp.costo_materia_prima, 0) + coalesce(mo.costo_mano_obra, 0) + coalesce(ci.costo_indirectos, 0) as costo_total,
  round(
    (coalesce(mp.costo_materia_prima, 0) + coalesce(mo.costo_mano_obra, 0) + coalesce(ci.costo_indirectos, 0))
    / nullif(o.cantidad_producida, 0),
    4
  ) as costo_unitario,
  o.empresa_id
from public.ordenes_produccion o
left join mp on mp.orden_produccion_id = o.id
left join mo on mo.orden_produccion_id = o.id
left join ci on ci.orden_produccion_id = o.id;

-- El costeo mensual deja de ser "de Clavicón": es por planta. Nombre
-- nuevo porque cambian las columnas de inicio (empresa) y create or
-- replace no lo permite; nadie más que Produccion.tsx y el Dashboard la
-- consumían.
drop view public.v_costeo_mensual_clavicon;

create view public.v_costeo_mensual_planta with (security_invoker = true) as
select
  o.empresa_id,
  e.codigo as empresa_codigo,
  e.nombre as empresa_nombre,
  p.id as producto_id,
  p.nombre as producto_nombre,
  p.tipo as producto_tipo,
  extract(year from coalesce(o.fecha_fin, o.fecha_inicio))::int as anio,
  extract(month from coalesce(o.fecha_fin, o.fecha_inicio))::int as mes,
  count(*) as lotes,
  sum(o.cantidad_producida) as cantidad_producida,
  sum(c.costo_total) as costo_total,
  round(sum(c.costo_total) / nullif(sum(o.cantidad_producida), 0), 4) as costo_unitario_promedio
from public.ordenes_produccion o
join public.empresas e on e.id = o.empresa_id
join public.productos_produccion p on p.id = o.producto_id
join public.v_costeo_orden_produccion c on c.orden_produccion_id = o.id
where o.estado = 'terminada'
group by o.empresa_id, e.codigo, e.nombre, p.id, p.nombre, p.tipo,
  extract(year from coalesce(o.fecha_fin, o.fecha_inicio)), extract(month from coalesce(o.fecha_fin, o.fecha_inicio));
