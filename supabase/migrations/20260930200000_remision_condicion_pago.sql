-- Remisión de entrega (producción, Clavicón/Balken): se clasifica desde el
-- formulario si la entrega es de contado o a crédito (Mario, 30-sep-2026).
-- Obligatoria en las de salida desde la pantalla; las viejas quedan en null.
--
-- Ya aplicado en producción.
alter table public.remisiones_produccion
  add column if not exists condicion_pago text check (condicion_pago in ('contado', 'credito')),
  add column if not exists dias_credito integer check (dias_credito is null or dias_credito > 0);

create or replace view public.v_remisiones_produccion as
 SELECT r.id, r.empresa_id, r.numero, r.folio, r.tipo, r.fecha, r.contraparte, r.proyecto_id, r.orden_venta_id, r.orden_compra_id,
    r.observaciones, r.estatus, r.emitida_por, r.entregada_en, r.entregada_por, r.recibio_nombre, r.created_at,
    e.nombre AS empresa_nombre, e.rfc AS empresa_rfc, e.codigo AS empresa_codigo, p.nombre AS emitida_por_nombre, pr.nombre AS proyecto_nombre,
    ( SELECT count(*) AS count FROM remisiones_produccion_lineas l WHERE l.remision_id = r.id) AS lineas,
    r.cliente_id, c.rfc AS cliente_rfc, c.domicilio AS cliente_domicilio,
    r.condicion_pago, r.dias_credito
   FROM remisiones_produccion r
     JOIN empresas e ON e.id = r.empresa_id
     LEFT JOIN profiles p ON p.id = r.emitida_por
     LEFT JOIN proyectos pr ON pr.id = r.proyecto_id
     LEFT JOIN clientes c ON c.id = r.cliente_id;
