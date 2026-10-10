-- Costeo PEPS y costeo proyectado de lotes (Mario con Jaime, 10-oct-2026):
--   "en el costeo debemos promediar el costo de acuerdo a primeras entradas
--    primeras salidas de stock existente y esto generará un precio para
--    calcular el margen promedio"
--   "en el caso de la segunda programación calcula de una vez el costeo
--    aunque no empiece aún; esto me va a servir para saber a qué precio
--    estaré vendiendo en el futuro"
--
-- PEPS: cada entrada es una capa (fecha, captura); las salidas se comen las
-- capas de la más vieja a la más nueva. Se calcula, no se captura:
--   * v_peps_capas_* : lo que queda de cada capa;
--   * v_peps_salidas_materia_prima : costo PEPS de cada consumo (si las
--     salidas rebasan las entradas, lo que falta va al último costo);
--   * v_stock_* : columnas nuevas costo_peps / valor_peps (existencia actual).
-- El costo de materia prima del lote (v_costeo_orden_produccion) usa el
-- costo PEPS de sus consumos; la partida de remisión congela el costo PEPS
-- de la existencia; fn_lote_costeo_proyectado da el costo de un lote que aún
-- no empieza (receta × cantidad planeada contra las capas que quedan, nómina
-- diaria × días planeados e indirectos capturados) y el precio promedio de
-- venta del producto para el margen.
--
-- Ya aplicado en producción.

create or replace view public.v_peps_capas_materia_prima with (security_invoker = true) as
with e as (
  select m.id, m.materia_prima_id, m.fecha, m.created_at, m.cantidad, m.costo_unitario,
         sum(m.cantidad) over (partition by m.materia_prima_id order by m.fecha, m.created_at, m.id) as hasta
    from public.movimientos_materia_prima m
   where m.tipo = 'entrada' and m.cantidad > 0
),
s as (
  select materia_prima_id, sum(cantidad) as salidas
    from public.movimientos_materia_prima where tipo = 'salida' group by materia_prima_id
)
select e.id as movimiento_id, e.materia_prima_id, e.fecha, e.created_at, e.cantidad, e.costo_unitario,
       e.hasta - e.cantidad as desde, e.hasta,
       greatest(0, least(e.cantidad, e.hasta - coalesce(s.salidas, 0))) as restante
  from e left join s using (materia_prima_id);

create or replace view public.v_peps_capas_producto_terminado with (security_invoker = true) as
with e as (
  select m.id, m.producto_id, m.fecha, m.created_at, m.cantidad, m.costo_unitario,
         sum(m.cantidad) over (partition by m.producto_id order by m.fecha, m.created_at, m.id) as hasta
    from public.movimientos_producto_terminado m
   where m.tipo = 'entrada' and m.cantidad > 0
),
s as (
  select producto_id, sum(cantidad) as salidas
    from public.movimientos_producto_terminado where tipo = 'salida' group by producto_id
)
select e.id as movimiento_id, e.producto_id, e.fecha, e.created_at, e.cantidad, e.costo_unitario,
       e.hasta - e.cantidad as desde, e.hasta,
       greatest(0, least(e.cantidad, e.hasta - coalesce(s.salidas, 0))) as restante
  from e left join s using (producto_id);

create or replace view public.v_peps_salidas_materia_prima with (security_invoker = true) as
with s as (
  select m.id, m.materia_prima_id, m.orden_produccion_id, m.cantidad, m.costo_unitario,
         sum(m.cantidad) over (partition by m.materia_prima_id order by m.fecha, m.created_at, m.id) as hasta
    from public.movimientos_materia_prima m
   where m.tipo = 'salida' and m.cantidad > 0
),
u as (
  select distinct on (materia_prima_id) materia_prima_id, costo_unitario
    from public.movimientos_materia_prima where tipo = 'entrada'
   order by materia_prima_id, fecha desc, created_at desc
),
x as (
  select s.id, s.materia_prima_id, s.orden_produccion_id, s.cantidad, s.costo_unitario as costo_capturado,
         coalesce(sum(greatest(0, least(s.hasta, c.hasta) - greatest(s.hasta - s.cantidad, c.desde)) * c.costo_unitario), 0) as costo_capas,
         coalesce(sum(greatest(0, least(s.hasta, c.hasta) - greatest(s.hasta - s.cantidad, c.desde))), 0) as cubierto
    from s
    left join public.v_peps_capas_materia_prima c
      on c.materia_prima_id = s.materia_prima_id and c.desde < s.hasta and c.hasta > s.hasta - s.cantidad
   group by s.id, s.materia_prima_id, s.orden_produccion_id, s.cantidad, s.costo_unitario
)
select x.id as movimiento_id, x.materia_prima_id, x.orden_produccion_id, x.cantidad, x.costo_capturado,
       round((x.costo_capas + (x.cantidad - x.cubierto) * coalesce(u.costo_unitario, x.costo_capturado, 0)) / x.cantidad, 4) as costo_peps
  from x left join u using (materia_prima_id);

