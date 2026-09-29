-- Cadena Laura → Delia → Alma (Mario y Laura, 29-sep-2026):
--   dirección PROGRAMA A PAGO → tesorería PAGA (y sube el comprobante) →
--   almacén/obra CONFIRMA la recepción por partida.
-- 1. Recepción de CUALQUIER OC (no solo RQ): `v_oc_recepcion` suma lo
--    confirmado en `oc_recepciones` (con `lugar` bodega/obra) y las entradas
--    de inventario ligadas a la partida. `v_oc_por_recibir`: OC pagadas
--    (pago marcado o pagada en el backoffice) con lo que falta por recibir.
--    `fn_oc_marcar_recibida(oc, lugar, nota)` cierra la OC completa de un
--    clic (rellena las partidas que falten). Confirman almacén, empresa,
--    responsable, admin y corporativo.
-- 2. Comprobante de pago: `pagos_programados.comprobante_*` (archivo en el
--    bucket `cargas/pagos/…`, lo sube la edge `pagos-comprobante`).
-- 3. `v_oc_pagos.recepcion_estado` para el estado en cadena.
-- Ya aplicado en producción.

alter table public.oc_recepciones add column if not exists lugar text not null default 'bodega' check (lugar in ('bodega', 'obra'));
alter table public.ordenes_compra
  add column if not exists recibida_en timestamptz,
  add column if not exists recibida_por uuid references public.profiles (id),
  add column if not exists recibida_lugar text check (recibida_lugar in ('bodega', 'obra')),
  add column if not exists recibida_nota text;
alter table public.pagos_programados
  add column if not exists comprobante_path text,
  add column if not exists comprobante_nombre text,
  add column if not exists comprobante_en timestamptz,
  add column if not exists comprobante_por uuid references public.profiles (id);

-- Recepción por partida de cualquier OC.
create or replace view public.v_oc_recepcion with (security_invoker = true) as
select l.id as orden_compra_linea_id, l.orden_compra_id, l.numero, l.item, l.unidad, l.cantidad,
       coalesce(r.recibido, 0) + coalesce(m.recibido, 0) as recibido,
       greatest(coalesce(l.cantidad, 0) - coalesce(r.recibido, 0) - coalesce(m.recibido, 0), 0) as pendiente,
       case when coalesce(r.recibido, 0) + coalesce(m.recibido, 0) <= 0 then 'sin_recibir'
            when coalesce(r.recibido, 0) + coalesce(m.recibido, 0) >= coalesce(l.cantidad, 0) - 0.001 then 'completo'
            else 'parcial' end as estado,
       greatest(r.ultima, m.ultima) as ultima_recepcion
from public.ordenes_compra_lineas l
left join lateral (select sum(x.cantidad) as recibido, max(x.fecha) as ultima from public.oc_recepciones x where x.orden_compra_linea_id = l.id) r on true
left join lateral (select sum(mi.cantidad) as recibido, max(mi.fecha) as ultima from public.movimientos_inventario mi where mi.linea_orden_compra_id = l.id) m on true;
grant select on public.v_oc_recepcion to authenticated;

drop view if exists public.v_oc_rq_recepcion;
create view public.v_oc_rq_recepcion with (security_invoker = true) as
select v.* from public.v_oc_recepcion v join public.ordenes_compra oc on oc.id = v.orden_compra_id and oc.fuente = 'requisicion';
grant select on public.v_oc_rq_recepcion to authenticated;

-- Quién confirma recepción: almacén, empresa, responsable, admin, corporativo.
drop policy if exists oc_recepciones_write on public.oc_recepciones;
create policy oc_recepciones_write on public.oc_recepciones for all to authenticated
  using ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol, 'almacen'::app_rol, 'empresa'::app_rol, 'responsable'::app_rol])
         and exists (select 1 from public.ordenes_compra_lineas l join public.ordenes_compra o on o.id = l.orden_compra_id
                     where l.id = oc_recepciones.orden_compra_linea_id and o.empresa_id = any ((select public.auth_empresas_alcance())::uuid[])))
  with check ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol, 'almacen'::app_rol, 'empresa'::app_rol, 'responsable'::app_rol])
         and exists (select 1 from public.ordenes_compra_lineas l join public.ordenes_compra o on o.id = l.orden_compra_id
                     where l.id = oc_recepciones.orden_compra_linea_id and o.empresa_id = any ((select public.auth_empresas_alcance())::uuid[])));

