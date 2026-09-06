-- El proveedor con el que almacén autorizó el precio se imprime bajo el
-- renglón en la tarjeta: sin él, el PDF no dice contra quién se cerró el costo.
create or replace view v_pu_analisis_detalle with (security_invoker = true) as
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
  c.costo is null as sin_precio,
  i.proveedor,
  i.precio_autorizado_en
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