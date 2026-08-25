-- Estado general de carga por empresa (Dashboard): para cada empresa
-- activa, cuándo fue la última vez que se cargó cada tipo de archivo y qué
-- periodo (AAAAMM) es el más reciente en catálogo -- así se puede ver de un
-- vistazo qué empresa/categoría todavía no tiene nada cargado (NULL = nunca).
-- security_invoker = true: RLS de empresas/archivos_cargados/cfdi/
-- ordenes_compra/ordenes_venta ya filtra qué empresas puede ver cada rol,
-- esta vista no debe evadir eso (mismo patrón que el resto de v_*).
create view public.v_estado_carga_empresa with (security_invoker = true) as
select
  e.id as empresa_id,
  e.nombre as empresa_nombre,
  (
    select max(a.created_at)
    from public.archivos_cargados a
    where a.empresa_id = e.id and a.tipo = 'estado_cuenta' and a.estado = 'completado'
  ) as ultima_carga_estado_cuenta,
  (
    select max(c.periodo)
    from public.cfdi c
    where c.empresa_id = e.id and c.tipo = 'recibido'
  ) as ultimo_periodo_cfdi_recibidos,
  (
    select max(c.periodo)
    from public.cfdi c
    where c.empresa_id = e.id and c.tipo = 'emitido'
  ) as ultimo_periodo_cfdi_emitidos,
  (
    select max(o.periodo)
    from public.ordenes_compra o
    where o.empresa_id = e.id
  ) as ultimo_periodo_oc,
  (
    select max(o.periodo)
    from public.ordenes_venta o
    where o.empresa_id = e.id
  ) as ultimo_periodo_ov
from public.empresas e
where e.activo = true;

comment on view public.v_estado_carga_empresa is 'Estado de carga por empresa para el Dashboard: NULL en cualquier columna = esa categoría nunca se ha cargado para esa empresa.';
