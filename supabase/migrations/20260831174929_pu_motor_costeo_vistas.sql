-- Módulo Precios Unitarios: motor de costeo y vistas de consulta.
--
-- El costo directo NUNCA se guarda en una columna: se recalcula de la explosión
-- de insumos. Mismo criterio que v_stock_materia_prima -- un total guardado se
-- desincroniza el día que alguien corrige una cantidad y nadie recuerda
-- recalcular.

-- Explota un análisis hasta sus insumos hoja, arrastrando la aportación
-- acumulada a través de los análisis básicos anidados.
create function fn_pu_explosion_insumos(p_analisis_id uuid, p_fecha date default current_date)
returns table (
  insumo_id uuid,
  tipo pu_tipo_insumo,
  aportacion numeric,
  costo_unitario numeric,
  importe numeric
)
language sql
stable
set search_path to 'public'
as $$
  with recursive arbol as (
    select
      i.insumo_id,
      i.analisis_hijo_id,
      i.costo_congelado,
      (i.cantidad / i.rendimiento) as aportacion,
      1 as nivel
    from pu_analisis_items i
    where i.analisis_id = p_analisis_id

    union all

    select
      i.insumo_id,
      i.analisis_hijo_id,
      i.costo_congelado,
      a.aportacion * (i.cantidad / i.rendimiento),
      a.nivel + 1
    from pu_analisis_items i
    join arbol a on i.analisis_id = a.analisis_hijo_id
    where a.nivel < 10
  )
  select
    arbol.insumo_id,
    ins.tipo,
    arbol.aportacion,
    coalesce(arbol.costo_congelado, fn_pu_costo_insumo(arbol.insumo_id, e.empresa_id, p_fecha), 0),
    round(arbol.aportacion * coalesce(arbol.costo_congelado, fn_pu_costo_insumo(arbol.insumo_id, e.empresa_id, p_fecha), 0), 4)
  from arbol
  join pu_insumos ins on ins.id = arbol.insumo_id
  cross join lateral (select a.empresa_id from pu_analisis a where a.id = p_analisis_id) e
  where arbol.insumo_id is not null
$$;

comment on function fn_pu_explosion_insumos is
  'Insumos hoja de un análisis con su aportación acumulada. Corta a 10 niveles: el trigger de ciclos ya impide la recursión infinita, este límite es el cinturón de seguridad por si un básico se anida absurdamente hondo.';

create function fn_pu_costo_directo(p_analisis_id uuid, p_fecha date default current_date)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select round(coalesce(sum(importe), 0), 4)
  from fn_pu_explosion_insumos(p_analisis_id, p_fecha)
$$;

comment on function fn_pu_costo_directo is
  'Costo directo del análisis. Un análisis básico anidado entra a costo directo, sin factores: cargarle sobrecosto ahí y otra vez arriba cobraría los indirectos dos veces.';

-- Renglones tal como se imprimen en la tarjeta: un básico anidado se muestra
-- como UN renglón a su costo directo, no explotado.
create view v_pu_analisis_detalle with (security_invoker = true) as
select
  i.id as item_id,
  i.analisis_id,
  i.orden,
  coalesce(ins.codigo, hijo.codigo) as codigo,
  coalesce(ins.descripcion, hijo.concepto) as descripcion,
  coalesce(ins.unidad, hijo.unidad) as unidad,
  coalesce(ins.tipo, 'auxiliar'::pu_tipo_insumo) as tipo,
  i.cantidad,
  i.rendimiento,
  round(i.cantidad / i.rendimiento, 6) as aportacion,
  coalesce(c.costo, 0) as costo_unitario,
  round((i.cantidad / i.rendimiento) * coalesce(c.costo, 0), 4) as importe,
  i.costo_congelado is not null as costo_cerrado,
  c.costo is null as sin_precio
from pu_analisis_items i
join pu_analisis a on a.id = i.analisis_id
left join pu_insumos ins on ins.id = i.insumo_id
left join pu_analisis hijo on hijo.id = i.analisis_hijo_id
cross join lateral (
  select coalesce(
    i.costo_congelado,
    case
      when i.insumo_id is not null then fn_pu_costo_insumo(i.insumo_id, a.empresa_id)
      else fn_pu_costo_directo(i.analisis_hijo_id)
    end
  ) as costo
) c;

