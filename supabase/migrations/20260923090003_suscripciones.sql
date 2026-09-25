-- ── Suscripción por organización ────────────────────────────────────────
--
-- Acumulado se cobra por organización: cada cliente paga una mensualidad y
-- eso es lo que mantiene encendida la captura. La organización maestra no se
-- cobra a sí misma.
--
-- Qué NO vive aquí, a propósito: los datos de la tarjeta. La tarjeta se
-- captura en el formulario de la pasarela y nunca toca esta base ni nuestros
-- edge functions -- guardar un PAN nos metería en alcance PCI sin necesidad.
-- De la tarjeta solo se guarda lo que sirve para que el cliente la reconozca
-- en pantalla (marca y últimos 4 dígitos, que la propia pasarela devuelve) y
-- los identificadores con los que la pasarela la relaciona.
--
-- La regla de falta de pago es "gracia y luego solo lectura": se siguen
-- pudiendo consultar y exportar los datos propios, pero no capturar ni
-- cargar nada. Quién puede escribir lo decide
-- public.suscripcion_permite_escribir(); las policies que la usan están en
-- 20260923090004_suscripciones_rls_escritura.sql.

create type public.estado_suscripcion as enum (
  'prueba',          -- todavía sin tarjeta registrada, con fecha límite
  'activa',          -- al corriente
  'periodo_gracia',  -- falló el cobro; sigue escribiendo hasta gracia_hasta
  'suspendida',      -- se acabó la gracia: solo lectura
  'cancelada'        -- se dio de baja: solo lectura
);

create table public.planes (
  clave text primary key,
  nombre text not null,
  precio_mensual_centavos integer not null check (precio_mensual_centavos >= 0),
  moneda text not null default 'MXN',
  activo boolean not null default true
);

comment on column public.planes.precio_mensual_centavos is
  'En centavos para no perder precisión con decimales flotantes; 150000 = $1,500.00 MXN.';

insert into public.planes (clave, nombre, precio_mensual_centavos, moneda) values
  ('estandar', 'Estándar', 150000, 'MXN');

