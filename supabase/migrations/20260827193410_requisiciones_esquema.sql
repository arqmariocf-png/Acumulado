-- Módulo de Requisiciones: el responsable de un proyecto solicita
-- materiales/conceptos; un admin/compras revisa cada línea contra
-- existencias reales de Inventario y decide -- por ahora a mano, luego
-- automático -- cuánto se entrega directo de almacén y cuánto se manda a
-- comprar. Cierra el ciclo demanda -> inventario -> compras/ventas ->
-- conciliación bancaria que ya cubre el resto de este proyecto.
--
-- Reutiliza el catálogo de productos de Inventario (public.productos) como
-- "catálogo de conceptos" -- no se crea un catálogo de materiales paralelo,
-- para que comparar una requisición contra existencias sea directo (mismo
-- id) y no un problema de reconciliación entre dos catálogos.

-- ── Proyectos ────────────────────────────────────────────────────────────
create table public.proyectos (
  id uuid primary key default gen_random_uuid(),
  -- Id del sistema de backoffice (columna "Id" del Excel maestro de
  -- proyectos). Único cuando existe; null si un proyecto se da de alta
  -- manual después, sin venir de ese catálogo.
  id_backoffice integer unique,
  nombre text not null,
  empresa_id uuid not null references public.empresas (id),
  tipo text,
  -- Texto crudo importado (nombre de persona, o un placeholder genérico
  -- como "Residente"/"Comprador" cuando el Excel no trae un nombre real) --
  -- se conserva para referencia aunque no haya cuenta vinculada todavía.
  responsable_nombre text,
  responsable_id uuid references public.profiles (id),
  comprador_nombre text,
  comprador_id uuid references public.profiles (id),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index proyectos_empresa_idx on public.proyectos (empresa_id);
create index proyectos_responsable_idx on public.proyectos (responsable_id) where responsable_id is not null;
create index proyectos_comprador_idx on public.proyectos (comprador_id) where comprador_id is not null;

create trigger proyectos_set_updated_at
  before update on public.proyectos
  for each row
  execute function public.set_updated_at();

-- ── Requisiciones ────────────────────────────────────────────────────────
create table public.requisiciones (
  id uuid primary key default gen_random_uuid(),
  folio integer generated always as identity,
  proyecto_id uuid not null references public.proyectos (id),
  -- Denormalizado de proyectos.empresa_id (validado por trigger abajo) para
  -- que las políticas de RLS no tengan que hacer join en cada fila, mismo
  -- criterio que movimientos_inventario.empresa_id en el módulo de
  -- Inventario.
  empresa_id uuid not null references public.empresas (id),
  solicitado_por uuid not null references public.profiles (id),
  fecha date not null default current_date,
  estado text not null default 'enviada' check (estado in ('enviada', 'en_revision', 'resuelta', 'cancelada')),
  comentario text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index requisiciones_proyecto_idx on public.requisiciones (proyecto_id);
create index requisiciones_empresa_idx on public.requisiciones (empresa_id, fecha);
create index requisiciones_solicitado_por_idx on public.requisiciones (solicitado_por);

create trigger requisiciones_set_updated_at
  before update on public.requisiciones
  for each row
  execute function public.set_updated_at();

create or replace function public.validar_empresa_requisicion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.proyectos p where p.id = new.proyecto_id and p.empresa_id = new.empresa_id) then
    raise exception 'La requisición no coincide con la empresa de su proyecto';
  end if;
  return new;
end;
$$;

create trigger requisiciones_validar_empresa
  before insert or update on public.requisiciones
  for each row
  execute function public.validar_empresa_requisicion();

-- ── Líneas de requisición ────────────────────────────────────────────────
create table public.requisicion_lineas (
  id uuid primary key default gen_random_uuid(),
  requisicion_id uuid not null references public.requisiciones (id) on delete cascade,
  concepto_id uuid not null references public.productos (id),
  cantidad_solicitada numeric(14, 3) not null check (cantidad_solicitada > 0),
  -- Copiada del concepto al momento de solicitar -- si la unidad del
  -- catálogo cambia después, esta línea conserva la unidad con la que
  -- realmente se pidió.
  unidad_medida text not null,
  comentario text,
  created_at timestamptz not null default now()
);

create index requisicion_lineas_requisicion_idx on public.requisicion_lineas (requisicion_id);
create index requisicion_lineas_concepto_idx on public.requisicion_lineas (concepto_id);

create or replace function public.validar_empresa_requisicion_linea()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.requisiciones r
    join public.productos p on p.id = new.concepto_id
    where r.id = new.requisicion_id
      and p.empresa_id = r.empresa_id
  ) then
    raise exception 'El concepto no pertenece a la empresa de la requisición';
  end if;
  return new;
