-- Remisión de salida de almacén con código QR (pedido de Mario, 21-sep-2026).
-- Una remisión agrupa las líneas de una misma salida (varios movimientos
-- de inventario) bajo un folio consecutivo por empresa, se imprime con un
-- QR que abre la remisión en la app (para consultarla o confirmar la
-- entrega desde el celular) y deja rastro de quién la emitió y quién la
-- recibió. Los movimientos siguen siendo el historial de existencias; la
-- remisión solo los agrupa y documenta.

create table public.remisiones_salida (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  almacen_id uuid not null references public.almacenes (id),
  -- Consecutivo por empresa, lo asigna el trigger de abajo.
  numero integer not null,
  folio text generated always as ('REM-' || lpad(numero::text, 6, '0')) stored,
  fecha date not null default current_date,
  -- A quién se entrega (cliente, obra, cuadrilla, persona).
  entregar_a text not null,
  -- Dónde (obra, dirección, sucursal) -- libre.
  destino text,
  orden_venta_id uuid references public.ordenes_venta (id),
  observaciones text,
  estatus text not null default 'emitida' check (estatus in ('emitida', 'entregada')),
  emitida_por uuid not null references public.profiles (id),
  entregada_en timestamptz,
  entregada_por uuid references public.profiles (id),
  recibio_nombre text,
  created_at timestamptz not null default now(),
  unique (empresa_id, numero)
);

create index remisiones_salida_empresa_idx on public.remisiones_salida (empresa_id, created_at desc);

create or replace function public.remisiones_salida_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.almacenes where id = new.almacen_id and empresa_id = new.empresa_id) then
    raise exception 'El almacén no pertenece a la empresa de la remisión';
  end if;
  if new.orden_venta_id is not null
    and not exists (select 1 from public.ordenes_venta where id = new.orden_venta_id and empresa_id = new.empresa_id) then
    raise exception 'La orden de venta no pertenece a la empresa de la remisión';
  end if;
  -- Consecutivo por empresa sin huecos ni duplicados aunque dos personas
  -- guarden al mismo tiempo: candado por empresa dentro de la transacción.
  perform pg_advisory_xact_lock(hashtext('remisiones_salida:' || new.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into new.numero from public.remisiones_salida where empresa_id = new.empresa_id;
  return new;
end;
$$;

create trigger remisiones_salida_before_insert
  before insert on public.remisiones_salida
  for each row
  execute function public.remisiones_salida_before_insert();

alter table public.movimientos_inventario add column remision_id uuid references public.remisiones_salida (id);
create index movimientos_inventario_remision_idx on public.movimientos_inventario (remision_id) where remision_id is not null;

-- Solo una salida real (no ajuste) puede ir en una remisión.
alter table public.movimientos_inventario
  add constraint movimientos_inventario_remision_check check (remision_id is null or (tipo = 'salida' and not es_ajuste));

-- Extiende la validación de empresa (misma función que ya cubre almacén /
-- producto / OC / OV / nota de entrega) para remision_id.
create or replace function public.validar_empresa_movimiento_inventario()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.almacenes where id = new.almacen_id and empresa_id = new.empresa_id) then
    raise exception 'El almacén no pertenece a la empresa del movimiento';
  end if;
  if not exists (select 1 from public.productos where id = new.producto_id and empresa_id = new.empresa_id) then
    raise exception 'El producto no pertenece a la empresa del movimiento';
  end if;
  if new.orden_compra_id is not null
    and not exists (select 1 from public.ordenes_compra where id = new.orden_compra_id and empresa_id = new.empresa_id) then
    raise exception 'La orden de compra no pertenece a la empresa del movimiento';
  end if;
  if new.orden_venta_id is not null
    and not exists (select 1 from public.ordenes_venta where id = new.orden_venta_id and empresa_id = new.empresa_id) then
    raise exception 'La orden de venta no pertenece a la empresa del movimiento';
  end if;
  if new.nota_entrega_id is not null
    and not exists (select 1 from public.notas_entrega where id = new.nota_entrega_id and empresa_id = new.empresa_id) then
    raise exception 'La nota de entrega no pertenece a la empresa del movimiento';
  end if;
  if new.remision_id is not null
    and not exists (select 1 from public.remisiones_salida where id = new.remision_id and empresa_id = new.empresa_id and almacen_id = new.almacen_id) then
    raise exception 'La remisión no pertenece a la empresa/almacén del movimiento';
  end if;
  return new;
end;
$$;

-- RLS: mismo alcance que movimientos_inventario. Sin UPDATE/DELETE directo:
-- la única edición posterior es confirmar la entrega, vía la función de
-- abajo, para que la remisión impresa nunca deje de coincidir con la
-- guardada.
alter table public.remisiones_salida enable row level security;

create policy remisiones_salida_select on public.remisiones_salida
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy remisiones_salida_insert on public.remisiones_salida
  for insert
  with check (
    public.auth_puede_escribir_inventario()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
    and emitida_por = (select auth.uid())
  );

-- Confirmar entrega: quien escanea el QR en el destino. Además de quien
-- escribe inventario, puede hacerlo un responsable de obra de la misma
-- empresa (es quien recibe el material).
create or replace function public.confirmar_entrega_remision(p_remision_id uuid, p_recibio_nombre text)
returns public.remisiones_salida
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rem public.remisiones_salida;
begin
  select * into v_rem from public.remisiones_salida where id = p_remision_id;
  if not found then
    raise exception 'Remisión no encontrada';
  end if;
  if not (
    (public.auth_puede_escribir_inventario() or public.auth_rol() = 'responsable')
    and (public.auth_ve_todas_empresas() or v_rem.empresa_id = public.auth_empresa_id())
  ) then
    raise exception 'Sin permiso para confirmar esta remisión';
  end if;
  if v_rem.estatus = 'entregada' then
    raise exception 'Esta remisión ya fue confirmada como entregada';
  end if;
  if coalesce(trim(p_recibio_nombre), '') = '' then
    raise exception 'Indica el nombre de quien recibe';
  end if;
  update public.remisiones_salida
    set estatus = 'entregada', entregada_en = now(), entregada_por = auth.uid(), recibio_nombre = trim(p_recibio_nombre)
    where id = p_remision_id
    returning * into v_rem;
  return v_rem;
end;
$$;

revoke all on function public.confirmar_entrega_remision(uuid, text) from public;
grant execute on function public.confirmar_entrega_remision(uuid, text) to authenticated;

-- Listado con conteo de líneas y nombres, respetando RLS del invocador.
create view public.v_remisiones_salida with (security_invoker = true) as
select r.id, r.empresa_id, e.nombre as empresa_nombre, r.almacen_id, a.nombre as almacen_nombre,
  r.numero, r.folio, r.fecha, r.entregar_a, r.destino, r.orden_venta_id, r.observaciones, r.estatus,
  r.emitida_por, pe.nombre as emitida_por_nombre, r.entregada_en, r.entregada_por, pr.nombre as entregada_por_nombre,
  r.recibio_nombre, r.created_at,
  (select count(*) from public.movimientos_inventario m where m.remision_id = r.id) as lineas,
  (select coalesce(sum(m.cantidad), 0) from public.movimientos_inventario m where m.remision_id = r.id) as cantidad_total
from public.remisiones_salida r
join public.empresas e on e.id = r.empresa_id
join public.almacenes a on a.id = r.almacen_id
left join public.profiles pe on pe.id = r.emitida_por
left join public.profiles pr on pr.id = r.entregada_por;
