-- Remisión con QR para las plantas (pedido de Mario, 23-sep-2026): desde el
-- registro de entrada de materia prima y de salida de producto terminado
-- se genera una remisión en hoja membretada de la empresa (Clavicón,
-- Balken, taller), ligada a un cliente (salida) o proveedor (entrada) y
-- opcionalmente a la OV/OC y al proyecto. El QR abre la remisión en la app
-- para consultarla o confirmar la entrega. Ya aplicada en producción.
create table public.remisiones_produccion (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  numero integer not null,
  folio text generated always as ('RM-' || lpad(numero::text, 6, '0')) stored,
  tipo text not null check (tipo in ('salida', 'entrada')),
  fecha date not null default current_date,
  contraparte text not null,
  proyecto_id uuid references public.proyectos (id),
  orden_venta_id uuid references public.ordenes_venta (id),
  orden_compra_id uuid references public.ordenes_compra (id),
  observaciones text,
  estatus text not null default 'emitida' check (estatus in ('emitida', 'entregada')),
  emitida_por uuid not null references public.profiles (id),
  entregada_en timestamptz,
  entregada_por uuid references public.profiles (id),
  recibio_nombre text,
  created_at timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index remisiones_produccion_empresa_idx on public.remisiones_produccion (empresa_id, created_at desc);

create table public.remisiones_produccion_lineas (
  id uuid primary key default gen_random_uuid(),
  remision_id uuid not null references public.remisiones_produccion (id) on delete cascade,
  descripcion text not null,
  cantidad numeric(14, 4) not null check (cantidad > 0),
  unidad text not null default 'pza',
  producto_id uuid references public.productos_produccion (id),
  materia_prima_id uuid references public.materias_primas (id),
  orden integer not null default 0
);
create index remisiones_produccion_lineas_idx on public.remisiones_produccion_lineas (remision_id, orden);

create or replace function public.remisiones_produccion_before_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('remisiones_produccion:' || new.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into new.numero from public.remisiones_produccion where empresa_id = new.empresa_id;
  return new;
end;
$$;
create trigger remisiones_produccion_before_insert
  before insert on public.remisiones_produccion
  for each row execute function public.remisiones_produccion_before_insert();

alter table public.remisiones_produccion enable row level security;
alter table public.remisiones_produccion_lineas enable row level security;
create policy remisiones_produccion_select on public.remisiones_produccion
  for select using (
    public.auth_rol() in ('produccion', 'admin', 'corporativo', 'direccion', 'empresa')
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );
create policy remisiones_produccion_insert on public.remisiones_produccion
  for insert with check (
    public.auth_rol() in ('produccion', 'admin', 'corporativo')
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
    and emitida_por = (select auth.uid())
  );
create policy remisiones_produccion_lineas_select on public.remisiones_produccion_lineas
  for select using (exists (select 1 from public.remisiones_produccion r where r.id = remision_id));
create policy remisiones_produccion_lineas_insert on public.remisiones_produccion_lineas
  for insert with check (
    public.auth_rol() in ('produccion', 'admin', 'corporativo')
    and exists (select 1 from public.remisiones_produccion r where r.id = remision_id)
  );

create or replace function public.confirmar_entrega_remision_produccion(p_remision_id uuid, p_recibio_nombre text)
returns public.remisiones_produccion
language plpgsql security definer set search_path = public as $$
declare
  v_rem public.remisiones_produccion;
begin
  select * into v_rem from public.remisiones_produccion where id = p_remision_id;
  if not found then
    raise exception 'Remisión no encontrada';
  end if;
  if public.auth_rol() not in ('produccion', 'admin', 'corporativo', 'direccion', 'empresa', 'responsable')
     or not (public.auth_ve_todas_empresas() or v_rem.empresa_id = public.auth_empresa_id()) then
    raise exception 'Sin permiso para confirmar esta remisión';
  end if;
  if v_rem.estatus = 'entregada' then
    raise exception 'Esta remisión ya fue confirmada';
  end if;
  if coalesce(trim(p_recibio_nombre), '') = '' then
    raise exception 'Indica el nombre de quien recibe';
  end if;
  update public.remisiones_produccion
    set estatus = 'entregada', entregada_en = now(), entregada_por = auth.uid(), recibio_nombre = trim(p_recibio_nombre)
    where id = p_remision_id
    returning * into v_rem;
  return v_rem;
end;
$$;
revoke all on function public.confirmar_entrega_remision_produccion(uuid, text) from public;
grant execute on function public.confirmar_entrega_remision_produccion(uuid, text) to authenticated;

create view public.v_remisiones_produccion with (security_invoker = true) as
select r.*, e.nombre as empresa_nombre, e.rfc as empresa_rfc, e.codigo as empresa_codigo,
  p.nombre as emitida_por_nombre, pr.nombre as proyecto_nombre,
  (select count(*) from public.remisiones_produccion_lineas l where l.remision_id = r.id) as lineas
from public.remisiones_produccion r
join public.empresas e on e.id = r.empresa_id
left join public.profiles p on p.id = r.emitida_por
left join public.proyectos pr on pr.id = r.proyecto_id;
grant select on public.v_remisiones_produccion to authenticated;