end;
$$;

create trigger requisicion_lineas_validar_empresa
  before insert or update on public.requisicion_lineas
  for each row
  execute function public.validar_empresa_requisicion_linea();

-- ── Resolución: necesidad de compra / entrega directa de inventario ─────
-- Una línea puede resolverse en varias partes (parcialidades, distintos
-- proveedores) -- de ahí que sean tablas 1:N desde requisicion_lineas, no
-- columnas en la línea misma. NO se inserta directo en ordenes_compra ni
-- ordenes_venta (esas se sincronizan solas desde el backoffice real, ver
-- sincronizar_catalogo_oc_ov) -- orden_compra_id/orden_venta_id quedan NULL
-- hasta que alguien vincule a mano la orden real una vez que exista.
create table public.necesidades_compra (
  id uuid primary key default gen_random_uuid(),
  requisicion_linea_id uuid not null references public.requisicion_lineas (id) on delete cascade,
  cantidad numeric(14, 3) not null check (cantidad > 0),
  proveedor_sugerido text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'vinculada', 'cancelada')),
  orden_compra_id uuid references public.ordenes_compra (id),
  resuelto_por uuid not null references public.profiles (id),
  vinculado_por uuid references public.profiles (id),
  vinculado_at timestamptz,
  created_at timestamptz not null default now(),
  constraint necesidades_compra_vinculada_check check (estado <> 'vinculada' or orden_compra_id is not null)
);

create index necesidades_compra_linea_idx on public.necesidades_compra (requisicion_linea_id);
create index necesidades_compra_oc_idx on public.necesidades_compra (orden_compra_id) where orden_compra_id is not null;

create table public.necesidades_entrega (
  id uuid primary key default gen_random_uuid(),
  requisicion_linea_id uuid not null references public.requisicion_lineas (id) on delete cascade,
  cantidad numeric(14, 3) not null check (cantidad > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'entregada', 'cancelada')),
  movimiento_inventario_id uuid references public.movimientos_inventario (id),
  orden_venta_id uuid references public.ordenes_venta (id),
  resuelto_por uuid not null references public.profiles (id),
  entregado_por uuid references public.profiles (id),
  entregado_at timestamptz,
  created_at timestamptz not null default now(),
  constraint necesidades_entrega_entregada_check check (estado <> 'entregada' or movimiento_inventario_id is not null)
);

create index necesidades_entrega_linea_idx on public.necesidades_entrega (requisicion_linea_id);
create index necesidades_entrega_movimiento_idx on public.necesidades_entrega (movimiento_inventario_id) where movimiento_inventario_id is not null;

-- No se puede asignar (compra + entrega) más de lo solicitado en la línea.
-- Es un trigger y no un CHECK porque necesita sumar entre dos tablas.
create or replace function public.validar_resolucion_linea()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_linea_id uuid := coalesce(new.requisicion_linea_id, old.requisicion_linea_id);
  v_solicitada numeric;
  v_asignada numeric;
begin
  select cantidad_solicitada into v_solicitada from public.requisicion_lineas where id = v_linea_id;
  select coalesce(sum(cantidad), 0)
    into v_asignada
    from (
      select cantidad from public.necesidades_compra where requisicion_linea_id = v_linea_id and estado <> 'cancelada'
      union all
      select cantidad from public.necesidades_entrega where requisicion_linea_id = v_linea_id and estado <> 'cancelada'
    ) sub;
  if v_asignada > v_solicitada + 0.001 then
    raise exception 'La suma de compra + entrega (%) excede lo solicitado (%) en esta línea', v_asignada, v_solicitada;
  end if;
  return null;
end;
$$;

create trigger necesidades_compra_validar_resolucion
  after insert or update on public.necesidades_compra
  for each row
  execute function public.validar_resolucion_linea();

create trigger necesidades_entrega_validar_resolucion
  after insert or update on public.necesidades_entrega
  for each row
  execute function public.validar_resolucion_linea();
