-- Entrega a obra y avance por partida (Mario con Alma, 5-oct-2026: "ella ya
-- recibió el material en bodega, sin embargo el destino final es la obra:
-- hay que agregar este paso para que realmente esté la requisición
-- 'completada'" + "el semáforo no muestra avance en % aun cuando ya se
-- recibió y ya se pidió el material: por partidas y por etapa").
--
-- El seguimiento por renglón (requisicion_linea_eventos) gana pasos:
--   en_bodega      Recibido en bodega              (almacén)
--   enviado_obra   Enviado a obra, parcial o total (almacén)
--   entregado      Recibido en obra = destino final (quien pidió, el
--                  responsable o comprador del proyecto, empresa, admin)
--   directo_obra   El proveedor entregó directo en obra (los mismos)
--   queda_bodega   Esa parte se queda en bodega: cuenta como cumplida
--   faltante       Enviado que no llegó (motivo); se vuelve a enviar
--   regreso_bodega Enviado que regresa a bodega (motivo)
-- más pedido / devolucion / cambio / comentario de antes. Las recepciones de
-- OC del sistema (oc_recepciones, lugar bodega u obra) cuentan igual.
--
-- Por renglón (vista v_requisicion_linea_entrega), todo calculado:
--   final       = en obra neto (entregado + directo + OC en obra − devolución
--                 − cambio) + lo que se queda en bodega
--   en tránsito = enviado − entregado − faltante − regreso
--   en bodega   = recibido en bodega (+ OC en bodega) − enviado + regreso
--                 − queda en bodega
--   avance %    = promedio de cuatro niveles acumulados contra lo
--                 solicitado: pedido/comprado · en bodega · en camino · final
-- v_requisicion_avance: promedio de partidas y cuántas hay en cada etapa.
-- La etapa de la requisición se recalcula sola: todo final → recibida;
-- algo en camino → en_transito; algo en bodega u obra → en_bodega. Recibir
-- en BODEGA ya no la cierra.
--
-- Datos: las 18 marcas "entregado" que Alma (almacén) puso eran de bodega
-- (folios 6, 7, 8, 10, 11, 12): pasan a en_bodega y se recalculan.
--
-- Ya aplicado en producción.

alter table public.requisicion_linea_eventos drop constraint if exists requisicion_linea_eventos_tipo_check;
alter table public.requisicion_linea_eventos add constraint requisicion_linea_eventos_tipo_check check (tipo in (
  'pedido', 'en_bodega', 'enviado_obra', 'entregado', 'directo_obra', 'queda_bodega',
  'faltante', 'regreso_bodega', 'devolucion', 'cambio', 'comentario'));
alter table public.requisicion_linea_eventos drop constraint if exists requisicion_linea_eventos_cantidad_o_nota;
alter table public.requisicion_linea_eventos add constraint requisicion_linea_eventos_cantidad_o_nota check (
  (tipo = 'comentario' and nullif(btrim(nota), '') is not null)
  or (tipo in ('pedido', 'en_bodega', 'enviado_obra', 'entregado', 'directo_obra', 'queda_bodega') and cantidad is not null)
  or (tipo in ('devolucion', 'cambio', 'faltante', 'regreso_bodega') and cantidad is not null and nullif(btrim(nota), '') is not null)
);

-- Cantidades por renglón ----------------------------------------------------
create or replace view public.v_requisicion_linea_entrega with (security_invoker = true) as
with base as (
  select rl.id as requisicion_linea_id, rl.requisicion_id, rl.cantidad_solicitada::numeric as solicitado,
         coalesce(ev.pedido, 0) as pedido, coalesce(ev.en_bodega, 0) as ev_bodega, coalesce(ev.enviado, 0) as enviado,
         coalesce(ev.entregado, 0) as entregado, coalesce(ev.directo, 0) as ev_directo, coalesce(ev.queda, 0) as queda_bodega,
         coalesce(ev.faltante, 0) as faltante, coalesce(ev.regreso, 0) as regreso, coalesce(ev.devolucion, 0) as devolucion,
         coalesce(ev.cambio, 0) as cambio,
         coalesce(nc.comprado, 0) + coalesce(ne.surtido, 0) as comprado,
         coalesce(oc.bodega, 0) as oc_bodega, coalesce(oc.obra, 0) as oc_obra
  from public.requisicion_lineas rl
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
from niveles n;

grant select on public.v_requisicion_linea_entrega to authenticated;

-- Avance de la requisición: promedio de sus partidas y conteo por etapa.
create or replace view public.v_requisicion_avance with (security_invoker = true) as
select v.requisicion_id,
       count(*) as partidas,
       round(avg(v.avance_pct), 1) as avance_pct,
       count(*) filter (where v.etapa_partida = 'sin_pedir') as sin_pedir,
       count(*) filter (where v.etapa_partida = 'pedido') as pedidas,
       count(*) filter (where v.etapa_partida = 'en_bodega') as en_bodega,
       count(*) filter (where v.etapa_partida = 'en_transito') as en_transito,
       count(*) filter (where v.etapa_partida = 'en_obra') as en_obra
from public.v_requisicion_linea_entrega v
group by v.requisicion_id;

grant select on public.v_requisicion_avance to authenticated;

-- Quién marca qué y que no se mande más de lo que hay --------------------------
create or replace function public.requisicion_linea_eventos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol text := (select rol::text from public.profiles where id = (select auth.uid()));
  v_req record;
  v public.v_requisicion_linea_entrega%rowtype;
  v_de_obra boolean;
begin
  select rl.requisicion_id into new.requisicion_id from public.requisicion_lineas rl where rl.id = new.requisicion_linea_id;
  new.created_by := coalesce(new.created_by, v_uid);
  new.created_by_nombre := (select nombre from public.profiles where id = new.created_by);
  if v_uid is null or new.tipo in ('comentario', 'pedido') then return new; end if;

  select r.solicitado_por, p.responsable_id, p.comprador_id into v_req
  from public.requisiciones r left join public.proyectos p on p.id = r.proyecto_id where r.id = new.requisicion_id;
  v_de_obra := coalesce(v_uid = v_req.solicitado_por, false) or coalesce(v_uid = v_req.responsable_id, false)
               or coalesce(v_uid = v_req.comprador_id, false) or coalesce(v_rol in ('admin', 'corporativo', 'empresa'), false);
  if new.tipo in ('en_bodega', 'enviado_obra', 'queda_bodega', 'regreso_bodega')
     and coalesce(v_rol, '') not in ('almacen', 'empresa', 'admin', 'corporativo') then
    raise exception 'Lo de bodega lo marca almacén.';
  end if;
  if new.tipo in ('entregado', 'directo_obra', 'faltante', 'devolucion', 'cambio') and not v_de_obra then
    raise exception 'Lo recibido en obra lo confirma quien pidió la requisición o el responsable de la obra.';
  end if;

  select * into v from public.v_requisicion_linea_entrega where requisicion_linea_id = new.requisicion_linea_id;
  if new.tipo in ('enviado_obra', 'queda_bodega') and new.cantidad > coalesce(v.en_bodega, 0) + 0.0001 then
    raise exception 'En bodega solo hay % de este renglón.', coalesce(v.en_bodega, 0);
  end if;
  if new.tipo in ('faltante', 'regreso_bodega') and new.cantidad > coalesce(v.en_transito, 0) + 0.0001 then
    raise exception 'En camino a obra solo hay % de este renglón.', coalesce(v.en_transito, 0);
  end if;
  if new.tipo in ('devolucion', 'cambio') and new.cantidad > greatest(0, coalesce(v.final, 0) - coalesce(v.queda_bodega, 0)) + 0.0001 then
    raise exception 'Solo se puede devolver lo recibido en obra (%).', greatest(0, coalesce(v.final, 0) - coalesce(v.queda_bodega, 0));
  end if;
  return new;
end;
$$;

-- Etapa de la requisición según sus partidas -----------------------------------
create or replace function public.fn_requisicion_recalcular_entrega(p_requisicion_id uuid, p_nota text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_actual text;
  v_nueva text;
  a record;
begin
  select etapa into v_actual from public.requisiciones where id = p_requisicion_id and estado <> 'cancelada';
  if v_actual is null then return null; end if;
  select count(*) as partidas,
         count(*) filter (where etapa_partida = 'en_obra') as en_obra,
         count(*) filter (where etapa_partida = 'en_transito') as en_transito,
         count(*) filter (where etapa_partida = 'en_bodega' or (etapa_partida = 'en_obra')) as con_material
    into a
  from public.v_requisicion_linea_entrega where requisicion_id = p_requisicion_id;
  if a.partidas > 0 and a.en_obra = a.partidas then v_nueva := 'recibida';
  elsif a.en_transito > 0 then v_nueva := 'en_transito';
  elsif a.con_material > 0 then v_nueva := 'en_bodega';
  elsif v_actual in ('en_bodega', 'en_transito', 'recibida') then v_nueva := 'suministro';
  else return v_actual;
  end if;
  if v_nueva is distinct from v_actual then
    update public.requisiciones set etapa = v_nueva, etapa_en = now(), etapa_por = v_uid where id = p_requisicion_id;
    insert into public.requisicion_etapas (requisicion_id, etapa, etapa_anterior, actor_id, actor_nombre, nota)
    values (p_requisicion_id, v_nueva, v_actual, v_uid, (select nombre from public.profiles where id = v_uid),
            coalesce(p_nota, case v_nueva
              when 'recibida' then 'Todas las partidas recibidas en obra'
              when 'en_transito' then 'Material en camino a obra'
              when 'en_bodega' then 'Material en bodega, falta llevarlo a obra'
              else 'Seguimiento corregido' end));
  end if;
  return v_nueva;
end;
$$;
revoke execute on function public.fn_requisicion_recalcular_entrega(uuid, text) from public, anon, authenticated;

create or replace function public.requisicion_linea_eventos_avanza()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.tipo, old.tipo) in ('comentario', 'pedido') then return null; end if;
  perform public.fn_requisicion_recalcular_entrega(coalesce(new.requisicion_id, old.requisicion_id));
  return null;
end;
$$;
drop trigger if exists requisicion_linea_eventos_avanza on public.requisicion_linea_eventos;
create trigger requisicion_linea_eventos_avanza
  after insert or delete on public.requisicion_linea_eventos
  for each row execute function public.requisicion_linea_eventos_avanza();

-- Recepción de OC del sistema: recibir en bodega ya no cierra la requisición.
create or replace function public.oc_recepciones_avanza_requisicion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select distinct rl.requisicion_id
    from public.ordenes_compra_lineas l
    join public.necesidades_compra nc on nc.orden_compra_id = l.orden_compra_id
    join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
    where l.id = new.orden_compra_linea_id
  loop
    perform public.fn_requisicion_recalcular_entrega(r.requisicion_id);
  end loop;
  return new;
end;
$$;

-- Datos: lo que Alma marcó "entregado" era recepción en bodega.
update public.requisicion_linea_eventos e set tipo = 'en_bodega'
where e.tipo = 'entregado'
  and exists (select 1 from public.profiles p where p.id = e.created_by and p.rol = 'almacen');

do $$
declare r record;
begin
  for r in select distinct requisicion_id from public.requisicion_linea_eventos where requisicion_id is not null loop
    perform public.fn_requisicion_recalcular_entrega(r.requisicion_id, 'Recalculado: recibir en bodega ya no completa la requisición');
  end loop;
end $$;
