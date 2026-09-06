-- Módulo Precios Unitarios (2/3): factores de sobrecosto, tarjetas de análisis
-- y sus renglones (insumos o análisis básicos anidados).

create function auth_puede_escribir_pu() returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.auth_rol() in ('corporativo', 'empresa', 'admin', 'direccion')
$$;

comment on function auth_puede_escribir_pu is
  'Quién puede armar precios unitarios. Más amplio que auth_puede_escribir() porque dirección de obra cotiza, aunque no toque bancos ni CFDI.';

create table pu_factores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nombre text not null,
  indirectos_pct numeric(7,4) not null default 0 check (indirectos_pct >= 0),
  financiamiento_pct numeric(7,4) not null default 0 check (financiamiento_pct >= 0),
  utilidad_pct numeric(7,4) not null default 0 check (utilidad_pct >= 0),
  cargos_adicionales_pct numeric(7,4) not null default 0 check (cargos_adicionales_pct >= 0),
  vigente_desde date not null default current_date,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, nombre, vigente_desde)
);

comment on table pu_factores is
  'Juegos de factores de sobrecosto por empresa (indirectos, financiamiento, utilidad, cargos adicionales). Se versionan por vigente_desde en vez de editarse, para que un análisis firmado el año pasado no cambie de precio solo porque hoy subió la utilidad.';
comment on column pu_factores.indirectos_pct is
  'Fracción, NO porcentaje: 15% se guarda como 0.1500. Los cuatro factores se aplican en cascada (ver v_pu_analisis_costeo).';

create trigger set_updated_at before update on pu_factores
  for each row execute function set_updated_at();

create table pu_analisis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  proyecto_id uuid references proyectos(id) on delete set null,
  codigo text not null,
  concepto text not null,
  unidad text not null,
  es_auxiliar boolean not null default false,
  factor_id uuid references pu_factores(id) on delete set null,
  estado text not null default 'borrador' check (estado in ('borrador', 'vigente', 'obsoleto')),
  notas text,
  creado_por uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

comment on table pu_analisis is
  'Una tarjeta de análisis de precio unitario. proyecto_id NULL = concepto de biblioteca reutilizable; con valor = análisis atado a esa obra.';
comment on column pu_analisis.es_auxiliar is
  'true = análisis básico (mortero, habilitado de acero, cuadrilla). Se consume dentro de otros análisis a costo directo y NUNCA carga factores de sobrecosto -- si los cargara, los indirectos se cobrarían dos veces.';
comment on column pu_analisis.factor_id is
  'NULL en un análisis no auxiliar significa precio unitario = costo directo. Es válido (comparativos internos) pero no es un precio de venta.';

create index pu_analisis_empresa_idx on pu_analisis (empresa_id, estado);
create index pu_analisis_proyecto_idx on pu_analisis (proyecto_id) where proyecto_id is not null;

create trigger set_updated_at before update on pu_analisis
  for each row execute function set_updated_at();

create table pu_analisis_items (
  id uuid primary key default gen_random_uuid(),
  analisis_id uuid not null references pu_analisis(id) on delete cascade,
  insumo_id uuid references pu_insumos(id) on delete restrict,
  analisis_hijo_id uuid references pu_analisis(id) on delete restrict,
  cantidad numeric(16,6) not null check (cantidad >= 0),
  rendimiento numeric(16,6) not null default 1 check (rendimiento > 0),
  costo_congelado numeric(14,4) check (costo_congelado >= 0),
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  constraint pu_analisis_items_una_fuente check (num_nonnulls(insumo_id, analisis_hijo_id) = 1),
  constraint pu_analisis_items_no_autoref check (analisis_hijo_id is null or analisis_hijo_id <> analisis_id)
);

comment on table pu_analisis_items is
  'Renglones de una tarjeta. Cada renglón es un insumo del catálogo O un análisis básico anidado, nunca ambos (pu_analisis_items_una_fuente).';
comment on column pu_analisis_items.rendimiento is
  'Divisor de la cantidad: la aportación del renglón es cantidad / rendimiento. Para materiales se deja en 1 y se captura la cantidad; para mano de obra se captura cantidad=1 y el rendimiento de la cuadrilla (jornadas por unidad).';
comment on column pu_analisis_items.costo_congelado is
  'Si tiene valor, gana sobre el costo vivo del catálogo. Sirve para respetar una cotización cerrada de proveedor en ese renglón sin ensuciar el precio del insumo para el resto del grupo.';