-- v_oc_pagos con estado de recepción.
drop view if exists public.v_oc_pagos;
create view public.v_oc_pagos with (security_invoker = true) as
select oc.id, oc.id_orden, oc.empresa_id, oc.proveedor, oc.proyecto, oc.total, oc.fecha_creacion, oc.fuente,
       oc.condicion_pago, oc.autorizada_en,
       coalesce(pg.pagado, 0) as pagado,
       coalesce(pg.programado, 0) as programado,
       coalesce(oc.total, 0) - coalesce(pg.pagado, 0) as saldo,
       pg.ultimo_pago, pg.proximo_pago,
       cr.clave as proveedor_clave, cr.linea_credito, cr.dias_credito, cr.vencimiento as credito_vencimiento,
       case when oc.rechazada_en is not null then 'rechazada'
            when oc.fuente = 'api' and oc.estatus_backoffice = 'Cancelada' then 'rechazada'
            when oc.fuente = 'api' and oc.estatus_backoffice = 'Pendiente de Autorización' then 'pendiente'
            when oc.fuente = 'api' or oc.autorizada_en is not null then 'autorizada'
            else 'pendiente' end as autorizacion,
       case when oc.condicion_pago = 'credito' or (oc.condicion_pago is null and cr.dias_credito is not null)
            then coalesce(oc.fecha_creacion, oc.created_at::date) + coalesce(cr.dias_credito, 30) end as vence,
       (oc.condicion_pago = 'credito' or (oc.condicion_pago is null and cr.dias_credito is not null)) as es_credito,
       oc.rechazo_motivo,
       public.fn_proveedor_clave(oc.proveedor) as clave,
       db.beneficiario as beneficiario_bancario, db.banco as banco_proveedor, db.clabe, db.cuenta as cuenta_proveedor,
       oc.estatus_backoffice, oc.tipo_pago_backoffice,
       (oc.fuente = 'api' and oc.estatus_backoffice in ('Pendiente Factura', 'Pendiente Comprobante', 'Completada')) as pagada_backoffice,
       oc.tipo,
       oc.recibida_en, oc.recibida_lugar,
       coalesce(rec.n_lineas, 0) as n_lineas,
       coalesce(rec.pendientes, 0) as cantidad_pendiente,
       case when oc.recibida_en is not null then 'recibida'
            when coalesce(rec.n_lineas, 0) = 0 then 'sin_partidas'
            when rec.n_completas = rec.n_lineas then 'recibida'
            when rec.n_completas > 0 or rec.n_parciales > 0 then 'parcial'
            else 'sin_recibir' end as recepcion_estado
from public.ordenes_compra oc
left join lateral (
  select sum(p.monto) filter (where p.estatus = 'pagado') as pagado,
         sum(p.monto) filter (where p.estatus = 'pendiente') as programado,
         max(p.pagado_en) filter (where p.estatus = 'pagado') as ultimo_pago,
         min(p.fecha_programada) filter (where p.estatus = 'pendiente') as proximo_pago
  from public.pagos_programados p where p.orden_compra_id = oc.id
) pg on true
left join lateral (
  select count(*) as n_lineas, count(*) filter (where x.estado = 'completo') as n_completas, count(*) filter (where x.estado = 'parcial') as n_parciales, sum(x.pendiente) as pendientes
  from public.v_oc_recepcion x where x.orden_compra_id = oc.id
) rec on true
left join public.proveedores_credito cr on cr.clave = public.fn_proveedor_clave(oc.proveedor)
left join public.proveedores_datos_bancarios db on db.clave = public.fn_proveedor_clave(oc.proveedor);
grant select on public.v_oc_pagos to authenticated;

-- OC pagadas (pago marcado aquí o pagada en el backoffice) para almacén/obra.
create or replace view public.v_oc_por_recibir with (security_invoker = true) as
select v.* from public.v_oc_pagos v
where v.autorizacion <> 'rechazada' and (v.pagado > 0 or v.pagada_backoffice);
grant select on public.v_oc_por_recibir to authenticated;

-- Pagos con comprobante (recrear: `p.*` se expande al crear la vista).
drop view if exists public.v_pagos_programados;
create view public.v_pagos_programados with (security_invoker = true) as
select p.*,
       e.nombre as empresa_nombre,
       oc.id_orden,
       oc.proyecto as oc_proyecto,
       public.fn_proveedor_clave(p.beneficiario) as clave,
       db.beneficiario as beneficiario_bancario, db.banco as banco_proveedor, db.clabe, db.cuenta as cuenta_proveedor, db.rfc as rfc_proveedor, db.correo as correo_proveedor
from public.pagos_programados p
join public.empresas e on e.id = p.empresa_id
left join public.ordenes_compra oc on oc.id = p.orden_compra_id
left join public.proveedores_datos_bancarios db on db.clave = public.fn_proveedor_clave(p.beneficiario);
grant select on public.v_pagos_programados to authenticated;

-- Cerrar la recepción de una OC completa de un clic.
create or replace function public.fn_oc_marcar_recibida(p_oc_id uuid, p_lugar text default 'bodega', p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_oc public.ordenes_compra%rowtype;
  r record;
begin
  if v_rol not in ('admin', 'corporativo', 'almacen', 'empresa', 'responsable') then raise exception 'Tu rol (%) no confirma recepciones', v_rol using errcode = '42501'; end if;
  if p_lugar not in ('bodega', 'obra') then raise exception 'Lugar no válido: %', p_lugar; end if;
  select * into v_oc from public.ordenes_compra where id = p_oc_id;
  if v_oc.id is null then raise exception 'Orden no encontrada'; end if;
  if not public.empresa_en_alcance(v_oc.empresa_id) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  -- Lo que falte por partida queda confirmado ahora (dispara el avance de la requisición si es RQ).
  for r in select orden_compra_linea_id, pendiente from public.v_oc_recepcion where orden_compra_id = p_oc_id and pendiente > 0 loop
    insert into public.oc_recepciones (orden_compra_linea_id, cantidad, lugar, nota, recibido_por) values (r.orden_compra_linea_id, r.pendiente, p_lugar, p_nota, v_uid);
  end loop;
  update public.ordenes_compra set recibida_en = now(), recibida_por = v_uid, recibida_lugar = p_lugar, recibida_nota = nullif(trim(coalesce(p_nota, '')), '') where id = p_oc_id;
end;
$$;
grant execute on function public.fn_oc_marcar_recibida(uuid, text, text) to authenticated;