comment on view v_pu_analisis_detalle is
  'Renglones de la tarjeta con su costo resuelto. sin_precio marca el insumo que nunca se ha cotizado: se cuenta como cero pero hay que avisarlo, si no el PU sale barato por omisión.';

-- Tarjeta completa: costo directo, desglose por tipo y aplicación en cascada de
-- los factores de sobrecosto.
create view v_pu_analisis_costeo with (security_invoker = true) as
select
  a.id as analisis_id,
  a.empresa_id,
  e.codigo as empresa_codigo,
  e.nombre as empresa_nombre,
  a.proyecto_id,
  py.nombre as proyecto_nombre,
  a.codigo,
  a.concepto,
  a.unidad,
  a.es_auxiliar,
  a.estado,
  a.creado_por,
  perfil.nombre as creado_por_nombre,
  f.nombre as factor_nombre,
  fx.indirectos_pct,
  fx.financiamiento_pct,
  fx.utilidad_pct,
  fx.cargos_adicionales_pct,
  d.costo_directo,
  t.importe_material,
  t.importe_mano_obra,
  t.importe_equipo,
  round(d.costo_directo * fx.indirectos_pct, 2) as importe_indirectos,
  round(b.base_financiamiento * fx.financiamiento_pct, 2) as importe_financiamiento,
  round(b.base_utilidad * fx.utilidad_pct, 2) as importe_utilidad,
  round(b.base_cargos * fx.cargos_adicionales_pct, 2) as importe_cargos_adicionales,
  round(b.base_cargos * (1 + fx.cargos_adicionales_pct), 2) as precio_unitario,
  t.insumos_sin_precio,
  a.updated_at
from pu_analisis a
join empresas e on e.id = a.empresa_id
left join proyectos py on py.id = a.proyecto_id
left join profiles perfil on perfil.id = a.creado_por
left join pu_factores f on f.id = a.factor_id
cross join lateral (select fn_pu_costo_directo(a.id) as costo_directo) d
cross join lateral (
  -- Un análisis básico no lleva factores: su "precio" es su costo directo.
  select
    case when a.es_auxiliar then 0 else coalesce(f.indirectos_pct, 0) end as indirectos_pct,
    case when a.es_auxiliar then 0 else coalesce(f.financiamiento_pct, 0) end as financiamiento_pct,
    case when a.es_auxiliar then 0 else coalesce(f.utilidad_pct, 0) end as utilidad_pct,
    case when a.es_auxiliar then 0 else coalesce(f.cargos_adicionales_pct, 0) end as cargos_adicionales_pct
) fx
cross join lateral (
  select
    d.costo_directo * (1 + fx.indirectos_pct) as base_financiamiento,
    d.costo_directo * (1 + fx.indirectos_pct) * (1 + fx.financiamiento_pct) as base_utilidad,
    d.costo_directo * (1 + fx.indirectos_pct) * (1 + fx.financiamiento_pct) * (1 + fx.utilidad_pct) as base_cargos
) b
left join lateral (
  select
    coalesce(sum(x.importe) filter (where x.tipo = 'material'), 0) as importe_material,
    coalesce(sum(x.importe) filter (where x.tipo = 'mano_obra'), 0) as importe_mano_obra,
    coalesce(sum(x.importe) filter (where x.tipo in ('herramienta', 'equipo')), 0) as importe_equipo,
    count(*) filter (where x.costo_unitario = 0) as insumos_sin_precio
  from fn_pu_explosion_insumos(a.id) x
) t on true;

comment on view v_pu_analisis_costeo is
  'Precio unitario terminado. Los factores se aplican en cascada (indirectos, financiamiento, utilidad, cargos adicionales), no sumados sobre el costo directo -- es el criterio de la Ley de Obras Públicas y el que usan las dependencias al revisar.';

-- El consultable del supervisor: lo único descargable en PDF.
create view v_pu_publicados with (security_invoker = true) as
select c.*
from v_pu_analisis_costeo c
where c.estado = 'publicado';

comment on view v_pu_publicados is
  'Lo que el supervisor ve y descarga desde su celular. Filtra por etapa, no por permisos: RLS ya limitó las filas a sus obras.';

grant select on v_pu_analisis_detalle to authenticated;
grant select on v_pu_analisis_costeo to authenticated;
grant select on v_pu_publicados to authenticated;