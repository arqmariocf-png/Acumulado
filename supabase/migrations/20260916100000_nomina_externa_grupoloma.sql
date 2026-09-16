-- Nómina externa (APIs de Grupo Loma): mano de obra + nómina fija semanal y
-- quincenal. Puerto de lo ya construido y validado en el repo hermano
-- aasanwellness (rama claude/erendira-nominas-pagos-kdrrcr) -- Grupo Loma y
-- Aasan Wellness comparten socios pero llevan cuentas separadas, y Mario
-- pidió que esto viva aquí (es una ventana más de este sistema, no del de
-- Aasan). La parte de nómina de coaches de esa rama NO aplica -- se deja
-- fuera.
--
-- Fuentes reales (confirmadas por Sistemas, consultadas directo desde este
-- proyecto vía net.http_get -- responden 200 JSON sin autenticación):
--   mano_obra        https://reports.grupoloma.mx/dash/api_MO_period_aut
--   nomina_semanal   https://reports.grupoloma.mx/dash/api_nomfija_sem_aut
--   nomina_quincenal https://reports.grupoloma.mx/dash/api_nomfija_quinc_aut
--
-- El renglón se guarda TAL CUAL llega (jsonb): qué columna es el nombre, el
-- importe, el periodo y el centro de costos se captura en el mapeo (abajo),
-- corregible desde la página -- no se asume una forma fija por si Grupo
-- Loma cambia una columna.
--
-- Rol: 'rh' (Eréndira) ya existe en este sistema (Nómina y asistencia de
-- RH.tsx) -- se reusa en vez de crear un rol nuevo. Igual que allá,
-- deliberadamente el importe NUNCA se guarda mientras el pago sigue
-- pendiente: se recalcula del renglón vigente y se congela (importe_
-- centavos) solo al marcar pagado.

-- ============================================================
-- 1. Orígenes: a dónde se consulta y cómo salió la última vez
-- ============================================================
create table public.nomina_externa_origenes (
  origen text primary key check (origen in ('mano_obra', 'nomina_semanal', 'nomina_quincenal')),
  nombre text not null,
  url text not null,
  activo boolean not null default true,
  -- Columnas descubiertas en la última sincronización, para ofrecer el
  -- mapeo sin volver a llamar a la API.
  columnas jsonb not null default '[]'::jsonb,
  ultima_sincronizacion timestamptz,
  ultimo_estado text check (ultimo_estado in ('ok', 'error')),
  ultimo_error text,
  ultimo_total_renglones int,
  ultimo_total_centavos bigint,
  -- A partir de cuántos minutos se considera vieja la información: la
  -- página se refresca sola al abrirse si ya pasó (respaldo de pg_cron).
  sincronizar_cada_minutos int not null default 60 check (sincronizar_cada_minutos between 5 and 1440),
  updated_at timestamptz not null default now()
);

insert into public.nomina_externa_origenes (origen, nombre, url) values
  ('mano_obra', 'Mano de obra (por periodo)', 'https://reports.grupoloma.mx/dash/api_MO_period_aut'),
  ('nomina_semanal', 'Nómina fija semanal', 'https://reports.grupoloma.mx/dash/api_nomfija_sem_aut'),
  ('nomina_quincenal', 'Nómina fija quincenal', 'https://reports.grupoloma.mx/dash/api_nomfija_quinc_aut');

alter table public.nomina_externa_origenes enable row level security;

-- La URL solo la cambia un admin: apuntar el origen a otro lado no es tarea
-- de nómina. RH solo lee (el mapeo va en su propia tabla, abajo).
create policy nomina_externa_origenes_select on public.nomina_externa_origenes
  for select to authenticated
  using (auth_rol() in ('admin', 'rh'));
create policy nomina_externa_origenes_update on public.nomina_externa_origenes
  for update to authenticated
  using (auth_rol() = 'admin')
  with check (auth_rol() = 'admin');

create trigger nomina_externa_origenes_set_updated_at
  before update on public.nomina_externa_origenes
  for each row execute function public.set_updated_at();

