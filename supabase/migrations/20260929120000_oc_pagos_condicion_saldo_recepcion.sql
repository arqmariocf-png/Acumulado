-- Pagos por orden de compra (Mario, 29-sep-2026):
-- 1. Cada pago programado puede apuntar a su OC (`pagos_programados.
--    orden_compra_id`); la OC lleva su condición de pago (contado / crédito /
--    anticipo) que asigna dirección, y su saldo se CALCULA: total - pagos
--    con estatus 'pagado' (`v_oc_pagos`, con la línea de crédito del
--    proveedor). Así las OC de meses pasados sin pagar salen con saldo.
-- 2. `fn_oc_programar_pago`: dirección programa un pago desde la OC (el
--    beneficiario y el concepto salen de la OC); fecha sugerida por
--    condición (crédito = fecha OC + días de crédito del proveedor).
-- 3. Al marcar un pago como pagado, la requisición ligada (OC RQ) avanza a
--    'pagada' y arranca el seguimiento de almacén.
-- 4. `oc_recepciones`: almacén confirma cantidades recibidas por partida de
--    la OC RQ (`v_oc_rq_recepcion`); parcial → 'en_bodega', completa en
--    todas las OC de la requisición → 'recibida'.
-- Ya aplicado en producción.

-- 1. Columnas -----------------------------------------------------------
alter table public.ordenes_compra
  add column if not exists condicion_pago text check (condicion_pago in ('contado', 'credito', 'anticipo')),
  add column if not exists condicion_por uuid references public.profiles (id),
  add column if not exists condicion_en timestamptz;

alter table public.pagos_programados
  add column if not exists orden_compra_id uuid references public.ordenes_compra (id) on delete set null;
create index if not exists pagos_programados_oc_idx on public.pagos_programados (orden_compra_id);

-- Los pagos que ya creó fn_oc_autorizar apuntan a su OC.
update public.pagos_programados p
  set orden_compra_id = oc.id
  from public.ordenes_compra oc
  where oc.pago_programado_id = p.id and p.orden_compra_id is null;

-- 2. Saldo por OC --------------------------------------------------------
create or replace view public.v_oc_pagos with (security_invoker = true) as
select oc.id, oc.id_orden, oc.empresa_id, oc.proveedor, oc.proyecto, oc.total, oc.fecha_creacion, oc.fuente,
       oc.condicion_pago, oc.autorizada_en,
       coalesce(pg.pagado, 0) as pagado,
       coalesce(pg.programado, 0) as programado,
       coalesce(oc.total, 0) - coalesce(pg.pagado, 0) as saldo,
       pg.ultimo_pago, pg.proximo_pago,
       cr.clave as proveedor_clave, cr.linea_credito, cr.dias_credito, cr.vencimiento as credito_vencimiento
from public.ordenes_compra oc
left join lateral (
  select sum(p.monto) filter (where p.estatus = 'pagado') as pagado,
         sum(p.monto) filter (where p.estatus = 'pendiente') as programado,
         max(p.pagado_en) filter (where p.estatus = 'pagado') as ultimo_pago,
         min(p.fecha_programada) filter (where p.estatus = 'pendiente') as proximo_pago
  from public.pagos_programados p where p.orden_compra_id = oc.id
) pg on true
left join public.proveedores_credito cr on cr.clave = public.fn_proveedor_clave(oc.proveedor);
grant select on public.v_oc_pagos to authenticated;

-- v_requisicion_ordenes con condición, pagado y saldo.
drop view if exists public.v_requisicion_ordenes;
create view public.v_requisicion_ordenes with (security_invoker = true) as
select distinct on (rl.requisicion_id, oc.id)
  rl.requisicion_id, oc.id as orden_compra_id, oc.id_orden, oc.proveedor, oc.total, oc.fecha_creacion,
  oc.autorizada_en, oc.created_at, oc.condicion_pago,
  coalesce((select sum(p.monto) from public.pagos_programados p where p.orden_compra_id = oc.id and p.estatus = 'pagado'), 0) as pagado,
  coalesce(oc.total, 0) - coalesce((select sum(p.monto) from public.pagos_programados p where p.orden_compra_id = oc.id and p.estatus = 'pagado'), 0) as saldo
from public.necesidades_compra nc
join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
join public.ordenes_compra oc on oc.id = nc.orden_compra_id
where oc.fuente = 'requisicion';
grant select on public.v_requisicion_ordenes to authenticated;