-- Existencias: mismas columnas de antes + costo y valor PEPS de lo que queda.
create or replace view public.v_stock_materia_prima with (security_invoker = true) as
select mp.id as materia_prima_id,
       mp.nombre,
       mp.unidad_medida,
       coalesce(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0) - coalesce(sum(m.cantidad) filter (where m.tipo = 'salida'), 0) as stock_actual,
       round(coalesce(sum(m.cantidad * m.costo_unitario) filter (where m.tipo = 'entrada'), 0) / nullif(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0), 4) as costo_promedio_ponderado,
       mp.empresa_id,
       (select round(sum(c.restante * c.costo_unitario) / nullif(sum(c.restante), 0), 4)
          from public.v_peps_capas_materia_prima c where c.materia_prima_id = mp.id) as costo_peps,
       (select round(coalesce(sum(c.restante * c.costo_unitario), 0), 2)
          from public.v_peps_capas_materia_prima c where c.materia_prima_id = mp.id) as valor_peps
  from public.materias_primas mp
  left join public.movimientos_materia_prima m on m.materia_prima_id = mp.id
 group by mp.id, mp.nombre, mp.unidad_medida, mp.empresa_id;

create or replace view public.v_stock_producto_terminado with (security_invoker = true) as
select p.id as producto_id,
       p.nombre,
       p.tipo,
       p.calibre,
       p.unidad_medida,
       coalesce(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0) - coalesce(sum(m.cantidad) filter (where m.tipo = 'salida'), 0) as stock_actual,
       round(coalesce(sum(m.cantidad * m.costo_unitario) filter (where m.tipo = 'entrada'), 0) / nullif(sum(m.cantidad) filter (where m.tipo = 'entrada'), 0), 4) as costo_promedio_ponderado,
       p.empresa_id,
       (select round(sum(c.restante * c.costo_unitario) / nullif(sum(c.restante), 0), 4)
          from public.v_peps_capas_producto_terminado c where c.producto_id = p.id) as costo_peps,
       (select round(coalesce(sum(c.restante * c.costo_unitario), 0), 2)
          from public.v_peps_capas_producto_terminado c where c.producto_id = p.id) as valor_peps
  from public.productos_produccion p
  left join public.movimientos_producto_terminado m on m.producto_id = p.id
 group by p.id, p.nombre, p.tipo, p.calibre, p.unidad_medida, p.empresa_id;

