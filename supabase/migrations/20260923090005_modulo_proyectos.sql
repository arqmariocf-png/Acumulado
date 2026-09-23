-- ── Módulo de Proyectos: proyecto, diseño (planos) y cotizaciones ───────
--
-- Es el módulo con el que entra ARSSA. Tres cosas encadenadas:
--   proyecto -> sus planos (con revisiones) -> sus cotizaciones (con partidas).
--
-- proyectos.empresa_id es OPCIONAL a propósito: una organización nueva puede
-- estar trabajando proyectos antes de tener dadas de alta sus razones
-- sociales (es justo el caso de ARSSA hoy). El tenant real es grupo_id.

insert into public.modulos (clave, nombre, descripcion, orden) values
  ('proyectos', 'Proyectos', 'Proyectos, diseño de planos con revisiones y cotizaciones con partidas.', 5);

-- ARSSA entra con este módulo; Loma no lo ocupa por ahora.
insert into public.grupo_modulos (grupo_id, modulo_clave, habilitado, habilitado_at)
select g.id, 'proyectos', g.codigo = 'ARSSA', case when g.codigo = 'ARSSA' then now() end
from public.grupos g;

create table public.proyectos (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id) on delete cascade,
  empresa_id uuid references public.empresas (id),
  clave text not null,
  nombre text not null,
  cliente text,
  responsable text,
  ubicacion text,
  descripcion text,
  fecha_inicio date,
  fecha_fin_estimada date,
  estatus text not null default 'prospecto' check (
    estatus in ('prospecto', 'en_diseno', 'en_revision', 'aprobado', 'en_obra', 'terminado', 'cancelado')
  ),
  activo boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index proyectos_grupo_clave_key on public.proyectos (grupo_id, clave);
create index proyectos_grupo_idx on public.proyectos (grupo_id);
create index proyectos_empresa_idx on public.proyectos (empresa_id);
create index proyectos_created_by_idx on public.proyectos (created_by);

create trigger proyectos_set_updated_at
  before update on public.proyectos
  for each row execute function public.set_updated_at();

create trigger proyectos_set_grupo
  before insert on public.proyectos
  for each row execute function public.set_grupo_id_del_usuario();

-- Una lámina ("A-01") existe en varias revisiones y cada una es una fila: el
-- historial de diseño no se reescribe, se agrega. La vigente es la revisión
-- más reciente que no esté marcada como obsoleta.
create table public.planos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  clave text not null,
  nombre text not null,
  disciplina text not null default 'arquitectonico' check (
    disciplina in ('arquitectonico', 'estructural', 'instalaciones', 'acabados', 'topografia', 'otro')
  ),
  revision text not null default 'A',
  estatus text not null default 'en_diseno' check (
    estatus in ('en_diseno', 'en_revision', 'aprobado', 'para_obra', 'obsoleto')
  ),
  escala text,
  fecha date not null default current_date,
  storage_path text,
  notas text,
  subido_por uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create unique index planos_proyecto_clave_revision_key on public.planos (proyecto_id, clave, revision);
create index planos_proyecto_idx on public.planos (proyecto_id);
create index planos_subido_por_idx on public.planos (subido_por);

create table public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  folio text not null,
  cliente text,
  fecha date not null default current_date,
  vigencia_dias integer not null default 15 check (vigencia_dias >= 0),
  moneda text not null default 'MXN',
  iva_tasa numeric(5, 4) not null default 0.16 check (iva_tasa >= 0 and iva_tasa < 1),
  estatus text not null default 'borrador' check (
    estatus in ('borrador', 'enviada', 'aceptada', 'rechazada', 'vencida')
  ),
  notas text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index cotizaciones_proyecto_folio_key on public.cotizaciones (proyecto_id, folio);
create index cotizaciones_proyecto_idx on public.cotizaciones (proyecto_id);
create index cotizaciones_created_by_idx on public.cotizaciones (created_by);

create trigger cotizaciones_set_updated_at
  before update on public.cotizaciones
  for each row execute function public.set_updated_at();

-- El importe de la partida se calcula, no se captura: es el mismo criterio
-- que ya usa este proyecto para el saldo bancario y para las existencias de
-- inventario -- un total capturado a mano se desincroniza en cuanto alguien
-- corrige la cantidad.
create table public.cotizacion_partidas (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references public.cotizaciones (id) on delete cascade,
  orden integer not null default 0,
  concepto text not null,
  unidad text not null default 'PZA',
  cantidad numeric(14, 3) not null check (cantidad > 0),
  precio_unitario numeric(14, 2) not null check (precio_unitario >= 0),
  importe numeric(16, 2) generated always as (round(cantidad * precio_unitario, 2)) stored
);

create index cotizacion_partidas_cotizacion_idx on public.cotizacion_partidas (cotizacion_id, orden);

create view public.v_cotizacion_totales with (security_invoker = true) as
select
  c.id as cotizacion_id,
  c.proyecto_id,
  c.folio,
  c.estatus,
  c.moneda,
  c.fecha,
  (c.fecha + c.vigencia_dias) as vigente_hasta,
  count(p.id) as partidas,
  coalesce(sum(p.importe), 0) as subtotal,
  round(coalesce(sum(p.importe), 0) * c.iva_tasa, 2) as iva,
  round(coalesce(sum(p.importe), 0) * (1 + c.iva_tasa), 2) as total
