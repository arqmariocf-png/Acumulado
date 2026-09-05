-- Módulo de Precios Unitarios (PU). La pantalla ya existía en el frontend
-- (web/src/pages/precios/*) contra estas tablas y vistas, pero el esquema
-- nunca se subió: esta migración es la que la conecta.
--
-- Idea central, y la razón de que casi nada de dinero se guarde:
--
--   El precio unitario NUNCA se almacena. Se recalcula de la explosión de
--   insumos cada vez que se consulta (ver 20260905100100_pu_costeo.sql), y
--   el costo de cada insumo sale de su historial de cotizaciones. Por eso
--   corregir un rendimiento o cotizar un material vuelve a costear solos
--   todos los análisis en borrador, sin tocarlos uno por uno.
--
--   Lo único que sí se congela es lo que alguien firmó a mano: el precio y
--   proveedor que almacén autoriza para un renglón concreto
--   (pu_analisis_items.costo_congelado), y la bitácora de aprobaciones.
--
-- El circuito de firmas es supervisor -> almacén -> dirección -> dirección
-- general, y sólo al publicarse el PU queda descargable como precio bueno.
-- Quién puede mover qué lo imponen el trigger validar_flujo_pu_analisis y
-- las políticas de RLS (20260905100200_pu_rls.sql), no el frontend.

create type public.pu_tipo_insumo as enum ('material', 'mano_obra', 'herramienta', 'equipo', 'auxiliar');

-- 'cantidad': el renglón aporta cantidad/rendimiento por su costo unitario.
-- 'pct_mano_obra': el renglón es un porcentaje de la mano de obra del mismo
-- análisis (herramienta menor, equipo de seguridad) -- se recalcula solo
-- cuando cambia un rendimiento, que es justamente por lo que se captura así
-- y no como un importe fijo.
create type public.pu_base_calculo as enum ('cantidad', 'pct_mano_obra');

create type public.pu_estado as enum (
  'borrador',
  'en_revision_material',
  'material_confirmado',
  'autorizado',
  'publicado',
  'obsoleto'
);

-- ── Catálogo de insumos ──────────────────────────────────────────────────
-- Es del grupo, no de cada empresa: un jornal de albañil cuesta lo mismo lo
-- capture quien lo capture. El costo NO vive aquí (ver pu_insumo_precios).
create table public.pu_insumos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  descripcion text not null,
  unidad text not null,
  -- 'auxiliar' no se da de alta aquí: es el tipo con el que se presenta un
  -- análisis básico consumido dentro de otro (ver pu_analisis_items).
  tipo public.pu_tipo_insumo not null check (tipo <> 'auxiliar'),
  activo boolean not null default true,
  creado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pu_insumos_tipo_idx on public.pu_insumos (tipo) where activo;
create index pu_insumos_creado_por_idx on public.pu_insumos (creado_por) where creado_por is not null;

create trigger pu_insumos_set_updated_at
  before update on public.pu_insumos
  for each row
  execute function public.set_updated_at();

-- ── Historial de cotizaciones ────────────────────────────────────────────
-- Append-only a propósito: un costo nuevo no borra el anterior, se agrega
-- con su fecha. Así un análisis viejo sigue siendo reproducible y se puede
-- decir con qué cotización se armó.
--
-- empresa_id NULL = precio de grupo, lo ven las ocho empresas. Se admite un
-- precio propio por empresa (gana sobre el de grupo) porque el flete cambia
-- el costo real de un material según dónde esté la obra, pero el frontend
-- todavía no lo ofrece: hoy todo se captura a nivel grupo.
create table public.pu_insumo_precios (
  id uuid primary key default gen_random_uuid(),
  insumo_id uuid not null references public.pu_insumos (id) on delete cascade,
  empresa_id uuid references public.empresas (id),
  costo numeric(14, 4) not null check (costo >= 0),
  fuente text,
  vigente_desde timestamptz not null default now(),
  creado_por uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index pu_insumo_precios_vigencia_idx
  on public.pu_insumo_precios (insumo_id, vigente_desde desc);
create index pu_insumo_precios_empresa_idx
  on public.pu_insumo_precios (empresa_id) where empresa_id is not null;
create index pu_insumo_precios_creado_por_idx
  on public.pu_insumo_precios (creado_por) where creado_por is not null;

-- ── Factores de sobrecosto ───────────────────────────────────────────────
-- Indirectos, financiamiento, utilidad y cargos adicionales, en el orden en
-- cascada de la Ley de Obras Públicas (cada uno se aplica sobre el subtotal
-- acumulado, no sobre el costo directo).
--
-- Los porcentajes se guardan como FRACCIÓN (18% = 0.18). Cambiar de
-- porcentajes no es editar el factor: se crea uno nuevo con otra vigencia,
-- para que un PU ya firmado no cambie de precio solo.
create table public.pu_factores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  nombre text not null,
  indirectos_pct numeric(6, 4) not null default 0 check (indirectos_pct >= 0),
  financiamiento_pct numeric(6, 4) not null default 0 check (financiamiento_pct >= 0),
  utilidad_pct numeric(6, 4) not null default 0 check (utilidad_pct >= 0),
  cargos_adicionales_pct numeric(6, 4) not null default 0 check (cargos_adicionales_pct >= 0),
  vigente_desde date not null default current_date,
  activo boolean not null default true,
  creado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create index pu_factores_empresa_idx on public.pu_factores (empresa_id, vigente_desde desc);
create index pu_factores_creado_por_idx on public.pu_factores (creado_por) where creado_por is not null;

-- ── Análisis (la tarjeta de precio unitario) ─────────────────────────────
-- proyecto_id NULL = biblioteca de la empresa (un precio que no nació de una
-- obra concreta); el frontend hoy siempre pide obra, pero la columna admite
-- NULL para poder heredar precios entre obras más adelante.
create table public.pu_analisis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  proyecto_id uuid references public.proyectos (id),
  codigo text not null,
  concepto text not null,
  unidad text not null,
  -- Un básico (mortero, cuadrilla, habilitado de acero) se consume dentro de
  -- otros análisis a costo directo y no lleva indirectos ni utilidad: el
  -- sobrecosto se cobra una sola vez, en el concepto que se vende.
  es_auxiliar boolean not null default false,
  estado public.pu_estado not null default 'borrador',
  factor_id uuid references public.pu_factores (id),
  creado_por uuid references public.profiles (id),
  -- Comentario de la última acción del circuito; el trigger de bitácora lo
  -- copia a pu_aprobaciones y ahí es donde queda el histórico.
  comentario_revision text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create index pu_analisis_empresa_estado_idx on public.pu_analisis (empresa_id, estado);
create index pu_analisis_proyecto_idx on public.pu_analisis (proyecto_id) where proyecto_id is not null;
create index pu_analisis_factor_idx on public.pu_analisis (factor_id) where factor_id is not null;
create index pu_analisis_creado_por_idx on public.pu_analisis (creado_por) where creado_por is not null;
create index pu_analisis_auxiliares_idx on public.pu_analisis (empresa_id, codigo) where es_auxiliar;
create index pu_analisis_updated_at_idx on public.pu_analisis (updated_at desc);

create trigger pu_analisis_set_updated_at
  before update on public.pu_analisis
  for each row
  execute function public.set_updated_at();

-- ── Renglones del análisis ───────────────────────────────────────────────
-- Un renglón es un insumo del catálogo O un análisis básico consumido
-- dentro de éste, nunca los dos.
create table public.pu_analisis_items (
  id uuid primary key default gen_random_uuid(),
  analisis_id uuid not null references public.pu_analisis (id) on delete cascade,
  orden integer not null default 1,
  insumo_id uuid references public.pu_insumos (id),
  analisis_hijo_id uuid references public.pu_analisis (id),
  base_calculo public.pu_base_calculo not null default 'cantidad',
  cantidad numeric(16, 6) not null check (cantidad > 0),
  -- Cuántas unidades del concepto produce una jornada de cuadrilla. Sólo
  -- tiene sentido en mano de obra; en el resto se queda en 1 y la aportación
  -- del renglón acaba siendo la cantidad tal cual.
  rendimiento numeric(16, 6) not null default 1 check (rendimiento > 0),
  -- El precio que almacén autorizó para ESTE renglón, con su proveedor. Es
  -- lo único de dinero que se guarda, porque es una firma: si mañana sube el
  -- catálogo, este análisis conserva el precio con el que se cotizó.
  costo_congelado numeric(14, 4) check (costo_congelado >= 0),
  proveedor text,
  precio_autorizado_en timestamptz,
  precio_autorizado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint pu_items_insumo_o_basico check (
    (insumo_id is not null and analisis_hijo_id is null)
    or (insumo_id is null and analisis_hijo_id is not null)
  ),
  -- Un básico entra siempre por cantidad: no existe "un básico que sea el 3%
  -- de la mano de obra".
  constraint pu_items_basico_por_cantidad check (
    analisis_hijo_id is null or base_calculo = 'cantidad'
  ),
  -- Un porcentaje de mano de obra no admite precio congelado: su costo es el
  -- subtotal de mano de obra del propio análisis, no un precio de proveedor.
  constraint pu_items_pct_sin_precio_congelado check (
    base_calculo = 'cantidad' or (costo_congelado is null and proveedor is null)
  ),
  constraint pu_items_no_se_contiene check (analisis_hijo_id is distinct from analisis_id)
);

create index pu_analisis_items_analisis_idx on public.pu_analisis_items (analisis_id, orden);
create index pu_analisis_items_insumo_idx on public.pu_analisis_items (insumo_id) where insumo_id is not null;
create index pu_analisis_items_hijo_idx on public.pu_analisis_items (analisis_hijo_id) where analisis_hijo_id is not null;
create index pu_analisis_items_autorizo_idx
  on public.pu_analisis_items (precio_autorizado_por) where precio_autorizado_por is not null;

-- ── Bitácora de aprobaciones ─────────────────────────────────────────────
-- La escribe sólo el trigger (ver abajo): no hay policy de INSERT para
-- nadie, ni siquiera admin. Es el respaldo de quién firmó qué y cuándo, así
-- que el nombre del actor se congela aquí -- si esa persona se va y su
-- profile se edita, el documento conserva quién firmó ese día.
create table public.pu_aprobaciones (
  id uuid primary key default gen_random_uuid(),
  analisis_id uuid not null references public.pu_analisis (id) on delete cascade,
  estado_anterior public.pu_estado not null,
  estado_nuevo public.pu_estado not null,
  actor_id uuid references public.profiles (id),
  actor_rol public.app_rol,
  actor_nombre text,
  comentario text,
  created_at timestamptz not null default now()
);

create index pu_aprobaciones_analisis_idx on public.pu_aprobaciones (analisis_id, created_at desc);
create index pu_aprobaciones_actor_idx on public.pu_aprobaciones (actor_id) where actor_id is not null;

-- ── Consistencia de empresa ──────────────────────────────────────────────
-- SECURITY DEFINER porque esto es integridad, no permiso: quién puede crear
-- un análisis lo decide RLS (pu_analisis_insert). Corriendo como invocador,
-- una obra que el usuario no alcanza a VER se vería igual que una obra de
-- otra empresa, y el error diría una mentira -- "no coincide con la empresa"
-- cuando lo que pasa es que no la ve. Un supervisor puede armar precios de
-- cualquier obra de su empresa, no sólo de las suyas: el catálogo de precios
-- es de la empresa (ver 20260905100200_pu_rls.sql).
create or replace function public.validar_empresa_pu_analisis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.proyecto_id is not null
     and not exists (
       select 1 from public.proyectos p
       where p.id = new.proyecto_id and p.empresa_id = new.empresa_id
     ) then
    raise exception 'El análisis no coincide con la empresa de su obra';
  end if;

  if new.factor_id is not null
     and not exists (
       select 1 from public.pu_factores f
       where f.id = new.factor_id and f.empresa_id = new.empresa_id
     ) then
    raise exception 'El factor de sobrecosto es de otra empresa';
  end if;

  return new;
end;
$$;

create trigger pu_analisis_validar_empresa
  before insert or update on public.pu_analisis
  for each row
  execute function public.validar_empresa_pu_analisis();

-- Un básico sólo se puede consumir dentro de un análisis de la misma
-- empresa, y tiene que estar marcado como básico -- si no, un concepto
-- vendible entraría en otro a costo directo y el sobrecosto se perdería.
--
-- El ciclo se corta contando profundidad hacia arriba: si el hijo ya
-- contiene (directa o indirectamente) al padre, insertarlo cerraría el
-- círculo y el costeo no terminaría nunca.
create or replace function public.validar_item_pu_basico()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_empresa uuid;
begin
  if new.analisis_hijo_id is null then
    return new;
  end if;

  select a.empresa_id into v_empresa from public.pu_analisis a where a.id = new.analisis_id;

  if not exists (
    select 1 from public.pu_analisis h
    where h.id = new.analisis_hijo_id
      and h.es_auxiliar
      and h.empresa_id = v_empresa
  ) then
    raise exception 'Sólo se puede incluir un análisis básico de la misma empresa';
  end if;

  if exists (
    with recursive contenidos as (
      select new.analisis_hijo_id as id, 1 as nivel
      union all
      select it.analisis_hijo_id, c.nivel + 1
      from contenidos c
      join public.pu_analisis_items it on it.analisis_id = c.id
      where it.analisis_hijo_id is not null and c.nivel < 20
    )
    select 1 from contenidos where id = new.analisis_id
  ) then
    raise exception 'Ese básico ya contiene a este análisis: se haría un ciclo';
  end if;

  return new;
end;
$$;

create trigger pu_analisis_items_validar_basico
  before insert or update on public.pu_analisis_items
  for each row
  execute function public.validar_item_pu_basico();

-- ── Quién puede resolver cada etapa ──────────────────────────────────────
-- Sirve tanto al trigger de flujo como a las políticas de RLS, para que la
-- regla viva en un solo lugar y no haya dos versiones que se puedan
-- desincronizar.
--
-- ETAPA_DEL_ROL, en web/src/pages/precios/comun.ts, se le parece pero no es
-- lo mismo y no tiene por qué serlo: aquélla sólo ordena la bandeja "Me
-- toca" (por eso mete a corporativo en 'autorizado', para que vea lo que
-- está por publicarse) y ésta es la que de verdad concede o niega.
create or replace function public.pu_puede_actuar(p_estado public.pu_estado)
returns boolean
language sql
stable
set search_path = public
as $$
  select case p_estado
    when 'borrador' then public.auth_rol() in ('responsable', 'empresa', 'direccion', 'corporativo', 'admin')
    when 'en_revision_material' then public.auth_rol() in ('almacen', 'admin')
    when 'material_confirmado' then public.auth_rol() in ('direccion', 'admin')
    when 'autorizado' then public.auth_rol() = 'admin'
    when 'publicado' then public.auth_rol() = 'admin'
    else false
  end
$$;

-- ── Máquina de estados ───────────────────────────────────────────────────
-- El frontend pinta los botones que cree que aplican; esto es lo que de
-- verdad decide. Los mensajes son los que va a leer el usuario tal cual (el
-- frontend los muestra sin traducir), así que se redactan para él.
create or replace function public.validar_flujo_pu_analisis()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_avance boolean;
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  if not public.pu_puede_actuar(old.estado) then
    raise exception 'Tu rol no resuelve esta etapa del análisis (%)', old.estado;
  end if;

  v_avance := (old.estado, new.estado) in (
    ('borrador', 'en_revision_material'),
    ('en_revision_material', 'material_confirmado'),
    ('material_confirmado', 'autorizado'),
    ('autorizado', 'publicado')
  );

  -- Regresar a borrador es el rechazo: lo puede hacer quien tenía que
  -- resolver la etapa en la que está, y borra el avance de las firmas
  -- anteriores (las cantidades pueden cambiar antes de reenviarlo).
  if not v_avance
     and not (new.estado = 'borrador' and old.estado in ('en_revision_material', 'material_confirmado', 'autorizado'))
     and not (new.estado = 'obsoleto' and old.estado = 'publicado') then
    raise exception 'No se puede pasar de % a %', old.estado, new.estado;
  end if;

  if new.estado = 'publicado' and not new.es_auxiliar and new.factor_id is null then
    raise exception 'Antes de publicar hay que asignarle un factor de sobrecosto';
  end if;

  if new.estado = 'en_revision_material'
     and not exists (select 1 from public.pu_analisis_items it where it.analisis_id = new.id) then
    raise exception 'El análisis no tiene renglones todavía';
  end if;

  -- Un comentario vale para la firma en la que se escribió y nada más. Si
  -- quien mueve el análisis no manda uno nuevo, el campo se limpia en vez de
  -- arrastrar el de la etapa anterior -- si no, la bitácora acabaría
  -- atribuyéndole a dirección lo que había escrito almacén.
  if new.comentario_revision is not distinct from old.comentario_revision then
    new.comentario_revision := null;
  end if;

  return new;
end;
$$;

create trigger pu_analisis_validar_flujo
  before update on public.pu_analisis
  for each row
  execute function public.validar_flujo_pu_analisis();

-- SECURITY DEFINER porque la bitácora no es opcional: pu_aprobaciones no
-- tiene policy de INSERT para nadie, y así nadie puede mover un análisis sin
-- dejar rastro. Congela nombre y rol del actor al momento de firmar.
create or replace function public.registrar_aprobacion_pu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_rol public.app_rol;
begin
  select p.nombre, p.rol into v_nombre, v_rol from public.profiles p where p.id = auth.uid();

  insert into public.pu_aprobaciones (
    analisis_id, estado_anterior, estado_nuevo, actor_id, actor_rol, actor_nombre, comentario
  )
  values (new.id, old.estado, new.estado, auth.uid(), v_rol, v_nombre, nullif(btrim(coalesce(new.comentario_revision, '')), ''));

  return new;
end;
$$;

create trigger pu_analisis_registrar_aprobacion
  after update of estado on public.pu_analisis
  for each row
  when (old.estado is distinct from new.estado)
  execute function public.registrar_aprobacion_pu();

-- ── Qué se puede tocar de un renglón, y cuándo ───────────────────────────
-- En borrador se captura todo. En revisión de material el análisis ya está
-- congelado salvo por lo que almacén tiene que resolver: precio y
-- proveedor. De ahí en adelante no se toca nada -- si hay que corregir, se
-- regresa a borrador y el circuito vuelve a empezar.
create or replace function public.validar_edicion_item_pu()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_estado public.pu_estado;
  v_analisis uuid := coalesce(new.analisis_id, old.analisis_id);
begin
  select a.estado into v_estado from public.pu_analisis a where a.id = v_analisis;

  if tg_op = 'UPDATE' and v_estado = 'en_revision_material' then
    if (new.cantidad, new.rendimiento, new.base_calculo, new.orden) is distinct from
       (old.cantidad, old.rendimiento, old.base_calculo, old.orden)
       or new.insumo_id is distinct from old.insumo_id
       or new.analisis_hijo_id is distinct from old.analisis_hijo_id then
      raise exception 'En revisión de material sólo se puede cambiar el precio y el proveedor';
    end if;
  elsif v_estado <> 'borrador' then
    raise exception 'El análisis ya no está en borrador: regrésalo a borrador para poder cambiarlo';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Poner precio es una firma: queda con fecha y con quién lo autorizó.
  if new.costo_congelado is not null
     and (tg_op = 'INSERT' or new.costo_congelado is distinct from old.costo_congelado) then
    new.precio_autorizado_en := now();
    new.precio_autorizado_por := auth.uid();
  elsif new.costo_congelado is null then
    new.precio_autorizado_en := null;
    new.precio_autorizado_por := null;
  end if;

  return new;
end;
$$;

create trigger pu_analisis_items_validar_edicion
  before insert or update or delete on public.pu_analisis_items
  for each row
  execute function public.validar_edicion_item_pu();
