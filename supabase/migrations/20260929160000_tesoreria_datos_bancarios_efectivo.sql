-- Tesorería (Delia, rol corporativo) paga lo que dirección programó
-- (Mario, 29-sep-2026):
-- 1. `proveedores_datos_bancarios`: beneficiario, banco, CLABE, cuenta, RFC
--    y correo por proveedor (misma clave que proveedores_credito). Nunca
--    datos de tarjeta. Los ven admin/corporativo/direccion/empresa (no
--    almacén); capturan admin/corporativo/direccion.
-- 2. Pago en efectivo: condición 'efectivo' en la OC y `pagos_programados.
--    metodo` (transferencia / efectivo / cheque). El módulo completo de
--    caja en efectivo (Jaime) viene después; por ahora el pago queda
--    marcado y no cuenta contra el saldo bancario.
-- 3. `v_oc_pagos` trae los datos bancarios del proveedor; `v_pagos_programados`
--    trae pago + OC + datos bancarios para la pantalla de tesorería.
-- Ya aplicado en producción.

create table if not exists public.proveedores_datos_bancarios (
  clave text primary key,
  nombre text not null,
  beneficiario text,
  banco text,
  clabe text,
  cuenta text,
  rfc text,
  correo text,
  notas text,
  grupo_id uuid references public.grupos (id),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
alter table public.proveedores_datos_bancarios enable row level security;
create policy frontera_organizacion on public.proveedores_datos_bancarios as restrictive for all
  using (grupo_id is null or grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id is null or grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
create policy proveedores_datos_bancarios_select on public.proveedores_datos_bancarios for select
  using ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol, 'direccion'::app_rol, 'empresa'::app_rol]));
create policy proveedores_datos_bancarios_write on public.proveedores_datos_bancarios for all
  using ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol, 'direccion'::app_rol]))
  with check ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol, 'direccion'::app_rol]));

alter table public.ordenes_compra drop constraint if exists ordenes_compra_condicion_pago_check;
alter table public.ordenes_compra add constraint ordenes_compra_condicion_pago_check check (condicion_pago in ('contado', 'credito', 'anticipo', 'efectivo'));

alter table public.pagos_programados add column if not exists metodo text not null default 'transferencia' check (metodo in ('transferencia', 'efectivo', 'cheque'));

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
            when oc.fuente = 'api' or oc.autorizada_en is not null then 'autorizada'
            else 'pendiente' end as autorizacion,
       case when oc.condicion_pago = 'credito' or (oc.condicion_pago is null and cr.dias_credito is not null)
            then coalesce(oc.fecha_creacion, oc.created_at::date) + coalesce(cr.dias_credito, 30) end as vence,
       (oc.condicion_pago = 'credito' or (oc.condicion_pago is null and cr.dias_credito is not null)) as es_credito,
       oc.rechazo_motivo,
       public.fn_proveedor_clave(oc.proveedor) as clave,
       db.beneficiario as beneficiario_bancario, db.banco as banco_proveedor, db.clabe, db.cuenta as cuenta_proveedor
from public.ordenes_compra oc
left join lateral (
  select sum(p.monto) filter (where p.estatus = 'pagado') as pagado,
         sum(p.monto) filter (where p.estatus = 'pendiente') as programado,
         max(p.pagado_en) filter (where p.estatus = 'pagado') as ultimo_pago,
         min(p.fecha_programada) filter (where p.estatus = 'pendiente') as proximo_pago
  from public.pagos_programados p where p.orden_compra_id = oc.id
) pg on true
left join public.proveedores_credito cr on cr.clave = public.fn_proveedor_clave(oc.proveedor)
left join public.proveedores_datos_bancarios db on db.clave = public.fn_proveedor_clave(oc.proveedor);
grant select on public.v_oc_pagos to authenticated;

create or replace view public.v_pagos_programados with (security_invoker = true) as
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

create or replace function public.fn_oc_condicion_pago(p_oc_id uuid, p_condicion text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rol app_rol := public.auth_rol();
  v_empresa uuid;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then raise exception 'Solo dirección asigna la condición de pago' using errcode = '42501'; end if;
  if p_condicion is not null and p_condicion not in ('contado', 'credito', 'anticipo', 'efectivo') then raise exception 'Condición no válida: %', p_condicion; end if;
  select empresa_id into v_empresa from public.ordenes_compra where id = p_oc_id;
  if v_empresa is null then raise exception 'Orden no encontrada'; end if;
  if not public.empresa_en_alcance(v_empresa) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  update public.ordenes_compra set condicion_pago = p_condicion, condicion_por = (select auth.uid()), condicion_en = now() where id = p_oc_id;
end;
$$;

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
  if p_condicion not in ('contado', 'credito', 'anticipo', 'efectivo') then raise exception 'Condición no válida: %', p_condicion; end if;
  select * into v_oc from public.ordenes_compra where id = p_oc_id;
  if v_oc.id is null then raise exception 'Orden no encontrada'; end if;
  if not public.empresa_en_alcance(v_oc.empresa_id) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  if v_oc.rechazada_en is not null then raise exception 'La orden % está rechazada; no se programa pago', v_oc.id_orden; end if;
  if v_oc.fuente <> 'api' and v_oc.autorizada_en is null then raise exception 'La orden % está pendiente de autorización; autorízala primero', v_oc.id_orden; end if;
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_programados where orden_compra_id = p_oc_id and estatus = 'pagado';
  v_saldo := coalesce(v_oc.total, 0) - v_pagado;
  v_monto := coalesce(p_monto, v_saldo);
  if v_monto <= 0 then raise exception 'La orden no tiene saldo pendiente'; end if;
  if v_monto > v_saldo + 0.01 then raise exception 'El monto (%) rebasa el saldo pendiente de la orden (%)', v_monto, v_saldo; end if;
  select dias_credito into v_dias from public.proveedores_credito where clave = public.fn_proveedor_clave(v_oc.proveedor);
  v_fecha := coalesce(p_fecha, case when p_condicion = 'credito' then coalesce(v_oc.fecha_creacion, v_oc.created_at::date, current_date) + coalesce(v_dias, 30) else current_date end);
  if v_fecha < current_date then v_fecha := current_date; end if;

  update public.ordenes_compra set condicion_pago = p_condicion, condicion_por = v_uid, condicion_en = now() where id = p_oc_id;
  insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, referencia, notas, created_by, orden_compra_id, metodo)
  values (v_oc.empresa_id, case when p_condicion = 'efectivo' then null else p_cuenta_id end, coalesce(v_oc.proveedor, 'Proveedor'),
    case p_condicion when 'anticipo' then 'Anticipo OC ' when 'efectivo' then 'Efectivo OC ' else 'OC ' end || v_oc.id_orden || coalesce(' · ' || v_oc.proyecto, ''),
    round(v_monto, 2), v_fecha, v_oc.id_orden, nullif(trim(coalesce(p_notas, '')), ''), v_uid, p_oc_id,
    case when p_condicion = 'efectivo' then 'efectivo' else 'transferencia' end)
  returning id into v_pago;
  if v_oc.fuente = 'requisicion' and v_oc.pago_programado_id is null then
    update public.ordenes_compra set pago_programado_id = v_pago where id = p_oc_id;
  end if;
  return v_pago;
end;
$$;
