-- Tesorería: "cómo se paga" sale de la OC (Mario, 29-sep-2026: "estos pagos
-- no tienen la información de cómo y a dónde se pagan, esto sí viene en las
-- OC"). El backoffice manda Tipo_pago por OC (Transferencia electrónica de
-- fondos / Efectivo / Tarjeta de débito / Tarjeta de crédito), guardado en
-- ordenes_compra.tipo_pago_backoffice desde 20260929180000; aquí se agrega a
-- v_pagos_programados junto con la condición y el estatus del backoffice.
-- Columnas al final: create or replace view solo permite agregar.
--
-- Ya aplicado en producción.

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
       oc.condicion_pago
from public.pagos_programados p
join public.empresas e on e.id = p.empresa_id
left join public.ordenes_compra oc on oc.id = p.orden_compra_id
left join public.proveedores_datos_bancarios db on db.clave = public.fn_proveedor_clave(p.beneficiario);
grant select on public.v_pagos_programados to authenticated;