from public.cotizaciones c
left join public.cotizacion_partidas p on p.cotizacion_id = c.id
group by c.id;

-- ── Alcance ─────────────────────────────────────────────────────────────
-- Planos, cotizaciones y partidas cuelgan del proyecto, y el proyecto del
-- grupo: una sola función resuelve la frontera para las tres.
create or replace function public.proyecto_en_alcance(p_proyecto_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_admin_global()
      or exists (
        select 1 from public.proyectos p
        where p.id = p_proyecto_id
          and p.grupo_id = public.auth_grupo_id()
          and (p.empresa_id is null or public.empresa_en_alcance(p.empresa_id))
      )
$$;

create or replace function public.cotizacion_en_alcance(p_cotizacion_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.cotizaciones c
    where c.id = p_cotizacion_id and public.proyecto_en_alcance(c.proyecto_id)
  )
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.proyectos enable row level security;
alter table public.planos enable row level security;
alter table public.cotizaciones enable row level security;
alter table public.cotizacion_partidas enable row level security;

create policy proyectos_select on public.proyectos for select
  using (
    public.auth_rol() <> 'pendiente'
    and public.auth_modulo_habilitado('proyectos')
    and public.grupo_en_alcance(grupo_id)
    and (empresa_id is null or public.empresa_en_alcance(empresa_id))
  );

create policy proyectos_insert on public.proyectos for insert
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.grupo_en_alcance(grupo_id)
    and (empresa_id is null or public.empresa_en_alcance(empresa_id))
  );

create policy proyectos_update on public.proyectos for update
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.grupo_en_alcance(grupo_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.grupo_en_alcance(grupo_id)
    and (empresa_id is null or public.empresa_en_alcance(empresa_id))
  );

create policy proyectos_delete on public.proyectos for delete
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.grupo_en_alcance(grupo_id)
  );

create policy planos_select on public.planos for select
  using (
    public.auth_rol() <> 'pendiente'
    and public.auth_modulo_habilitado('proyectos')
    and public.proyecto_en_alcance(proyecto_id)
  );

create policy planos_insert on public.planos for insert
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.proyecto_en_alcance(proyecto_id)
    and subido_por = (select auth.uid())
  );

create policy planos_update on public.planos for update
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.proyecto_en_alcance(proyecto_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.proyecto_en_alcance(proyecto_id)
  );

create policy planos_delete on public.planos for delete
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.proyecto_en_alcance(proyecto_id)
  );

create policy cotizaciones_select on public.cotizaciones for select
  using (
    public.auth_rol() <> 'pendiente'
    and public.auth_modulo_habilitado('proyectos')
    and public.proyecto_en_alcance(proyecto_id)
  );

create policy cotizaciones_insert on public.cotizaciones for insert
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.proyecto_en_alcance(proyecto_id)
  );

create policy cotizaciones_update on public.cotizaciones for update
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.proyecto_en_alcance(proyecto_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.proyecto_en_alcance(proyecto_id)
  );

create policy cotizaciones_delete on public.cotizaciones for delete
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.proyecto_en_alcance(proyecto_id)
  );

create policy cotizacion_partidas_select on public.cotizacion_partidas for select
  using (
    public.auth_rol() <> 'pendiente'
    and public.auth_modulo_habilitado('proyectos')
    and public.cotizacion_en_alcance(cotizacion_id)
  );

create policy cotizacion_partidas_insert on public.cotizacion_partidas for insert
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.cotizacion_en_alcance(cotizacion_id)
  );

create policy cotizacion_partidas_update on public.cotizacion_partidas for update
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.cotizacion_en_alcance(cotizacion_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.cotizacion_en_alcance(cotizacion_id)
  );

create policy cotizacion_partidas_delete on public.cotizacion_partidas for delete
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.cotizacion_en_alcance(cotizacion_id)
  );

-- ── Archivos de planos ──────────────────────────────────────────────────
-- Bucket privado con policies por prefijo de ruta: el primer folder del
-- nombre es el grupo_id, y esa es la frontera. A diferencia de `cargas`
-- (que solo tocan los edge functions), aquí el frontend sube y descarga
-- directo, así que las policies de storage tienen que ser reales.
insert into storage.buckets (id, name, public)
values ('proyectos', 'proyectos', false)
on conflict (id) do nothing;

-- Un cast directo a uuid dentro de la policy reventaría la consulta con
-- cualquier objeto cuyo primer folder no sea un uuid (y Postgres no
-- garantiza evaluar antes la condición de bucket_id). Devolver NULL es lo
-- seguro: grupo_en_alcance(NULL) ya es false.
create or replace function public.grupo_de_ruta(p_nombre text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  primer_folder text := split_part(coalesce(p_nombre, ''), '/', 1);
begin
  if primer_folder ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return primer_folder::uuid;
  end if;
  return null;
end;
$$;

create policy planos_archivos_select on storage.objects for select
  using (
    bucket_id = 'proyectos'
    and public.auth_modulo_habilitado('proyectos')
    and public.grupo_en_alcance(public.grupo_de_ruta(name))
  );

create policy planos_archivos_insert on storage.objects for insert
  with check (
    bucket_id = 'proyectos'
    and public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.grupo_en_alcance(public.grupo_de_ruta(name))
  );

create policy planos_archivos_delete on storage.objects for delete
  using (
    bucket_id = 'proyectos'
    and public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and public.grupo_en_alcance(public.grupo_de_ruta(name))
  );
