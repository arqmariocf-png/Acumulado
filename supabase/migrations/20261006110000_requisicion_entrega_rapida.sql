-- Avance por partida sin trabarse (Mario, 6-oct-2026: "se está trabando mucho
-- la página"). Desde el 5-oct 19:00 UTC subieron los "canceling statement due
-- to statement timeout", casi todos en la fase BIND (planeación) de consultas
-- de requisiciones. Causa: v_requisicion_linea_entrega y v_requisicion_avance
-- (20261005100000) eran security_invoker sobre 7 tablas con RLS (líneas,
-- eventos, necesidades de compra y entrega, OC, partidas, recepciones) y
-- Postgres planeaba todas sus policies anidadas en cada consulta: 1.8 s de
-- planeación + 1.9 s de ejecución para 19 requisiciones; con varias personas a
-- la vez rebasaba los 8 s.
--
-- Ahora el cálculo vive en fn_requisicion_linea_entrega_base() (definer, sin
-- RLS por tabla, acotado a la organización del usuario) y la vista solo filtra
-- contra `requisiciones`, que sí aplica RLS: cada quien ve el avance de las
-- requisiciones que puede ver, igual que antes.
--
-- Ya aplicado en producción.

create or replace function public.fn_requisicion_linea_entrega_base()
returns table (
  requisicion_linea_id uuid, requisicion_id uuid, solicitado numeric, pedido numeric, comprado numeric,
  recibido_bodega numeric, enviado numeric, en_transito numeric, en_bodega numeric, recibido_obra numeric,
  queda_bodega numeric, final numeric, oc_bodega numeric, oc_obra numeric, avance_pct numeric, etapa_partida text)
language sql stable security definer set search_path = public as $fn$
with base as (
  select rl.id as requisicion_linea_id, rl.requisicion_id, rl.cantidad_solicitada::numeric as solicitado,
         coalesce(ev.pedido, 0) as pedido, coalesce(ev.en_bodega, 0) as ev_bodega, coalesce(ev.enviado, 0) as enviado,
         coalesce(ev.entregado, 0) as entregado, coalesce(ev.directo, 0) as ev_directo, coalesce(ev.queda, 0) as queda_bodega,
         coalesce(ev.faltante, 0) as faltante, coalesce(ev.regreso, 0) as regreso, coalesce(ev.devolucion, 0) as devolucion,
         coalesce(ev.cambio, 0) as cambio,
         coalesce(nc.comprado, 0) + coalesce(ne.surtido, 0) as comprado,
         coalesce(oc.bodega, 0) as oc_bodega, coalesce(oc.obra, 0) as oc_obra
  from public.requisicion_lineas rl
  -- Sin usuario (triggers de procesos) calcula todo; con usuario, solo su organización.
  join public.requisiciones rq on rq.id = rl.requisicion_id
   and ((select auth.uid()) is null or rq.empresa_id = any (public.auth_empresas_organizacion()))
  left join lateral (
    select sum(e.cantidad) filter (where e.tipo = 'pedido') as pedido,
           sum(e.cantidad) filter (where e.tipo = 'en_bodega') as en_bodega,
           sum(e.cantidad) filter (where e.tipo = 'enviado_obra') as enviado,
           sum(e.cantidad) filter (where e.tipo = 'entregado') as entregado,
           sum(e.cantidad) filter (where e.tipo = 'directo_obra') as directo,
           sum(e.cantidad) filter (where e.tipo = 'queda_bodega') as queda,
           sum(e.cantidad) filter (where e.tipo = 'faltante') as faltante,
           sum(e.cantidad) filter (where e.tipo = 'regreso_bodega') as regreso,
           sum(e.cantidad) filter (where e.tipo = 'devolucion') as devolucion,
           sum(e.cantidad) filter (where e.tipo = 'cambio') as cambio
    from public.requisicion_linea_eventos e where e.requisicion_linea_id = rl.id
  ) ev on true
  left join lateral (
    select sum(n.cantidad) as comprado from public.necesidades_compra n
    where n.requisicion_linea_id = rl.id and n.estado <> 'cancelada'
  ) nc on true
  left join lateral (
    select sum(n.cantidad) as surtido from public.necesidades_entrega n
    where n.requisicion_linea_id = rl.id and n.estado <> 'cancelada'
  ) ne on true
  left join lateral (
    select sum(x.cantidad) filter (where x.lugar = 'bodega') as bodega,
           sum(x.cantidad) filter (where x.lugar = 'obra') as obra
    from public.necesidades_compra n
    join public.ordenes_compra_lineas l on l.orden_compra_id = n.orden_compra_id and l.clave = n.id::text
    join public.oc_recepciones x on x.orden_compra_linea_id = l.id
    where n.requisicion_linea_id = rl.id
  ) oc on true
), calc as (
  select b.*,
         greatest(0, b.entregado + b.ev_directo + b.oc_obra - b.devolucion - b.cambio) + b.queda_bodega as final,
         greatest(0, b.enviado - b.entregado - b.faltante - b.regreso) as en_transito,
         greatest(0, b.ev_bodega + b.oc_bodega - b.enviado + b.regreso - b.queda_bodega) as en_bodega,
         greatest(0, b.pedido - b.devolucion) as pedido_neto
  from base b
), niveles as (
  select c.*,
         least(c.solicitado, c.final) as n4,
         least(c.solicitado, c.final + c.en_transito) as n3,
         least(c.solicitado, c.final + c.en_transito + c.en_bodega) as n2,
         least(c.solicitado, greatest(c.final + c.en_transito + c.en_bodega, c.pedido_neto, c.comprado)) as n1
  from calc c
)
select n.requisicion_linea_id, n.requisicion_id, n.solicitado, n.pedido_neto as pedido, n.comprado,
       n.ev_bodega + n.oc_bodega as recibido_bodega, n.enviado, n.en_transito, n.en_bodega,
       n.entregado + n.ev_directo + n.oc_obra as recibido_obra, n.queda_bodega, n.final,
       n.oc_bodega, n.oc_obra,
       case when n.solicitado > 0 then round(25 * (n.n1 + n.n2 + n.n3 + n.n4) / n.solicitado, 1) else 0 end as avance_pct,
       case
         when n.solicitado > 0 and n.n4 >= n.solicitado - 0.001 then 'en_obra'
         when n.en_transito > 0 then 'en_transito'
         when n.en_bodega > 0 or n.final > 0 then 'en_bodega'
         when n.n1 > 0 then 'pedido'
         else 'sin_pedir'
       end as etapa_partida
from niveles n
$fn$;
revoke all on function public.fn_requisicion_linea_entrega_base() from public, anon;
grant execute on function public.fn_requisicion_linea_entrega_base() to authenticated;

create or replace view public.v_requisicion_linea_entrega with (security_invoker = true) as
select b.*
from public.fn_requisicion_linea_entrega_base() b
where b.requisicion_id in (select r.id from public.requisiciones r);
