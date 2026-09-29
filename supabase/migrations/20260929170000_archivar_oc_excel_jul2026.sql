-- Laura (29-sep-2026): "esta información no sé de dónde sale; no coincide
-- con las pendientes de autorización del backoffice". Las 188 OC con
-- fuente 'excel' venían de UN archivo cargado el 25-ago-2026 ("OC S y
-- Detalle del 1 al 29 jul 26.xlsx", CSC, julio). Las que el backoffice sí
-- autorizó ya se convirtieron en 'api' por la sincronización (upsert por
-- id_orden); las 188 restantes nunca aparecieron autorizadas: carga vieja.
-- Se archivan como rechazadas con el motivo (reversible: "Autorizar" en
-- "Ver archivadas" las reactiva) y las rechazadas dejan de contar en
-- cuentas por pagar. Ya aplicado en producción.
update public.ordenes_compra oc
   set rechazada_en = now(),
       rechazada_por = a.cargado_por,
       rechazo_motivo = 'Archivada: carga inicial desde Excel del ' || to_char(a.created_at, 'DD-MM-YYYY') || ' (' || a.nombre_original || '); no coincide con las pendientes del backoffice'
  from public.archivos_cargados a
 where a.id = oc.archivo_id
   and oc.fuente = 'excel'
   and oc.autorizada_en is null
   and oc.rechazada_en is null
   and a.nombre_original = 'OC S y Detalle del 1 al 29 jul 26.xlsx';

-- Cuentas por pagar: una OC rechazada no compromete dinero.
create or replace view public.v_cxp_proveedores with (security_invoker = true) as
with oc as (
  select public.fn_proveedor_clave(proveedor) clave, min(proveedor) nombre, count(*) n_oc, sum(total) comprometido,
         max(fecha_creacion) ultima_oc, array_agg(distinct empresa_id) empresas
  from public.ordenes_compra
  where public.fn_proveedor_clave(proveedor) is not null and public.fn_proveedor_clave(proveedor) <> 'TOTAL'
    and rechazada_en is null
  group by public.fn_proveedor_clave(proveedor)
),
fac as (
  select public.fn_proveedor_clave(contraparte) clave, min(contraparte) nombre,
         count(*) filter (where not coalesce(es_complemento_pago, false)) n_facturas,
         sum(total) filter (where not coalesce(es_complemento_pago, false)) facturado,
         sum(total) filter (where coalesce(es_complemento_pago, false)) pagado_complementos,
         max(fecha) filter (where not coalesce(es_complemento_pago, false)) ultima_factura,
         array_agg(distinct empresa_id) empresas
  from public.cfdi
  where tipo = 'recibido' and public.fn_proveedor_clave(contraparte) is not null
  group by public.fn_proveedor_clave(contraparte)
),
pag as (
  select public.fn_proveedor_clave(nombre_razon_social) clave, sum(cargo_total) pagado_bancos, max(fecha_pago) ultimo_pago
  from public.movimientos
  where cargo_total > 0 and public.fn_proveedor_clave(nombre_razon_social) is not null
  group by public.fn_proveedor_clave(nombre_razon_social)
)
select coalesce(oc.clave, fac.clave) clave,
       coalesce(cr.nombre, fac.nombre, oc.nombre) proveedor,
       coalesce(oc.n_oc, 0) n_oc,
       coalesce(oc.comprometido, 0) comprometido,
       coalesce(fac.n_facturas, 0) n_facturas,
       coalesce(fac.facturado, 0) facturado,
       coalesce(fac.pagado_complementos, 0) + coalesce(pag.pagado_bancos, 0) pagado,
       greatest(coalesce(fac.facturado, 0) - coalesce(fac.pagado_complementos, 0) - coalesce(pag.pagado_bancos, 0), 0) por_pagar,
       greatest(coalesce(oc.comprometido, 0) - coalesce(fac.facturado, 0), 0) sin_facturar,
       cr.linea_credito, cr.dias_credito, cr.notas, cr.vencimiento,
       case when cr.linea_credito is null then null
            else cr.linea_credito - greatest(coalesce(fac.facturado, 0) - coalesce(fac.pagado_complementos, 0) - coalesce(pag.pagado_bancos, 0), 0) end disponible,
       oc.ultima_oc, fac.ultima_factura, pag.ultimo_pago,
       (select array_agg(distinct e.e) from unnest(coalesce(oc.empresas, '{}'::uuid[]) || coalesce(fac.empresas, '{}'::uuid[])) e(e)) empresas
from oc
full join fac on fac.clave = oc.clave
left join pag on pag.clave = coalesce(oc.clave, fac.clave)
left join public.proveedores_credito cr on cr.clave = coalesce(oc.clave, fac.clave);
