-- Módulo Precios Unitarios: renglones calculados como % de la mano de obra.
--
-- La herramienta menor y el equipo de seguridad no se cotizan por cantidad: en
-- la tarjeta estándar entran como un porcentaje del costo de mano de obra del
-- propio análisis. Sin esto, el supervisor tendría que capturar a mano un
-- importe que cambia cada vez que ajusta un rendimiento.

create type pu_base_calculo as enum ('cantidad', 'pct_mano_obra');

alter table pu_analisis_items
  add column base_calculo pu_base_calculo not null default 'cantidad';

comment on column pu_analisis_items.base_calculo is
  'cantidad = renglón normal (aportación x costo). pct_mano_obra = la cantidad se lee como fracción (0.03 = 3%) y se aplica sobre la mano de obra del análisis; el costo del insumo se ignora.';

-- Un renglón porcentual no puede colgar de un análisis básico anidado: se
-- calcula contra la mano de obra de su propia tarjeta.
alter table pu_analisis_items
  add constraint pu_analisis_items_pct_solo_insumo
  check (base_calculo = 'cantidad' or insumo_id is not null);

-- Mano de obra del análisis, ignorando los renglones porcentuales. Existe
-- aparte de fn_pu_explosion_insumos justamente para romper la recursión: la
-- explosión necesita este total para resolver los porcentuales, así que este
-- cálculo no puede depender de la explosión.
create function fn_pu_mano_obra_directa(p_analisis_id uuid, p_fecha date default current_date)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  with recursive arbol as (
    select i.insumo_id, i.analisis_hijo_id, i.costo_congelado,
           (i.cantidad / i.rendimiento) as aportacion, 1 as nivel
    from pu_analisis_items i
    where i.analisis_id = p_analisis_id and i.base_calculo = 'cantidad'

    union all

    select i.insumo_id, i.analisis_hijo_id, i.costo_congelado,
           a.aportacion * (i.cantidad / i.rendimiento), a.nivel + 1
    from pu_analisis_items i
    join arbol a on i.analisis_id = a.analisis_hijo_id
    where i.base_calculo = 'cantidad' and a.nivel < 10
  )
  select round(coalesce(sum(
    arbol.aportacion * coalesce(arbol.costo_congelado, fn_pu_costo_insumo(arbol.insumo_id, e.empresa_id, p_fecha), 0)
  ), 0), 4)
  from arbol
  join pu_insumos ins on ins.id = arbol.insumo_id and ins.tipo = 'mano_obra'
  cross join lateral (select a.empresa_id from pu_analisis a where a.id = p_analisis_id) e
$$;

comment on function fn_pu_mano_obra_directa is
  'Base de cálculo de los renglones porcentuales: incluye la mano de obra de las cuadrillas anidadas, excluye los porcentuales mismos.';

-- Explosión reescrita: ahora arrastra el análisis dueño de cada renglón y el
-- multiplicador de la rama, para poder resolver los porcentuales contra la mano
-- de obra de SU tarjeta y no la de la raíz.
create or replace function fn_pu_explosion_insumos(p_analisis_id uuid, p_fecha date default current_date)
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
      i.analisis_id,
      i.insumo_id,
      i.analisis_hijo_id,
      i.costo_congelado,
      i.base_calculo,
      i.cantidad,
      i.rendimiento,
      1::numeric as multiplicador,
      1 as nivel
    from pu_analisis_items i
    where i.analisis_id = p_analisis_id

    union all

    select
      i.analisis_id,
      i.insumo_id,
      i.analisis_hijo_id,
      i.costo_congelado,
      i.base_calculo,
      i.cantidad,
      i.rendimiento,
      a.multiplicador * (a.cantidad / a.rendimiento),
      a.nivel + 1
    from pu_analisis_items i
    join arbol a on i.analisis_id = a.analisis_hijo_id
    where a.base_calculo = 'cantidad' and a.nivel < 10
  )
  select
    arbol.insumo_id,
    ins.tipo,
    case
      when arbol.base_calculo = 'pct_mano_obra' then arbol.multiplicador * arbol.cantidad
      else arbol.multiplicador * (arbol.cantidad / arbol.rendimiento)
    end,
    v.costo,
    round(
      case
        when arbol.base_calculo = 'pct_mano_obra'
          then arbol.multiplicador * arbol.cantidad * v.costo
        else arbol.multiplicador * (arbol.cantidad / arbol.rendimiento) * v.costo
      end, 4)
  from arbol
  join pu_insumos ins on ins.id = arbol.insumo_id
  cross join lateral (select a.empresa_id from pu_analisis a where a.id = p_analisis_id) e
  cross join lateral (
    select case
      when arbol.base_calculo = 'pct_mano_obra'
        then fn_pu_mano_obra_directa(arbol.analisis_id, p_fecha)
      else coalesce(arbol.costo_congelado, fn_pu_costo_insumo(arbol.insumo_id, e.empresa_id, p_fecha), 0)
    end as costo
  ) v
  where arbol.insumo_id is not null
$$;

drop view v_pu_analisis_detalle;

create view v_pu_analisis_detalle with (security_invoker = true) as
select
  i.id as item_id,
  i.analisis_id,
  i.orden,
  i.base_calculo,
  coalesce(ins.codigo, hijo.codigo) as codigo,
  coalesce(ins.descripcion, hijo.concepto) as descripcion,
  case when i.base_calculo = 'pct_mano_obra' then '%' else coalesce(ins.unidad, hijo.unidad) end as unidad,
  coalesce(ins.tipo, 'auxiliar'::pu_tipo_insumo) as tipo,
  i.cantidad,
  i.rendimiento,
  case
    when i.base_calculo = 'pct_mano_obra' then i.cantidad
    else round(i.cantidad / i.rendimiento, 6)
  end as aportacion,
  coalesce(c.costo, 0) as costo_unitario,
  round(
    case
      when i.base_calculo = 'pct_mano_obra' then i.cantidad
      else i.cantidad / i.rendimiento
    end * coalesce(c.costo, 0), 4) as importe,
  i.costo_congelado is not null as costo_cerrado,
  c.costo is null as sin_precio
from pu_analisis_items i
join pu_analisis a on a.id = i.analisis_id
left join pu_insumos ins on ins.id = i.insumo_id
left join pu_analisis hijo on hijo.id = i.analisis_hijo_id
cross join lateral (
  select case
    when i.base_calculo = 'pct_mano_obra' then fn_pu_mano_obra_directa(a.id)
    else coalesce(
      i.costo_congelado,
      case
        when i.insumo_id is not null then fn_pu_costo_insumo(i.insumo_id, a.empresa_id)
        else fn_pu_costo_directo(i.analisis_hijo_id)
      end
    )
  end as costo
) c;

comment on view v_pu_analisis_detalle is
  'Renglones de la tarjeta con su costo resuelto, listos para imprimir. En un renglón porcentual, aportacion es la fracción y costo_unitario la mano de obra base. sin_precio marca el insumo que nunca se ha cotizado: se cuenta como cero pero hay que avisarlo, si no el PU sale barato por omisión.';

grant select on v_pu_analisis_detalle to authenticated;