create table public.suscripciones (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null unique references public.grupos (id) on delete cascade,
  plan_clave text not null references public.planes (clave),
  estado public.estado_suscripcion not null default 'prueba',
  dias_gracia integer not null default 7 check (dias_gracia >= 0),
  -- Fin del periodo ya pagado (o de la prueba). La pasarela lo mueve en cada
  -- cobro exitoso vía webhook.
  periodo_fin timestamptz,
  gracia_hasta timestamptz,
  cancelada_at timestamptz,
  pasarela text check (pasarela in ('stripe', 'mercadopago', 'conekta')),
  pasarela_cliente_id text,
  pasarela_suscripcion_id text,
  metodo_pago_marca text,
  metodo_pago_ultimos4 text check (metodo_pago_ultimos4 ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.suscripciones is
  'Una suscripción por organización. metodo_pago_* es solo para mostrar en pantalla (marca y últimos 4 que devuelve la pasarela): aquí nunca se guarda un número de tarjeta.';

create unique index suscripciones_pasarela_idx
  on public.suscripciones (pasarela, pasarela_suscripcion_id)
  where pasarela_suscripcion_id is not null;

create index suscripciones_plan_idx on public.suscripciones (plan_clave);

create trigger suscripciones_set_updated_at
  before update on public.suscripciones
  for each row execute function public.set_updated_at();

create table public.pagos (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id) on delete cascade,
  suscripcion_id uuid references public.suscripciones (id) on delete set null,
  monto_centavos integer not null,
  moneda text not null default 'MXN',
  estado text not null check (estado in ('pendiente', 'pagado', 'fallido', 'reembolsado')),
  pasarela text,
  pasarela_pago_id text,
  periodo_inicio timestamptz,
  periodo_fin timestamptz,
  pagado_at timestamptz,
  detalle_error text,
  created_at timestamptz not null default now()
);

create unique index pagos_pasarela_idx
  on public.pagos (pasarela, pasarela_pago_id)
  where pasarela_pago_id is not null;

create index pagos_grupo_idx on public.pagos (grupo_id, created_at desc);
create index pagos_suscripcion_idx on public.pagos (suscripcion_id);

-- Bitácora de webhooks. La pasarela reintenta los eventos que no confirmamos
-- y puede mandar el mismo dos veces: la unicidad de (pasarela, evento_id) es
-- lo que hace idempotente el procesamiento, no un "ya lo vi" en memoria.
create table public.eventos_pasarela (
  id uuid primary key default gen_random_uuid(),
  pasarela text not null,
  evento_id text not null,
  tipo text not null,
  payload jsonb not null,
  procesado_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (pasarela, evento_id)
);

comment on table public.eventos_pasarela is
  'Sin policies a propósito: solo la service_role key (edge function del webhook) escribe y lee aquí.';

-- ── Quién puede escribir ────────────────────────────────────────────────
-- La organización maestra nunca se bloquea: es quien opera la plataforma.
-- Para el resto, 'activa' y 'prueba' escriben mientras no se les pase la
-- fecha; 'periodo_gracia' escribe hasta gracia_hasta; suspendida/cancelada,
-- no. El "+ dias_gracia" sobre periodo_fin de una suscripción activa es una
-- red por si un webhook se pierde: sin él, una tarjeta cancelada seguiría
-- escribiendo para siempre porque nadie nos avisó.
create or replace function public.suscripcion_permite_escribir(p_grupo_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when p_grupo_id is null then false
    when exists (select 1 from public.grupos g where g.id = p_grupo_id and g.es_maestro) then true
    else coalesce(
      (
        select case s.estado
          when 'activa' then s.periodo_fin is null or now() <= s.periodo_fin + make_interval(days => s.dias_gracia)
          when 'prueba' then s.periodo_fin is null or now() <= s.periodo_fin
          when 'periodo_gracia' then s.gracia_hasta is not null and now() <= s.gracia_hasta
          else false
        end
        from public.suscripciones s
        where s.grupo_id = p_grupo_id
      ),
      -- Una organización sin suscripción todavía no está contratada: no escribe.
      false
    )
  end
$$;

create or replace function public.auth_suscripcion_permite_escribir()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_admin_global() or public.suscripcion_permite_escribir(public.auth_grupo_id())
$$;

-- Vista para el frontend: el estado que hay que mostrar (que no siempre es
-- el guardado -- una 'activa' con periodo_fin vencido ya no escribe) y los
-- días que quedan antes de quedarse en solo lectura.
create view public.v_suscripcion with (security_invoker = true) as
select
  s.grupo_id,
  s.plan_clave,
  p.nombre as plan_nombre,
  p.precio_mensual_centavos,
  p.moneda,
  s.estado,
  s.periodo_fin,
  s.gracia_hasta,
  s.dias_gracia,
  s.pasarela,
  s.metodo_pago_marca,
  s.metodo_pago_ultimos4,
  public.suscripcion_permite_escribir(s.grupo_id) as puede_escribir,
  case
    when s.estado = 'periodo_gracia' then s.gracia_hasta
    when s.estado in ('activa', 'prueba') then s.periodo_fin
  end as escribe_hasta
from public.suscripciones s
join public.planes p on p.clave = s.plan_clave;

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.planes enable row level security;
alter table public.suscripciones enable row level security;
alter table public.pagos enable row level security;
alter table public.eventos_pasarela enable row level security;

create policy planes_select on public.planes
  for select using (public.auth_rol() <> 'pendiente');

create policy planes_insert on public.planes for insert with check (public.auth_admin_global());
create policy planes_update on public.planes for update using (public.auth_admin_global()) with check (public.auth_admin_global());
create policy planes_delete on public.planes for delete using (public.auth_admin_global());

-- Todo usuario con acceso necesita leer el estado de su suscripción (de ahí
-- sale el aviso de "te quedan N días"), pero el estado lo mueve la pasarela
-- vía webhook (service_role), nunca el cliente: si el propio cliente pudiera
-- editarlo, se pondría 'activa' y listo.
create policy suscripciones_select on public.suscripciones
  for select using (public.auth_rol() <> 'pendiente' and public.grupo_en_alcance(grupo_id));

create policy suscripciones_insert on public.suscripciones for insert with check (public.auth_admin_global());
create policy suscripciones_update on public.suscripciones for update using (public.auth_admin_global()) with check (public.auth_admin_global());
create policy suscripciones_delete on public.suscripciones for delete using (public.auth_admin_global());

create policy pagos_select on public.pagos
  for select using (public.auth_rol() in ('admin', 'corporativo') and public.grupo_en_alcance(grupo_id));

create policy pagos_insert on public.pagos for insert with check (public.auth_admin_global());
create policy pagos_update on public.pagos for update using (public.auth_admin_global()) with check (public.auth_admin_global());
create policy pagos_delete on public.pagos for delete using (public.auth_admin_global());

-- ── Alta de las suscripciones actuales ──────────────────────────────────
-- Loma es la organización maestra: activa y sin pasarela, no se cobra a sí
-- misma. ARSSA entra en prueba con 30 días para registrar su tarjeta; en
-- cuanto la registre, el webhook la pasa a 'activa' y mueve periodo_fin.
insert into public.suscripciones (grupo_id, plan_clave, estado, periodo_fin)
select g.id, 'estandar',
       case when g.es_maestro then 'activa'::public.estado_suscripcion else 'prueba'::public.estado_suscripcion end,
       case when g.es_maestro then null else now() + interval '30 days' end
from public.grupos g;