-- 3. Dirección: condición y pago desde la OC --------------------------------
create or replace function public.fn_oc_condicion_pago(p_oc_id uuid, p_condicion text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rol app_rol := public.auth_rol();
  v_empresa uuid;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then raise exception 'Solo dirección asigna la condición de pago' using errcode = '42501'; end if;
  if p_condicion is not null and p_condicion not in ('contado', 'credito', 'anticipo') then raise exception 'Condición no válida: %', p_condicion; end if;
  select empresa_id into v_empresa from public.ordenes_compra where id = p_oc_id;
  if v_empresa is null then raise exception 'Orden no encontrada'; end if;
  if not public.empresa_en_alcance(v_empresa) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  update public.ordenes_compra set condicion_pago = p_condicion, condicion_por = (select auth.uid()), condicion_en = now() where id = p_oc_id;
end;
$$;
grant execute on function public.fn_oc_condicion_pago(uuid, text) to authenticated;

create or replace function public.fn_oc_programar_pago(p_oc_id uuid, p_condicion text, p_monto numeric default null, p_fecha date default null, p_cuenta_id uuid default null, p_notas text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_oc public.ordenes_compra%rowtype;
  v_pagado numeric;
  v_saldo numeric;
  v_monto numeric;
  v_fecha date;
  v_dias int;
  v_pago uuid;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then raise exception 'Solo dirección programa pagos' using errcode = '42501'; end if;
  if p_condicion not in ('contado', 'credito', 'anticipo') then raise exception 'Condición no válida: %', p_condicion; end if;
  select * into v_oc from public.ordenes_compra where id = p_oc_id;
  if v_oc.id is null then raise exception 'Orden no encontrada'; end if;
  if not public.empresa_en_alcance(v_oc.empresa_id) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_programados where orden_compra_id = p_oc_id and estatus = 'pagado';
  v_saldo := coalesce(v_oc.total, 0) - v_pagado;
  v_monto := coalesce(p_monto, v_saldo);
  if v_monto <= 0 then raise exception 'La orden no tiene saldo pendiente'; end if;
  if v_monto > v_saldo + 0.01 then raise exception 'El monto (%) rebasa el saldo pendiente de la orden (%)', v_monto, v_saldo; end if;
  select dias_credito into v_dias from public.proveedores_credito where clave = public.fn_proveedor_clave(v_oc.proveedor);
  v_fecha := coalesce(p_fecha, case when p_condicion = 'credito' then coalesce(v_oc.fecha_creacion, current_date) + coalesce(v_dias, 30) else current_date end);
  if v_fecha < current_date then v_fecha := current_date; end if;

  update public.ordenes_compra set condicion_pago = p_condicion, condicion_por = v_uid, condicion_en = now() where id = p_oc_id;
  insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, referencia, notas, created_by, orden_compra_id)
  values (v_oc.empresa_id, p_cuenta_id, coalesce(v_oc.proveedor, 'Proveedor'),
    case p_condicion when 'anticipo' then 'Anticipo OC ' else 'OC ' end || v_oc.id_orden || coalesce(' · ' || v_oc.proyecto, ''),
    round(v_monto, 2), v_fecha, v_oc.id_orden, nullif(trim(coalesce(p_notas, '')), ''), v_uid, p_oc_id)
  returning id into v_pago;
  if v_oc.fuente = 'requisicion' and v_oc.pago_programado_id is null then
    update public.ordenes_compra set pago_programado_id = v_pago where id = p_oc_id;
  end if;
  return v_pago;
end;
$$;
grant execute on function public.fn_oc_programar_pago(uuid, text, numeric, date, uuid, text) to authenticated;

-- fn_oc_autorizar: el pago que crea apunta a la OC y lleva referencia.
create or replace function public.fn_oc_autorizar(p_oc_id uuid, p_autorizar boolean, p_motivo text default null, p_fecha_pago date default null, p_cuenta_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_oc public.ordenes_compra%rowtype;
  v_pago uuid;
  r record;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then
    raise exception 'Solo dirección autoriza órdenes de compra' using errcode = '42501';
  end if;
  select * into v_oc from public.ordenes_compra where id = p_oc_id;
  if v_oc.id is null then raise exception 'Orden no encontrada'; end if;
  if v_oc.fuente <> 'requisicion' then raise exception 'Solo se autorizan aquí las órdenes generadas desde requisiciones'; end if;
  if not public.empresa_en_alcance(v_oc.empresa_id) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  if v_oc.autorizada_en is not null then raise exception 'Esta orden ya fue autorizada'; end if;

  if p_autorizar then
    insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, referencia, notas, created_by, orden_compra_id)
    values (v_oc.empresa_id, p_cuenta_id, coalesce(v_oc.proveedor, 'Proveedor'),
      'OC ' || v_oc.id_orden || coalesce(' · ' || v_oc.proyecto, ''), coalesce(v_oc.total, 0),
      coalesce(p_fecha_pago, current_date + 7), v_oc.id_orden, 'Generado al autorizar la orden ' || v_oc.id_orden, v_uid, p_oc_id)
    returning id into v_pago;
    update public.ordenes_compra set autorizada_en = now(), autorizada_por = v_uid, pago_programado_id = v_pago,
      condicion_pago = coalesce(condicion_pago, 'contado'), condicion_por = coalesce(condicion_por, v_uid), condicion_en = coalesce(condicion_en, now())
      where id = p_oc_id;
    for r in
      select distinct req.id, req.etapa
      from public.necesidades_compra nc
      join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
      join public.requisiciones req on req.id = rl.requisicion_id
      where nc.orden_compra_id = p_oc_id
    loop
      if r.etapa = 'solicitada' then
        update public.requisiciones set etapa = 'autorizada', etapa_en = now(), etapa_por = v_uid where id = r.id;
        insert into public.requisicion_etapas (requisicion_id, etapa, etapa_anterior, actor_id, actor_nombre, nota)
        values (r.id, 'autorizada', 'solicitada', v_uid, (select nombre from public.profiles where id = v_uid), 'Orden ' || v_oc.id_orden || ' autorizada');
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'pago_programado_id', v_pago);
  else
    update public.necesidades_compra
      set estado = 'pendiente', orden_compra_id = null, vinculado_por = null, vinculado_at = null,
          cotizacion_nota = concat_ws(' · ', nullif(cotizacion_nota, ''), 'Rechazada por dirección: ' || coalesce(nullif(trim(p_motivo), ''), 'sin motivo'))
      where orden_compra_id = p_oc_id;
    delete from public.pagos_programados where orden_compra_id = p_oc_id and estatus = 'pendiente';
    delete from public.ordenes_compra_lineas where orden_compra_id = p_oc_id;
    delete from public.ordenes_compra where id = p_oc_id;
    return jsonb_build_object('ok', true, 'rechazada', true);
  end if;
