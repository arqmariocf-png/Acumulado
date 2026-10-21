-- Saldo del proveedor con su fecha de corte (21-oct-2026, Laura: "los saldos
-- de Bodega Cruz Azul y Cemex están erróneos; ya los había cuadrado y otra vez
-- sale que le debemos más de un millón"; "cuentas por pagar solo son
-- proveedores con línea de crédito").
--
-- Por qué se inflaba: la descarga masiva del SAT (13-oct) trajo todas las
-- facturas recibidas desde enero y casi ningún pago se detecta por nombre en
-- los bancos, así que "facturado − pagado" subió a $1.35 M en Cruz Azul (AEP)
-- contra $154 mil de su estado de cuenta.
--
-- Ahora la línea de crédito guarda el saldo que dice el estado de cuenta del
-- proveedor y la fecha (`saldo_proveedor`, `saldo_proveedor_al`) y la deuda
-- se calcula como se explica al final de la vista. Ya aplicado en producción
-- (cxp_saldo_proveedor y cxp_saldo_proveedor_2).

alter table public.proveedores_credito
  add column if not exists saldo_proveedor numeric(14, 2),
  add column if not exists saldo_proveedor_al date,
  add column if not exists saldo_proveedor_nota text;

alter table public.proveedores_credito drop constraint if exists proveedores_credito_saldo_fecha;
alter table public.proveedores_credito add constraint proveedores_credito_saldo_fecha
  check (saldo_proveedor is null or saldo_proveedor_al is not null);

create or replace view public.v_cxp_empresa with (security_invoker = true) as
with oc as (
  select o.empresa_id,
         public.fn_proveedor_clave(o.proveedor) as clave,
         min(o.proveedor) as nombre,
         count(*) as n_oc,
         sum(o.total) as comprometido,
         max(o.fecha_creacion) as ultima_oc,
         -- Pagado por OC: lo registrado aquí, o la OC completa si el
         -- backoffice ya la da por pagada (Pendiente Factura / Comprobante /
         -- Completada). Nunca más que el total de la OC.
         sum(least(coalesce(o.total, 0),
                   case when o.fuente = 'api' and o.estatus_backoffice in ('Pendiente Factura', 'Pendiente Comprobante', 'Completada')
                        then coalesce(o.total, 0) else coalesce(pg.pagado, 0) end)) as pagado_oc,
         count(*) filter (where not (o.fuente = 'api' and coalesce(o.estatus_backoffice, '') in ('Pendiente Factura', 'Pendiente Comprobante', 'Completada'))
                            and coalesce(pg.pagado, 0) < coalesce(o.total, 0) - 0.01) as n_oc_por_pagar
  from public.ordenes_compra o
  left join lateral (
    select sum(p.monto) filter (where p.estatus = 'pagado') as pagado
    from public.pagos_programados p where p.orden_compra_id = o.id
  ) pg on true
  where public.fn_proveedor_clave(o.proveedor) is not null
    and public.fn_proveedor_clave(o.proveedor) <> 'TOTAL'
    and o.rechazada_en is null
    and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
    and (coalesce(o.estatus_backoffice, '') <> 'Pendiente de Autorización' or o.autorizada_en is not null)
  group by o.empresa_id, public.fn_proveedor_clave(o.proveedor)
), fac as (
  select c.empresa_id,
         public.fn_proveedor_clave(c.contraparte) as clave,
         min(c.contraparte) as nombre,
         count(*) filter (where not coalesce(c.es_complemento_pago, false)) as n_facturas,
         sum(c.total) filter (where not coalesce(c.es_complemento_pago, false)) as facturado,
         sum(c.total) filter (where coalesce(c.es_complemento_pago, false)) as pagado_complementos,
         max(c.fecha) filter (where not coalesce(c.es_complemento_pago, false)) as ultima_factura
  from public.cfdi c
  where c.tipo = 'recibido' and public.fn_proveedor_clave(c.contraparte) is not null
  group by c.empresa_id, public.fn_proveedor_clave(c.contraparte)
), pag as (
  select m.empresa_id,
         public.fn_proveedor_clave(m.nombre_razon_social) as clave,
         sum(m.cargo_total) as pagado_bancos,
         max(m.fecha_pago) as ultimo_pago
  from public.movimientos m
  where m.cargo_total > 0 and public.fn_proveedor_clave(m.nombre_razon_social) is not null
  group by m.empresa_id, public.fn_proveedor_clave(m.nombre_razon_social)
), base as (
  select coalesce(oc.empresa_id, fac.empresa_id) as empresa_id,
         coalesce(oc.clave, fac.clave) as clave,
         coalesce(fac.nombre, oc.nombre) as nombre,
         coalesce(oc.n_oc, 0) as n_oc,
         coalesce(oc.comprometido, 0) as comprometido,
         coalesce(oc.pagado_oc, 0) as pagado_oc,
         coalesce(oc.n_oc_por_pagar, 0) as n_oc_por_pagar,
         coalesce(fac.n_facturas, 0) as n_facturas,
         coalesce(fac.facturado, 0) as facturado,
         coalesce(fac.pagado_complementos, 0) + coalesce(pag.pagado_bancos, 0) as pagado_detectado,
         oc.ultima_oc, fac.ultima_factura, pag.ultimo_pago
  from oc
  full join fac on fac.clave = oc.clave and fac.empresa_id = oc.empresa_id
  left join pag on pag.clave = coalesce(oc.clave, fac.clave) and pag.empresa_id = coalesce(oc.empresa_id, fac.empresa_id)
), calc as (
  select b.*,
         -- Lo pagado por OC y lo detectado en banco/complementos suelen ser el
         -- mismo dinero: se toma el mayor, no la suma.
         greatest(b.pagado_oc, b.pagado_detectado) as pagado,
         greatest(b.comprometido - b.pagado_oc, 0) as saldo_oc
  from base b
)
select c.empresa_id,
       c.clave,
       coalesce(cr.nombre, c.nombre) as proveedor,
       c.n_oc,
       c.comprometido,
       c.n_facturas,
       c.facturado,
       c.pagado,
       greatest(c.facturado - c.pagado, 0) as por_pagar,
       greatest(c.comprometido - c.facturado, 0) as sin_facturar,
       cr.linea_credito,
       cr.dias_credito,
       cr.notas,
       cr.vencimiento,
       d.deuda,
       case when cr.linea_credito is null then null else cr.linea_credito - d.deuda end as disponible,
       c.ultima_oc,
       c.ultima_factura,
       c.ultimo_pago,
       array[c.empresa_id] as empresas,
       c.pagado_oc,
       c.saldo_oc,
       c.n_oc_por_pagar,
       c.pagado_detectado,
       cr.saldo_proveedor,
       cr.saldo_proveedor_al,
       coalesce(corte.pagado, 0) as pagado_desde_corte,
       coalesce(corte.oc_nuevas, 0) as oc_desde_corte
from calc c
left join public.proveedores_credito cr on cr.clave = c.clave and cr.empresa_id = c.empresa_id
left join lateral (
  -- Solo para los proveedores con saldo capturado (el CASE evita calcular el resto).
  select case when cr.saldo_proveedor is null then null else (select sum(p.monto)
            from public.pagos_programados p
            join public.ordenes_compra o on o.id = p.orden_compra_id
           where o.empresa_id = c.empresa_id
             and public.fn_proveedor_clave(o.proveedor) = c.clave
             and o.fecha_creacion <= cr.saldo_proveedor_al
             and p.estatus = 'pagado'
             and coalesce(p.pagado_en, p.fecha_programada) > cr.saldo_proveedor_al) end as pagado,
         case when cr.saldo_proveedor is null then null else (select sum(greatest(coalesce(o.total, 0) -
                   case when o.fuente = 'api' and o.estatus_backoffice in ('Pendiente Factura', 'Pendiente Comprobante', 'Completada')
                        then coalesce(o.total, 0)
                        else coalesce((select sum(p.monto) from public.pagos_programados p where p.orden_compra_id = o.id and p.estatus = 'pagado'), 0) end, 0))
            from public.ordenes_compra o
           where o.empresa_id = c.empresa_id
             and public.fn_proveedor_clave(o.proveedor) = c.clave
             and o.fecha_creacion > cr.saldo_proveedor_al
             and o.rechazada_en is null
             and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
             and (coalesce(o.estatus_backoffice, '') <> 'Pendiente de Autorización' or o.autorizada_en is not null)) end as oc_nuevas
) corte on true
-- Lo que se debe (para la línea y el semáforo):
--  1. con saldo del estado de cuenta capturado: ese saldo − lo pagado aquí
--     después del corte (de OC de antes) + el saldo de las OC posteriores;
--  2. si el proveedor manda complementos de pago (o sus pagos se ven en el
--     banco): lo facturado − lo pagado. Antes se tomaba el mayor contra el
--     saldo de las OC, y las OC que el backoffice deja en "Pendiente de Pago"
--     aunque ya tengan complemento inflaban la deuda (Muebles para Baño,
--     Industrial de Alambres, Pinturerías);
--  3. si no hay ni complementos ni pagos detectados: el saldo de las OC
--     (las facturas del SAT desde enero sin pagos visibles la inflarían).
cross join lateral (
  select case when cr.saldo_proveedor is not null
              then greatest(cr.saldo_proveedor - coalesce(corte.pagado, 0) + coalesce(corte.oc_nuevas, 0), 0)
              when c.pagado_detectado > 0 then greatest(c.facturado - c.pagado, 0)
              else greatest(c.saldo_oc, 0) end as deuda
) d;