-- Costeo del lote: la materia prima consumida va a costo PEPS.
create or replace view public.v_costeo_orden_produccion with (security_invoker = true) as
with mp as (
  select orden_produccion_id, sum(cantidad * costo_peps) as costo_materia_prima
    from public.v_peps_salidas_materia_prima
   where orden_produccion_id is not null
   group by orden_produccion_id
),
mo as (
  select orden_produccion_id, sum(costo_total) as costo_mano_obra
    from public.mano_de_obra_produccion
   group by orden_produccion_id
),
nom as (
  select orden_produccion_id, sum(costo) as costo, max(dias) as dias, count(*) as personas, bool_or(estimado) as estimado
    from public.fn_lotes_mano_obra_nomina()
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
  coalesce(mo.costo_mano_obra, 0) + coalesce(nom.costo, 0) as costo_mano_obra,
  coalesce(ci.costo_indirectos, 0) as costo_indirectos,
  coalesce(mp.costo_materia_prima, 0) + coalesce(mo.costo_mano_obra, 0) + coalesce(nom.costo, 0) + coalesce(ci.costo_indirectos, 0) as costo_total,
  round(
    (coalesce(mp.costo_materia_prima, 0) + coalesce(mo.costo_mano_obra, 0) + coalesce(nom.costo, 0) + coalesce(ci.costo_indirectos, 0))
    / nullif(o.cantidad_producida, 0),
    4
  ) as costo_unitario,
  o.empresa_id,
  coalesce(nom.costo, 0) as costo_mano_obra_nomina,
  coalesce(mo.costo_mano_obra, 0) as costo_mano_obra_captura,
  coalesce(nom.dias, 0) as dias_nomina,
  coalesce(nom.personas, 0) as personas_nomina,
  coalesce(nom.estimado, false) as nomina_estimada
from public.ordenes_produccion o
left join mp on mp.orden_produccion_id = o.id
left join mo on mo.orden_produccion_id = o.id
left join nom on nom.orden_produccion_id = o.id
left join ci on ci.orden_produccion_id = o.id;

-- La partida de remisión congela el costo PEPS de la existencia al emitirse.
create or replace function public.remisiones_produccion_lineas_costo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.producto_id is not null and new.costo_unitario is null then
    select coalesce(s.costo_peps, s.costo_promedio_ponderado) into new.costo_unitario
      from public.v_stock_producto_terminado s where s.producto_id = new.producto_id;
  end if;
  return new;
end;
$$;

-- Costeo proyectado de un lote (sirve para uno planeado que aún no empieza).
create or replace function public.fn_lote_costeo_proyectado(p_orden uuid)
returns table (
  cantidad numeric, dias numeric, costo_materia_prima numeric, materia_prima_faltante numeric,
  costo_dia_nomina numeric, costo_mano_obra numeric, costo_indirectos numeric,
  costo_total numeric, costo_unitario numeric, precio_promedio_venta numeric, detalle jsonb
)
language sql stable security definer set search_path = public as $$
  with o as (
    select * from public.ordenes_produccion
     where id = p_orden
       and (auth.uid() is null
            or (public.auth_rol_definer() = any (array['produccion'::app_rol, 'admin'::app_rol, 'corporativo'::app_rol])
                and empresa_id = any (public.auth_empresas_alcance())))
  ),
  req as (
    select ri.materia_prima_id, mp.nombre, ri.cantidad_por_unidad * coalesce(nullif(o.cantidad_producida, 0), o.cantidad_planeada) as requerido
      from o join public.receta_items ri on ri.producto_id = o.producto_id
      join public.materias_primas mp on mp.id = ri.materia_prima_id
  ),
  capas as (
    select c.materia_prima_id, c.restante, c.costo_unitario,
           sum(c.restante) over (partition by c.materia_prima_id order by c.fecha, c.created_at, c.movimiento_id) as acumulado
      from public.v_peps_capas_materia_prima c
     where c.restante > 0 and c.materia_prima_id in (select materia_prima_id from req)
  ),
  ultimo as (
    select distinct on (materia_prima_id) materia_prima_id, costo_unitario
      from public.movimientos_materia_prima
     where tipo = 'entrada' and materia_prima_id in (select materia_prima_id from req)
     order by materia_prima_id, fecha desc, created_at desc
  ),
  mat as (
    select r.materia_prima_id, r.nombre, r.requerido,
           coalesce(sum(greatest(0, least(r.requerido, c.acumulado) - (c.acumulado - c.restante)) * c.costo_unitario), 0) as costo_capas,
           coalesce(sum(greatest(0, least(r.requerido, c.acumulado) - (c.acumulado - c.restante))), 0) as cubierto
      from req r left join capas c on c.materia_prima_id = r.materia_prima_id
     group by r.materia_prima_id, r.nombre, r.requerido
  ),
  mat2 as (
    select m.*, greatest(0, m.requerido - m.cubierto) as faltante,
           m.costo_capas + greatest(0, m.requerido - m.cubierto) * coalesce(u.costo_unitario, 0) as costo
      from mat m left join ultimo u using (materia_prima_id)
  ),
  nom as (
    select coalesce(avg(pago), 0) as costo_dia from (
      select b.fecha, sum(b.pago_dia) as pago
        from o cross join lateral public.fn_nomina_planta_dia_base(o.empresa_id, current_date - 13, current_date) b
       group by b.fecha
    ) d
  ),
  ind as (select coalesce(sum(monto), 0) as monto from public.costos_indirectos_produccion where orden_produccion_id = p_orden),
  venta as (
    select round(sum(l.cantidad * l.precio_unitario) / nullif(sum(l.cantidad), 0), 4) as precio
      from o join public.remisiones_produccion_lineas l on l.producto_id = o.producto_id and l.precio_unitario is not null
      join public.remisiones_produccion r on r.id = l.remision_id and r.tipo = 'salida'
  ),
  tot as (
    select coalesce(nullif(o.cantidad_producida, 0), o.cantidad_planeada) as cantidad,
           coalesce(o.dias_planeados, 0) as dias,
           coalesce((select sum(costo) from mat2), 0) as mp,
           coalesce((select sum(faltante) from mat2), 0) as faltante,
           nom.costo_dia, ind.monto
      from o, nom, ind
  )
  select t.cantidad, t.dias, round(t.mp, 2), round(t.faltante, 4),
         round(t.costo_dia, 2), round(t.costo_dia * t.dias, 2), round(t.monto, 2),
         round(t.mp + t.costo_dia * t.dias + t.monto, 2),
         round((t.mp + t.costo_dia * t.dias + t.monto) / nullif(t.cantidad, 0), 4),
         (select precio from venta),
         coalesce((select jsonb_agg(jsonb_build_object('materia', nombre, 'requerido', round(requerido, 4), 'faltante', round(faltante, 4), 'costo', round(costo, 2)) order by nombre) from mat2), '[]'::jsonb)
    from tot t;
$$;
revoke all on function public.fn_lote_costeo_proyectado(uuid) from public, anon;
grant execute on function public.fn_lote_costeo_proyectado(uuid) to authenticated;