end;
$$;

-- Pago marcado como pagado → la requisición ligada pasa a 'pagada'.
create or replace function public.pagos_programados_avanza_requisicion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_folio text;
  r record;
begin
  if new.estatus = 'pagado' and old.estatus is distinct from 'pagado' and new.orden_compra_id is not null then
    select id_orden into v_folio from public.ordenes_compra where id = new.orden_compra_id;
    for r in
      select distinct req.id, req.etapa
      from public.necesidades_compra nc
      join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
      join public.requisiciones req on req.id = rl.requisicion_id
      where nc.orden_compra_id = new.orden_compra_id and req.estado <> 'cancelada'
    loop
      if r.etapa in ('solicitada', 'autorizada') then
        update public.requisiciones set etapa = 'pagada', etapa_en = now(), etapa_por = v_uid where id = r.id;
        insert into public.requisicion_etapas (requisicion_id, etapa, etapa_anterior, actor_id, actor_nombre, nota)
        values (r.id, 'pagada', r.etapa, v_uid, (select nombre from public.profiles where id = v_uid), 'Pago de la orden ' || coalesce(v_folio, '') || ' registrado (' || round(new.monto, 2) || ')');
      end if;
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists pagos_programados_avanza_requisicion on public.pagos_programados;
create trigger pagos_programados_avanza_requisicion
  after update of estatus on public.pagos_programados
  for each row execute function public.pagos_programados_avanza_requisicion();

-- 4. Recepción por partida (almacén) -----------------------------------------
create table if not exists public.oc_recepciones (
  id uuid primary key default gen_random_uuid(),
  orden_compra_linea_id uuid not null references public.ordenes_compra_lineas (id) on delete cascade,
  cantidad numeric not null check (cantidad > 0),
  fecha date not null default current_date,
  nota text,
  recibido_por uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists oc_recepciones_linea_idx on public.oc_recepciones (orden_compra_linea_id);
alter table public.oc_recepciones enable row level security;

create policy frontera_organizacion on public.oc_recepciones as restrictive for all
  using (exists (select 1 from public.ordenes_compra_lineas l join public.ordenes_compra o on o.id = l.orden_compra_id
                 where l.id = oc_recepciones.orden_compra_linea_id and o.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])))
  with check (exists (select 1 from public.ordenes_compra_lineas l join public.ordenes_compra o on o.id = l.orden_compra_id
                 where l.id = oc_recepciones.orden_compra_linea_id and o.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])));