create index pu_analisis_items_analisis_idx on pu_analisis_items (analisis_id, orden);
create index pu_analisis_items_hijo_idx on pu_analisis_items (analisis_hijo_id) where analisis_hijo_id is not null;

-- El proyecto tiene que ser de la misma empresa que el análisis; si no, el
-- costo de una obra terminaría colgado de otra razón social.
create function validar_empresa_pu_analisis() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.proyecto_id is not null
     and not exists (
       select 1 from proyectos p
       where p.id = new.proyecto_id and p.empresa_id = new.empresa_id
     ) then
    raise exception 'El proyecto % no pertenece a la empresa % del análisis', new.proyecto_id, new.empresa_id;
  end if;
  return new;
end;
$$;

create trigger validar_empresa_pu_analisis
  before insert or update on pu_analisis
  for each row execute function validar_empresa_pu_analisis();

-- Un análisis básico anidado no puede terminar consumiéndose a sí mismo:
-- fn_pu_costo_directo se colgaría. Se baja por la descendencia del hijo y se
-- rechaza si aparece el padre.
create function validar_ciclo_pu_analisis() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.analisis_hijo_id is null then
    return new;
  end if;

  if not exists (
    select 1 from pu_analisis padre, pu_analisis hijo
    where padre.id = new.analisis_id
      and hijo.id = new.analisis_hijo_id
      and padre.empresa_id = hijo.empresa_id
  ) then
    raise exception 'El análisis básico % es de otra empresa que el análisis %', new.analisis_hijo_id, new.analisis_id;
  end if;

  if exists (
    with recursive descendencia as (
      select new.analisis_hijo_id as id
      union all
      select i.analisis_hijo_id
      from pu_analisis_items i
      join descendencia d on i.analisis_id = d.id
      where i.analisis_hijo_id is not null
    )
    select 1 from descendencia where id = new.analisis_id
  ) then
    raise exception 'Ciclo detectado: el análisis % ya consume (directa o indirectamente) al análisis %',
      new.analisis_hijo_id, new.analisis_id;
  end if;

  return new;
end;
$$;

create trigger validar_ciclo_pu_analisis
  before insert or update on pu_analisis_items
  for each row execute function validar_ciclo_pu_analisis();

alter table pu_factores enable row level security;
alter table pu_analisis enable row level security;
alter table pu_analisis_items enable row level security;

create policy pu_factores_select on pu_factores
  for select using (
    auth_rol() <> 'pendiente'
    and (auth_ve_todas_empresas() or empresa_id = auth_empresa_id())
  );

create policy pu_factores_write on pu_factores
  for all
  using (auth_puede_escribir_pu() and (auth_ve_todas_empresas() or empresa_id = auth_empresa_id()))
  with check (auth_puede_escribir_pu() and (auth_ve_todas_empresas() or empresa_id = auth_empresa_id()));

create policy pu_analisis_select on pu_analisis
  for select using (
    auth_rol() <> 'pendiente'
    and (
      auth_ve_todas_empresas()
      or empresa_id = auth_empresa_id()
      or exists (
        select 1 from proyectos p
        where p.id = pu_analisis.proyecto_id
          and ((select auth.uid()) in (p.responsable_id, p.comprador_id))
      )
    )
  );

create policy pu_analisis_write on pu_analisis
  for all
  using (auth_puede_escribir_pu() and (auth_ve_todas_empresas() or empresa_id = auth_empresa_id()))
  with check (auth_puede_escribir_pu() and (auth_ve_todas_empresas() or empresa_id = auth_empresa_id()));

create policy pu_analisis_items_select on pu_analisis_items
  for select using (
    exists (select 1 from pu_analisis a where a.id = pu_analisis_items.analisis_id)
  );

create policy pu_analisis_items_write on pu_analisis_items
  for all
  using (
    auth_puede_escribir_pu()
    and exists (
      select 1 from pu_analisis a
      where a.id = pu_analisis_items.analisis_id
        and (auth_ve_todas_empresas() or a.empresa_id = auth_empresa_id())
    )
  )
  with check (
    auth_puede_escribir_pu()
    and exists (
      select 1 from pu_analisis a
      where a.id = pu_analisis_items.analisis_id
        and (auth_ve_todas_empresas() or a.empresa_id = auth_empresa_id())
    )
  );

grant select, insert, update, delete on pu_factores to authenticated;
grant select, insert, update, delete on pu_analisis to authenticated;
grant select, insert, update, delete on pu_analisis_items to authenticated;