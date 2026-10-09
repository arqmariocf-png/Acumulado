-- Programación de pagos de Laura (8-oct-2026, documento "CORRECCIONES
-- SISTEMA GRUPO LOMA"): además de las OC, agregar préstamos o traspasos
-- entre empresas y/o cuentas bancarias, y nómina fiscal / mano de obra; todo
-- entra a la hoja de pagos del día por empresa y va descontando el saldo.
--
-- Mismo registro (pagos_programados) con su tipo:
--   proveedor (lo de siempre) · nomina · mano_obra · traspaso · prestamo.
-- Traspaso y préstamo llevan la empresa/cuenta destino: en la hoja salen
-- como cargo en la de origen y como abono en la de destino.
--
-- Ya aplicado en producción.

alter table public.pagos_programados
  add column if not exists tipo text not null default 'proveedor'
    check (tipo in ('proveedor', 'nomina', 'mano_obra', 'traspaso', 'prestamo')),
  add column if not exists destino_empresa_id uuid references public.empresas(id),
  add column if not exists destino_cuenta_id uuid references public.cuentas_bancarias(id);

create index if not exists pagos_programados_destino_empresa_idx on public.pagos_programados (destino_empresa_id);
create index if not exists pagos_programados_destino_cuenta_idx on public.pagos_programados (destino_cuenta_id);
create index if not exists pagos_programados_tipo_fecha_idx on public.pagos_programados (tipo, fecha_programada) where tipo in ('traspaso', 'prestamo');

-- La vista lleva también el tipo y el destino (al final, para no mover columnas).
create or replace view public.v_pagos_programados with (security_invoker = true) as
 SELECT p.id, p.empresa_id, p.cuenta_id, p.beneficiario, p.concepto, p.monto, p.fecha_programada, p.estatus, p.pagado_en, p.referencia, p.notas,
    p.created_by, p.created_at, p.updated_at, p.orden_compra_id, p.metodo, p.comprobante_path, p.comprobante_nombre, p.comprobante_en, p.comprobante_por,
    e.nombre AS empresa_nombre, oc.id_orden, oc.proyecto AS oc_proyecto, fn_proveedor_clave(p.beneficiario) AS clave,
    db.beneficiario AS beneficiario_bancario, db.banco AS banco_proveedor, db.clabe, db.cuenta AS cuenta_proveedor, db.rfc AS rfc_proveedor, db.correo AS correo_proveedor,
    oc.tipo_pago_backoffice, oc.estatus_backoffice, oc.condicion_pago, imp.subtotal AS oc_subtotal, imp.iva AS oc_iva, imp.total AS oc_total,
    p.tipo, p.destino_empresa_id, p.destino_cuenta_id
   FROM pagos_programados p
     JOIN empresas e ON e.id = p.empresa_id
     LEFT JOIN ordenes_compra oc ON oc.id = p.orden_compra_id
     LEFT JOIN v_oc_importes imp ON imp.orden_compra_id = p.orden_compra_id
     LEFT JOIN proveedores_datos_bancarios db ON db.clave = fn_proveedor_clave(p.beneficiario);