create policy oc_recepciones_select on public.oc_recepciones for select to authenticated
  using (exists (select 1 from public.ordenes_compra_lineas l where l.id = oc_recepciones.orden_compra_linea_id));
create policy oc_recepciones_write on public.oc_recepciones for all to authenticated
  using ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol, 'almacen'::app_rol])
         and exists (select 1 from public.ordenes_compra_lineas l join public.ordenes_compra o on o.id = l.orden_compra_id
                     where l.id = oc_recepciones.orden_compra_linea_id and o.empresa_id = any ((select public.auth_empresas_alcance())::uuid[])))
  with check ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol, 'almacen'::app_rol])
         and exists (select 1 from public.ordenes_compra_lineas l join public.ordenes_compra o on o.id = l.orden_compra_id
                     where l.id = oc_recepciones.orden_compra_linea_id and o.empresa_id = any ((select public.auth_empresas_alcance())::uuid[])));

create or replace view public.v_oc_rq_recepcion with (security_invoker = true) as
select l.id as orden_compra_linea_id, l.orden_compra_id, l.numero, l.item, l.unidad, l.cantidad,
       coalesce(r.recibido, 0) as recibido,
       greatest(coalesce(l.cantidad, 0) - coalesce(r.recibido, 0), 0) as pendiente,
       case when coalesce(r.recibido, 0) <= 0 then 'sin_recibir'
            when coalesce(r.recibido, 0) >= coalesce(l.cantidad, 0) - 0.001 then 'completo'
            else 'parcial' end as estado,
       r.ultima_recepcion
from public.ordenes_compra_lineas l
join public.ordenes_compra oc on oc.id = l.orden_compra_id and oc.fuente = 'requisicion'
left join lateral (select sum(x.cantidad) as recibido, max(x.fecha) as ultima_recepcion from public.oc_recepciones x where x.orden_compra_linea_id = l.id) r on true;
grant select on public.v_oc_rq_recepcion to authenticated;

-- Al registrar una recepción: parcial → en_bodega; todas las partidas de
-- todas las OC de la requisición completas → recibida.
create or replace function public.oc_recepciones_avanza_requisicion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_oc uuid;
  v_folio text;
  v_completa boolean;
  r record;
begin
  select l.orden_compra_id, oc.id_orden into v_oc, v_folio
  from public.ordenes_compra_lineas l join public.ordenes_compra oc on oc.id = l.orden_compra_id
  where l.id = new.orden_compra_linea_id;
  for r in
    select distinct req.id, req.etapa
    from public.necesidades_compra nc
    join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
    join public.requisiciones req on req.id = rl.requisicion_id
    where nc.orden_compra_id = v_oc and req.estado <> 'cancelada'
  loop
    select not exists (
      select 1
      from public.necesidades_compra nc2
      join public.requisicion_lineas rl2 on rl2.id = nc2.requisicion_linea_id
      join public.ordenes_compra_lineas l2 on l2.orden_compra_id = nc2.orden_compra_id
      where rl2.requisicion_id = r.id and nc2.orden_compra_id is not null and nc2.estado <> 'cancelada'
        and coalesce((select sum(x.cantidad) from public.oc_recepciones x where x.orden_compra_linea_id = l2.id), 0) < coalesce(l2.cantidad, 0) - 0.001
    ) into v_completa;
    if v_completa and r.etapa <> 'recibida' then
      update public.requisiciones set etapa = 'recibida', etapa_en = now(), etapa_por = v_uid where id = r.id;
      insert into public.requisicion_etapas (requisicion_id, etapa, etapa_anterior, actor_id, actor_nombre, nota)
      values (r.id, 'recibida', r.etapa, v_uid, (select nombre from public.profiles where id = v_uid), 'Orden ' || coalesce(v_folio, '') || ' recibida completa');
    elsif not v_completa and r.etapa in ('solicitada', 'autorizada', 'pagada', 'suministro') then
      update public.requisiciones set etapa = 'en_bodega', etapa_en = now(), etapa_por = v_uid where id = r.id;
      insert into public.requisicion_etapas (requisicion_id, etapa, etapa_anterior, actor_id, actor_nombre, nota)
      values (r.id, 'en_bodega', r.etapa, v_uid, (select nombre from public.profiles where id = v_uid), 'Recepción parcial de la orden ' || coalesce(v_folio, ''));
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists oc_recepciones_avanza_requisicion on public.oc_recepciones;
create trigger oc_recepciones_avanza_requisicion
  after insert on public.oc_recepciones
  for each row execute function public.oc_recepciones_avanza_requisicion();
