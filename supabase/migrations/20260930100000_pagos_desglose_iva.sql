-- Desglose de IVA por pago en Tesorería (Mario, 30-sep-2026: "abajo del
-- monto a pagar desglosa el IVA de ese pago").
--
-- El TOTAL del backoffice YA incluye IVA y el costo de cada partida también
-- (pantalla "Pago a Proveedores" del backoffice, OC 41054: subtotal 528.27,
-- IVA 84.52, total 612.79). Así que:
--   api:          iva = Σ partidas con IVA × cantidad × costo × 0.16 / 1.16
--   requisicion:  el costo de la partida es SIN IVA (fn_oc_desde_*):
--                 iva = Σ partidas con IVA × cantidad × costo × 0.16
--   subtotal = total − iva. El total no cambia: es lo que ya se paga.
-- Comprobado al centavo contra la 41054. Si el backoffice llega a mandar
-- Subtotal/IVA en la API, se usan esos campos en lugar de este cálculo.
--
-- Ya aplicado en producción.

create or replace view public.v_oc_importes with (security_invoker = true) as
select oc.id as orden_compra_id,
       coalesce(oc.total, 0) - coalesce(l.iva, 0) as subtotal,
       coalesce(l.iva, 0) as iva,
       coalesce(oc.total, 0) as total
from public.ordenes_compra oc
left join lateral (
  select round(sum(case when x.iva then x.cantidad * x.costo * case when oc.fuente = 'requisicion' then 0.16 else 0.16 / 1.16 end else 0 end), 2) as iva
  from public.ordenes_compra_lineas x where x.orden_compra_id = oc.id
) l on true;
grant select on public.v_oc_importes to authenticated;

create or replace view public.v_pagos_programados with (security_invoker = true) as
select p.id, p.empresa_id, p.cuenta_id, p.beneficiario, p.concepto, p.monto, p.fecha_programada, p.estatus,
       p.pagado_en, p.referencia, p.notas, p.created_by, p.created_at, p.updated_at, p.orden_compra_id, p.metodo,
       p.comprobante_path, p.comprobante_nombre, p.comprobante_en, p.comprobante_por,
       e.nombre as empresa_nombre,
       oc.id_orden,
       oc.proyecto as oc_proyecto,
       public.fn_proveedor_clave(p.beneficiario) as clave,
       db.beneficiario as beneficiario_bancario, db.banco as banco_proveedor, db.clabe, db.cuenta as cuenta_proveedor,
       db.rfc as rfc_proveedor, db.correo as correo_proveedor,
       oc.tipo_pago_backoffice,
       oc.estatus_backoffice,
       oc.condicion_pago,
       imp.subtotal as oc_subtotal,
       imp.iva as oc_iva,
       imp.total as oc_total
from public.pagos_programados p
join public.empresas e on e.id = p.empresa_id
left join public.ordenes_compra oc on oc.id = p.orden_compra_id
left join public.v_oc_importes imp on imp.orden_compra_id = p.orden_compra_id
left join public.proveedores_datos_bancarios db on db.clave = public.fn_proveedor_clave(p.beneficiario);
grant select on public.v_pagos_programados to authenticated;
