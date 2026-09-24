-- Catálogo de clientes por empresa (Mario, 24-sep-2026: "en los clientes de
-- Clavicón dalos de alta porque ya les vendimos", con la constancia de
-- situación fiscal). Lo usa el generador de remisiones de planta: el cliente
-- se elige del catálogo y la remisión sale con su RFC y domicilio.

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  razon_social text not null,
  nombre_comercial text,
  rfc text,
  regimen_fiscal text,
  codigo_postal text,
  domicilio text,
  email text,
  telefono text,
  notas text,
  activo boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index clientes_empresa_rfc_idx on public.clientes (empresa_id, upper(rfc)) where rfc is not null;
create index clientes_empresa_idx on public.clientes (empresa_id, activo, razon_social);

alter table public.clientes enable row level security;

create policy clientes_select on public.clientes
  for select to authenticated using (
    public.auth_rol() in ('produccion', 'admin', 'corporativo', 'direccion', 'empresa', 'almacen')
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );
create policy clientes_write on public.clientes
  for all to authenticated using (
    public.auth_rol() in ('produccion', 'admin', 'corporativo', 'empresa')
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  ) with check (
    public.auth_rol() in ('produccion', 'admin', 'corporativo', 'empresa')
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

alter table public.remisiones_produccion add column cliente_id uuid references public.clientes(id) on delete set null;

create or replace view public.v_remisiones_produccion as
 SELECT r.id, r.empresa_id, r.numero, r.folio, r.tipo, r.fecha, r.contraparte, r.proyecto_id,
    r.orden_venta_id, r.orden_compra_id, r.observaciones, r.estatus, r.emitida_por,
    r.entregada_en, r.entregada_por, r.recibio_nombre, r.created_at,
    e.nombre AS empresa_nombre, e.rfc AS empresa_rfc, e.codigo AS empresa_codigo,
    p.nombre AS emitida_por_nombre, pr.nombre AS proyecto_nombre,
    ( SELECT count(*) FROM remisiones_produccion_lineas l WHERE l.remision_id = r.id) AS lineas,
    r.cliente_id,
    c.rfc AS cliente_rfc,
    c.domicilio AS cliente_domicilio
   FROM remisiones_produccion r
     JOIN empresas e ON e.id = r.empresa_id
     LEFT JOIN profiles p ON p.id = r.emitida_por
     LEFT JOIN proyectos pr ON pr.id = r.proyecto_id
     LEFT JOIN clientes c ON c.id = r.cliente_id;

-- Alta inicial: Prefabricados Industriales y Logística, cliente de Mallas y
-- Clavos Clavicón (constancia de situación fiscal del 21-sep-2026).
insert into public.clientes (empresa_id, razon_social, rfc, regimen_fiscal, codigo_postal, domicilio, created_by)
select e.id,
  'PREFABRICADOS INDUSTRIALES Y LOGISTICA, S.A. DE C.V.',
  'PIL140328HC9',
  '601 General de Ley Personas Morales',
  '72990',
  'Calle Carril de San Cristóbal 28, Zona Industrial Chachapa, Amozoc, Puebla, C.P. 72990',
  (select id from public.profiles where rol = 'admin' order by created_at limit 1)
from public.empresas e where e.codigo = 'MCC'
on conflict do nothing;
