-- Tres cosas pedidas por el cliente 2026-09-09:
--   1. Notificaciones push de recordatorios de tareas del día (requiere
--      guardar la suscripción push de cada dispositivo).
--   2. Un lugar seguro para las llaves VAPID y el secreto del cron job, sin
--      exponer nada al cliente -- no hay forma de fijar "secrets" de edge
--      function desde este entorno, así que se guardan en una tabla sin
--      ninguna policy de RLS (inaccesible para anon/authenticated, solo la
--      lee el edge function con la service_role key).
--   3. Checador de entrada/salida estilo Sesame -- solo el registro
--      entrada/salida por ahora, sin ubicación ni foto.

-- ── Config interna (llaves VAPID, secreto del cron) ─────────────────────
create table public.config_sistema (
  clave text primary key,
  valor text not null,
  updated_at timestamptz not null default now()
);

comment on table public.config_sistema is 'Config sensible interna (llaves VAPID, secretos de cron). Sin policies de RLS a propósito -- inaccesible vía API, solo la lee el service role.';

alter table public.config_sistema enable row level security;
-- Sin policies: RLS niega todo a anon/authenticated. service_role (usado
-- por los edge functions) bypassa RLS y sí puede leer/escribir.

-- ── Suscripciones push (una fila por dispositivo/navegador) ─────────────
create table public.push_subscripciones (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscripciones_profile_idx on public.push_subscripciones (profile_id);

alter table public.push_subscripciones enable row level security;

create policy push_subscripciones_select on public.push_subscripciones
  for select
  using (profile_id = (select auth.uid()) or public.auth_rol() = 'admin');

create policy push_subscripciones_insert on public.push_subscripciones
  for insert
  with check (profile_id = (select auth.uid()));

create policy push_subscripciones_delete on public.push_subscripciones
  for delete
  using (profile_id = (select auth.uid()) or public.auth_rol() = 'admin');

-- ── Checador de entrada/salida ───────────────────────────────────────────
create table public.checador_registros (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  tipo text not null check (tipo in ('entrada', 'salida')),
  created_at timestamptz not null default now()
);

comment on table public.checador_registros is 'Checador estilo Sesame: marca de entrada/salida por persona. Inmutable a propósito -- es un registro de asistencia, no se edita ni se borra desde la app.';

create index checador_registros_profile_idx on public.checador_registros (profile_id, created_at);

alter table public.checador_registros enable row level security;

create policy checador_registros_select on public.checador_registros
  for select
  using (profile_id = (select auth.uid()) or public.auth_rol() in ('admin', 'rh'));

create policy checador_registros_insert on public.checador_registros
  for insert
  with check (profile_id = (select auth.uid()));

-- Sin policy de update/delete: nadie edita ni borra una marca desde la app.
