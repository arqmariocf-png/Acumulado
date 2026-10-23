-- Remisiones de planta: se entrega a un cliente y paga otro (23-oct-2026,
-- Mario: "en las entregas, empezando por Clavicón, da la opción de que se
-- entregue a un cliente y pague otro; hacer referencia para que quede todo
-- vinculado"). `contraparte` / `cliente_id` siguen siendo quien RECIBE la
-- mercancía; `paga_cliente_id` / `paga_nombre` es a quién se le cobra y
-- factura (normalmente el cliente de la OV ligada) y `referencia_pago` es el
-- texto que lo liga (folio de OV, pedido o acuerdo). La remisión impresa
-- muestra "Entregar a" y "Paga / se factura a".
--
-- Ya aplicado en producción (remision_entrega_y_pagador).

alter table public.remisiones_produccion
  add column if not exists paga_cliente_id uuid references public.clientes (id),
  add column if not exists paga_nombre text,
  add column if not exists referencia_pago text;
create index if not exists remisiones_produccion_paga_cliente_idx on public.remisiones_produccion (paga_cliente_id);

create or replace view public.v_remisiones_produccion as
 SELECT r.id, r.empresa_id, r.numero, r.folio, r.tipo, r.fecha, r.contraparte, r.proyecto_id, r.orden_venta_id, r.orden_compra_id,
    r.observaciones, r.estatus, r.emitida_por, r.entregada_en, r.entregada_por, r.recibio_nombre, r.created_at,
    e.nombre AS empresa_nombre, e.rfc AS empresa_rfc, e.codigo AS empresa_codigo, p.nombre AS emitida_por_nombre, pr.nombre AS proyecto_nombre,
    ( SELECT count(*) AS count FROM remisiones_produccion_lineas l WHERE l.remision_id = r.id) AS lineas,
    r.cliente_id, c.rfc AS cliente_rfc, c.domicilio AS cliente_domicilio,
    r.condicion_pago, r.dias_credito,
    ( SELECT count(*) FROM remisiones_produccion_fotos f WHERE f.remision_id = r.id) AS fotos,
    r.paga_cliente_id, coalesce(r.paga_nombre, cp.razon_social) AS paga_nombre, cp.rfc AS paga_rfc, cp.domicilio AS paga_domicilio,
    r.referencia_pago
   FROM remisiones_produccion r
     JOIN empresas e ON e.id = r.empresa_id
     LEFT JOIN profiles p ON p.id = r.emitida_por
     LEFT JOIN proyectos pr ON pr.id = r.proyecto_id
     LEFT JOIN clientes c ON c.id = r.cliente_id
     LEFT JOIN clientes cp ON cp.id = r.paga_cliente_id;
