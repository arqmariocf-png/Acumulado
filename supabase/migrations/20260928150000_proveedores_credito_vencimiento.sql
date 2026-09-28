-- Fecha de vencimiento de la línea de crédito de cada proveedor (Mario,
-- 28-sep-2026): Laura la captura en su menú "Líneas de crédito" junto con el
-- monto y los días. La vista de cuentas por pagar la expone para el semáforo
-- de vencimiento. Ya aplicado en producción.
alter table public.proveedores_credito add column if not exists vencimiento date;

-- La columna nueva va en medio: create or replace no deja reordenar, se recrea.
drop view if exists public.v_cxp_proveedores;
create view public.v_cxp_proveedores with (security_invoker = true) as
with oc as (
  select public.fn_proveedor_clave(proveedor) clave, min(proveedor) nombre, count(*) n_oc, sum(total) comprometido,
         max(fecha_creacion) ultima_oc, array_agg(distinct empresa_id) empresas
  from public.ordenes_compra where public.fn_proveedor_clave(proveedor) is not null and public.fn_proveedor_clave(proveedor) <> 'TOTAL'
  group by 1
), fac as (
  select public.fn_proveedor_clave(contraparte) clave, min(contraparte) nombre,
         count(*) filter (where not coalesce(es_complemento_pago, false)) n_facturas,
         sum(total) filter (where not coalesce(es_complemento_pago, false)) facturado,
         sum(total) filter (where coalesce(es_complemento_pago, false)) pagado_complementos,
         max(fecha) filter (where not coalesce(es_complemento_pago, false)) ultima_factura,
         array_agg(distinct empresa_id) empresas
  from public.cfdi where tipo = 'recibido' and public.fn_proveedor_clave(contraparte) is not null
  group by 1
), pag as (
  select public.fn_proveedor_clave(nombre_razon_social) clave, sum(cargo_total) pagado_bancos, max(fecha_pago) ultimo_pago
  from public.movimientos where cargo_total > 0 and public.fn_proveedor_clave(nombre_razon_social) is not null
  group by 1
)
select coalesce(oc.clave, fac.clave) as clave,
       coalesce(cr.nombre, fac.nombre, oc.nombre) as proveedor,
       coalesce(oc.n_oc, 0) as n_oc,
       coalesce(oc.comprometido, 0) as comprometido,
       coalesce(fac.n_facturas, 0) as n_facturas,
       coalesce(fac.facturado, 0) as facturado,
       coalesce(fac.pagado_complementos, 0) + coalesce(pag.pagado_bancos, 0) as pagado,
       greatest(coalesce(fac.facturado, 0) - coalesce(fac.pagado_complementos, 0) - coalesce(pag.pagado_bancos, 0), 0) as por_pagar,
       greatest(coalesce(oc.comprometido, 0) - coalesce(fac.facturado, 0), 0) as sin_facturar,
       cr.linea_credito, cr.dias_credito, cr.notas, cr.vencimiento,
       case when cr.linea_credito is null then null else cr.linea_credito - greatest(coalesce(fac.facturado, 0) - coalesce(fac.pagado_complementos, 0) - coalesce(pag.pagado_bancos, 0), 0) end as disponible,
       oc.ultima_oc, fac.ultima_factura, pag.ultimo_pago,
       (select array_agg(distinct e) from unnest(coalesce(oc.empresas, '{}'::uuid[]) || coalesce(fac.empresas, '{}'::uuid[])) e) as empresas
from oc
full join fac on fac.clave = oc.clave
left join pag on pag.clave = coalesce(oc.clave, fac.clave)
left join public.proveedores_credito cr on cr.clave = coalesce(oc.clave, fac.clave);
grant select on public.v_cxp_proveedores to authenticated;