-- ============================================================
-- 2. Mapeo de columnas -- qué columna es el nombre, el importe, etc.
-- ============================================================
-- Tabla aparte justamente para que RH pueda corregirlo sin poder tocar la
-- URL del origen (RLS no distingue columnas, solo renglones).
create table public.nomina_externa_mapeos (
  origen text primary key references public.nomina_externa_origenes (origen) on delete cascade,
  campo_id text,
  campo_empleado text,
  campo_importe text,
  campo_periodo text,
  campo_centro_costos text,
  actualizado_por uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.nomina_externa_mapeos enable row level security;

create policy nomina_externa_mapeos_select on public.nomina_externa_mapeos
  for select to authenticated
  using (auth_rol() in ('admin', 'rh'));
create policy nomina_externa_mapeos_insert on public.nomina_externa_mapeos
  for insert to authenticated
  with check (auth_rol() in ('admin', 'rh'));
create policy nomina_externa_mapeos_update on public.nomina_externa_mapeos
  for update to authenticated
  using (auth_rol() in ('admin', 'rh'))
  with check (auth_rol() in ('admin', 'rh'));

create trigger nomina_externa_mapeos_set_updated_at
  before update on public.nomina_externa_mapeos
  for each row execute function public.set_updated_at();

-- Mapeo real, confirmado el 31-ago-2026 al consultar las tres APIs (ver
-- handoff de aasanwellness) -- se siembra ya resuelto en vez de dejar que
-- la heurística proponga de cero:
--
-- 1. Mano de obra NO tiene columna de id único (477 renglones traen solo
--    203 Id_mo_cat distintos -- es la referencia al catálogo, no el
--    renglón). campo_id va en null a propósito: la llave sale del hash del
--    renglón completo. Efecto a tener presente: si Grupo Loma corrige el
--    monto de un renglón, cambia su hash y un pago ya programado contra él
--    queda huérfano -- la agenda lo marca "el renglón ya no viene en la
--    API" en vez de repreciarlo solo. Pendiente de decidir con Mario si
--    conviene usar Id_mo_cat + Id_trabajador + Num_sem + Year en su lugar
--    (verificado único: 477/477).
-- 2. En la nómina fija la llave es `id`, no `id_empleado`: un mismo
--    empleado puede cobrar dos conceptos en el mismo periodo y
--    id_empleado los habría pisado.
-- 3. El periodo se mapea a fecha_fin, no a la columna `periodo` (que solo
--    dice "Semanal"/"Quincenal" en todos los renglones).
insert into public.nomina_externa_mapeos (origen, campo_id, campo_empleado, campo_importe, campo_periodo, campo_centro_costos) values
  ('mano_obra',        null, 'Nombre',   'Monto', 'Fecha_fin', 'Proyecto'),
  ('nomina_semanal',   'id', 'empleado', 'pago',  'fecha_fin', 'proyecto'),
  ('nomina_quincenal', 'id', 'empleado', 'pago',  'fecha_fin', 'proyecto');

-- ============================================================
-- 3. Renglones traídos de la API
-- ============================================================
-- Espejo de la última sincronización, no un histórico. `llave` es el id
-- que trae la API o, si no trae, un hash estable del renglón -- así
-- resincronizar no duplica.
create table public.nomina_externa_renglones (
  id uuid primary key default gen_random_uuid(),
  origen text not null references public.nomina_externa_origenes (origen) on delete cascade,
  llave text not null,
  datos jsonb not null,
  sincronizado_en timestamptz not null default now(),
  unique (origen, llave)
);

create index nomina_externa_renglones_origen_idx on public.nomina_externa_renglones (origen);

alter table public.nomina_externa_renglones enable row level security;

-- Solo lectura desde el navegador: escribir es exclusivo de la
-- sincronización (el RPC de abajo, security definer).
create policy nomina_externa_renglones_select on public.nomina_externa_renglones
  for select to authenticated
  using (auth_rol() in ('admin', 'rh'));

-- ============================================================
-- 4. Pagos programados contra esos renglones
-- ============================================================
-- Mientras está programado el importe NO se guarda: se lee del renglón
-- vigente de la API; al marcar pagado se congela en importe_centavos.
create table public.nomina_externa_pagos (
  id uuid primary key default gen_random_uuid(),
  origen text not null references public.nomina_externa_origenes (origen) on delete cascade,
  llave text not null,
  estado text not null default 'programado' check (estado in ('programado', 'pagado')),
  programado_para date,
  metodo_pago text not null default 'transferencia' check (metodo_pago in ('efectivo', 'transferencia', 'otro')),
  importe_centavos bigint,
  pagado_en timestamptz,
  referencia_pago text,
  notas text,
  creado_por uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nomina_externa_pagos_programado_tiene_fecha
    check (estado <> 'programado' or programado_para is not null),
  constraint nomina_externa_pagos_pagado_congelado
    check ((estado = 'pagado') = (importe_centavos is not null and pagado_en is not null)),
  unique (origen, llave)
);

create index nomina_externa_pagos_programado_idx on public.nomina_externa_pagos (programado_para)
  where estado = 'programado';

alter table public.nomina_externa_pagos enable row level security;

create policy nomina_externa_pagos_select on public.nomina_externa_pagos
  for select to authenticated
  using (auth_rol() in ('admin', 'rh'));
create policy nomina_externa_pagos_insert on public.nomina_externa_pagos
  for insert to authenticated
  with check (auth_rol() in ('admin', 'rh'));
-- El USING mira la fila anterior (RH sí puede pasar de 'programado' a
-- 'pagado'); el WITH CHECK va explícito para que ese mismo cambio no se
-- bloquee a sí mismo. Corregir un pago ya hecho es de admin.
create policy nomina_externa_pagos_update on public.nomina_externa_pagos
  for update to authenticated
  using (auth_rol() = 'admin' or (auth_rol() = 'rh' and estado = 'programado'))
  with check (auth_rol() in ('admin', 'rh'));
create policy nomina_externa_pagos_delete on public.nomina_externa_pagos
  for delete to authenticated
  using (auth_rol() = 'admin' or (auth_rol() = 'rh' and estado = 'programado'));

create trigger nomina_externa_pagos_set_updated_at
  before update on public.nomina_externa_pagos
  for each row execute function public.set_updated_at();

-- ============================================================
-- 5. Sincronización
-- ============================================================
-- Reemplazo atómico del espejo de un origen -- o entra el lote completo, o
-- no entra nada. Los pagos NO se borran junto con los renglones: se ligan
-- por (origen, llave) sin llave foránea justamente para que lo ya
-- programado o pagado sobreviva a una resincronización.
create or replace function public.reemplazar_renglones_nomina_externa(
  p_origen text,
  p_renglones jsonb,
  p_columnas jsonb,
  p_propuesta jsonb,
  p_total_centavos bigint
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not (auth_rol() in ('admin', 'rh') or auth.role() = 'service_role') then
    raise exception 'Solo un admin o Recursos Humanos pueden sincronizar la nómina externa';
  end if;

  if not exists (select 1 from public.nomina_externa_origenes where origen = p_origen) then
    raise exception 'Origen desconocido: %', p_origen;
  end if;

  delete from public.nomina_externa_renglones where origen = p_origen;

  insert into public.nomina_externa_renglones (origen, llave, datos)
  select p_origen, r ->> 'record_key', r -> 'data'
  from jsonb_array_elements(coalesce(p_renglones, '[]'::jsonb)) as r
  where r ->> 'record_key' is not null;

  get diagnostics v_count = row_count;

  update public.nomina_externa_origenes
  set columnas = coalesce(p_columnas, '[]'::jsonb),
      ultima_sincronizacion = now(),
      ultimo_estado = 'ok',
      ultimo_error = null,
      ultimo_total_renglones = v_count,
      ultimo_total_centavos = p_total_centavos
  where origen = p_origen;

  -- La propuesta solo se usa para arrancar: si ya hay un mapeo capturado a
  -- mano (o sembrado, ver arriba), no se pisa.
  insert into public.nomina_externa_mapeos (origen, campo_id, campo_empleado, campo_importe, campo_periodo, campo_centro_costos)
  values (
    p_origen,
    p_propuesta ->> 'idField',
    p_propuesta ->> 'employeeField',
    p_propuesta ->> 'amountField',
    p_propuesta ->> 'periodField',
    p_propuesta ->> 'costCenterField'
  )
  on conflict (origen) do nothing;

  return v_count;
end;
$$;

revoke all on function public.reemplazar_renglones_nomina_externa(text, jsonb, jsonb, jsonb, bigint) from public;
grant execute on function public.reemplazar_renglones_nomina_externa(text, jsonb, jsonb, jsonb, bigint) to authenticated, service_role;

-- Deja constancia de una sincronización fallida: que la página pueda decir
-- "la API no respondió" en vez de mostrar datos viejos como si fueran de
-- hoy.
create or replace function public.marcar_error_sincronizacion_nomina_externa(p_origen text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (auth_rol() in ('admin', 'rh') or auth.role() = 'service_role') then
    raise exception 'Solo un admin o Recursos Humanos pueden sincronizar la nómina externa';
  end if;

  update public.nomina_externa_origenes
  set ultima_sincronizacion = now(), ultimo_estado = 'error', ultimo_error = left(p_error, 2000)
  where origen = p_origen;
end;
$$;

revoke all on function public.marcar_error_sincronizacion_nomina_externa(text, text) from public;
grant execute on function public.marcar_error_sincronizacion_nomina_externa(text, text) to authenticated, service_role;

-- Supabase concede EXECUTE a `anon` por default privileges sobre cualquier
-- función nueva del esquema public -- revocar de PUBLIC (arriba) no toca
-- esa concesión directa. Las dos funciones ya validan por dentro, pero un
-- anónimo no tiene por qué poder llamarlas siquiera (mismo ajuste que tuvo
-- que hacerse en aasanwellness/0048 para este mismo patrón).
revoke execute on function public.reemplazar_renglones_nomina_externa(text, jsonb, jsonb, jsonb, bigint) from anon;
revoke execute on function public.marcar_error_sincronizacion_nomina_externa(text, text) from anon;
