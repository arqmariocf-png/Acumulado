-- Módulo Precios Unitarios (1/3): catálogo de insumos e historial de costos.
--
-- Mismo criterio que materias_primas: el insumo NO guarda un costo fijo. El
-- costo vigente se deriva siempre del historial (pu_insumo_precios) vía
-- fn_pu_costo_insumo, para que un análisis hecho hoy y otro hecho en marzo
-- puedan reproducirse con el precio que realmente estaba vigente ese día.

create type pu_tipo_insumo as enum ('material', 'mano_obra', 'herramienta', 'equipo', 'auxiliar');

create table pu_insumos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  descripcion text not null,
  unidad text not null,
  tipo pu_tipo_insumo not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table pu_insumos is
  'Catálogo maestro de insumos del grupo para análisis de precios unitarios. Es del grupo, no de una empresa: el precio sí puede variar por empresa y eso vive en pu_insumo_precios.empresa_id.';
comment on column pu_insumos.tipo is
  'material/mano_obra/herramienta/equipo se cotizan; auxiliar marca un insumo que en realidad se resuelve con un análisis básico (ver pu_analisis.es_auxiliar).';

create index pu_insumos_tipo_idx on pu_insumos (tipo) where activo;

create trigger set_updated_at before update on pu_insumos
  for each row execute function set_updated_at();

create table pu_insumo_precios (
  id uuid primary key default gen_random_uuid(),
  insumo_id uuid not null references pu_insumos(id) on delete cascade,
  empresa_id uuid references empresas(id) on delete cascade,
  costo numeric(14,4) not null check (costo >= 0),
  fecha_vigencia date not null default current_date,
  fuente text,
  orden_compra_id uuid references ordenes_compra(id) on delete set null,
  creado_por uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table pu_insumo_precios is
  'Historial de costos por insumo. Nunca se actualiza un renglón para "corregir" el precio: se inserta uno nuevo con otra fecha_vigencia, así el costeo de un análisis viejo sigue siendo reproducible.';
comment on column pu_insumo_precios.empresa_id is
  'NULL = precio del grupo (default). Con valor = precio propio de esa empresa, que le gana al del grupo en fn_pu_costo_insumo.';
comment on column pu_insumo_precios.orden_compra_id is
  'Opcional: la OC real que respalda este costo, para poder auditar de dónde salió el precio en vez de creerle a una captura suelta.';

create index pu_insumo_precios_lookup_idx
  on pu_insumo_precios (insumo_id, fecha_vigencia desc, created_at desc);

-- Costo vigente de un insumo a una fecha. El precio propio de la empresa gana
-- sobre el del grupo; entre precios del mismo alcance gana el más reciente que
-- ya haya entrado en vigor.
create function fn_pu_costo_insumo(
  p_insumo_id uuid,
  p_empresa_id uuid default null,
  p_fecha date default current_date
) returns numeric
language sql
stable
set search_path to 'public'
as $$
  select pr.costo
  from pu_insumo_precios pr
  where pr.insumo_id = p_insumo_id
    and pr.fecha_vigencia <= p_fecha
    and (pr.empresa_id is null or pr.empresa_id = p_empresa_id)
  order by (pr.empresa_id is not null) desc, pr.fecha_vigencia desc, pr.created_at desc
  limit 1
$$;

comment on function fn_pu_costo_insumo is
  'Costo vigente de un insumo para una empresa a una fecha. Devuelve NULL si el insumo nunca se ha cotizado -- el llamador debe distinguir "sin precio" de "cuesta cero".';

alter table pu_insumos enable row level security;
alter table pu_insumo_precios enable row level security;

create policy pu_insumos_select on pu_insumos
  for select using (auth_rol() <> 'pendiente');

create policy pu_insumos_write on pu_insumos
  for all
  using (auth_rol() = any (array['admin'::app_rol, 'corporativo'::app_rol, 'direccion'::app_rol]))
  with check (auth_rol() = any (array['admin'::app_rol, 'corporativo'::app_rol, 'direccion'::app_rol]));

create policy pu_insumo_precios_select on pu_insumo_precios
  for select using (
    auth_rol() <> 'pendiente'
    and (empresa_id is null or auth_ve_todas_empresas() or empresa_id = auth_empresa_id())
  );

create policy pu_insumo_precios_write on pu_insumo_precios
  for all
  using (
    auth_rol() = any (array['admin'::app_rol, 'corporativo'::app_rol, 'direccion'::app_rol])
    and (empresa_id is null or auth_ve_todas_empresas() or empresa_id = auth_empresa_id())
  )
  with check (
    auth_rol() = any (array['admin'::app_rol, 'corporativo'::app_rol, 'direccion'::app_rol])
    and (empresa_id is null or auth_ve_todas_empresas() or empresa_id = auth_empresa_id())
  );

grant select, insert, update, delete on pu_insumos to authenticated;
grant select, insert, update, delete on pu_insumo_precios to authenticated;