-- Perfiles de jornada (pedido de Mario, 22-sep-2026): cuántas horas y días
-- a la semana debe cubrir cada persona y con qué criterio se le paga a
-- partir del checador:
--   fijo      -> sueldo semanal completo (el checador solo informa)
--   por_dias  -> sueldo / días de la jornada × días con entrada (tope: la jornada)
--   por_horas -> sueldo × horas trabajadas / horas de la jornada (tope 100 %),
--                más horas extra opcionales con factor
-- RH asigna el perfil por persona; sin perfil aplica el marcado como base.

create table public.perfiles_jornada (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  horas_semana numeric(5, 2) not null check (horas_semana > 0 and horas_semana <= 84),
  dias_semana integer not null default 6 check (dias_semana between 1 and 7),
  criterio_pago text not null default 'por_dias' check (criterio_pago in ('fijo', 'por_dias', 'por_horas')),
  -- Hora de entrada esperada (hora local) para contar retardos; null = no se cuentan.
  hora_entrada time,
  tolerancia_min integer not null default 15 check (tolerancia_min between 0 and 120),
  -- Las horas trabajadas se redondean a este múltiplo de minutos (0 = sin redondeo).
  redondeo_min integer not null default 15 check (redondeo_min in (0, 5, 10, 15, 30, 60)),
  pagar_extra boolean not null default false,
  factor_extra numeric(4, 2) not null default 2.00 check (factor_extra >= 1),
  tope_extra_horas numeric(5, 2) not null default 9 check (tope_extra_horas >= 0),
  es_base boolean not null default false,
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Un solo perfil base.
create unique index perfiles_jornada_base_idx on public.perfiles_jornada (es_base) where es_base;

alter table public.perfiles_jornada enable row level security;
create policy perfiles_jornada_select on public.perfiles_jornada for select using (public.auth_rol() <> 'pendiente');
create policy perfiles_jornada_write on public.perfiles_jornada
  for all using (public.auth_rol() in ('rh', 'admin')) with check (public.auth_rol() in ('rh', 'admin'));

insert into public.perfiles_jornada (nombre, horas_semana, dias_semana, criterio_pago, hora_entrada, es_base, notas) values
  ('Jornada completa 48 h (lunes a sábado)', 48, 6, 'por_dias', '08:00', true, 'Jornada máxima legal diurna. Se paga por día con entrada registrada.'),
  ('Administrativo 45 h (lunes a viernes)', 45, 5, 'por_dias', '09:00', false, null),
  ('Medio tiempo 24 h', 24, 6, 'por_horas', null, false, 'Se paga proporcional a las horas trabajadas.'),
  ('Sueldo fijo (checador informativo)', 48, 6, 'fijo', null, false, 'No se descuenta por faltas ni horas; el checador solo se consulta.');

alter table public.personal add column perfil_jornada_id uuid references public.perfiles_jornada (id);

-- Nómina semanal a partir del checador. p_semana = lunes de la semana.
-- Horas trabajadas: tramos entrada→comida_inicio, comida_fin→salida y
-- entrada→salida, con fechas/horas en hora de México.
create or replace function public.fn_nomina_semanal_checador(p_semana date)
returns table (
  personal_id uuid, personal_nombre text, profile_id uuid, contratacion_id uuid, empresa_id uuid,
  sueldo_semanal numeric, perfil_jornada_id uuid, perfil_nombre text, criterio_pago text,
  horas_semana numeric, dias_semana integer, hora_entrada time, tolerancia_min integer,
  dias_checados integer, horas_trabajadas numeric, horas_extra numeric, retardos integer,
  monto_sugerido numeric
)
language sql stable set search_path = public as $$
  with marcas as (
    select r.profile_id, r.tipo, r.created_at,
      (r.created_at at time zone 'America/Mexico_City') as local_ts
    from public.checador_registros r
    where r.anulada_en is null
      and (r.created_at at time zone 'America/Mexico_City') >= p_semana::timestamp
      and (r.created_at at time zone 'America/Mexico_City') < (p_semana + 7)::timestamp
  ),
  tramos as (
    select m.profile_id, m.tipo, m.local_ts,
      lag(m.tipo) over w as tipo_prev, lag(m.local_ts) over w as ts_prev
    from marcas m
    window w as (partition by m.profile_id order by m.local_ts)
  ),
  por_persona as (
    select t.profile_id,
      coalesce(sum(case when t.tipo in ('comida_inicio', 'salida') and t.tipo_prev in ('entrada', 'comida_fin')
        then extract(epoch from (t.local_ts - t.ts_prev)) / 3600.0 else 0 end), 0) as horas,
      count(distinct t.local_ts::date) filter (where t.tipo = 'entrada') as dias,
      array_agg(t.local_ts::time) filter (where t.tipo = 'entrada') as entradas
    from tramos t
    group by t.profile_id
  ),
  base as (
    select pe.id as personal_id, pe.nombre as personal_nombre, pe.profile_id,
      c.id as contratacion_id, c.empresa_id, c.sueldo_semanal,
      pj.id as perfil_jornada_id, pj.nombre as perfil_nombre, pj.criterio_pago, pj.horas_semana, pj.dias_semana,
      pj.hora_entrada, pj.tolerancia_min, pj.redondeo_min, pj.pagar_extra, pj.factor_extra, pj.tope_extra_horas,
      coalesce(pp.dias, 0)::integer as dias_checados,
      coalesce(pp.horas, 0) as horas_crudas,
      coalesce(pp.entradas, '{}'::time[]) as entradas
    from public.personal pe
    left join lateral (
      select * from public.contrataciones c
      where c.personal_id = pe.id and c.fecha_inicio <= p_semana + 6 and c.fecha_fin >= p_semana
      order by c.fecha_inicio desc limit 1
    ) c on true
    left join public.perfiles_jornada pj on pj.id = coalesce(pe.perfil_jornada_id, (select id from public.perfiles_jornada where es_base))
    left join por_persona pp on pp.profile_id = pe.profile_id
    where pe.activo or (pe.fecha_baja is not null and pe.fecha_baja >= p_semana)
  ),
  calc as (
    select b.*,
      case when b.redondeo_min > 0 then round(b.horas_crudas * 60 / b.redondeo_min) * b.redondeo_min / 60.0 else b.horas_crudas end as horas_red,
      (select count(*) from unnest(b.entradas) e where b.hora_entrada is not null and e > b.hora_entrada + make_interval(mins => b.tolerancia_min))::integer as retardos
    from base b
  )
  select c.personal_id, c.personal_nombre, c.profile_id, c.contratacion_id, c.empresa_id, c.sueldo_semanal,
    c.perfil_jornada_id, c.perfil_nombre, c.criterio_pago, c.horas_semana, c.dias_semana, c.hora_entrada, c.tolerancia_min,
    c.dias_checados,
    round(c.horas_red::numeric, 2) as horas_trabajadas,
    round(least(greatest(c.horas_red - c.horas_semana, 0), c.tope_extra_horas)::numeric, 2) as horas_extra,
    c.retardos,
    case
      when c.sueldo_semanal is null then null
      when c.criterio_pago = 'fijo' then c.sueldo_semanal
      when c.criterio_pago = 'por_dias' then round(c.sueldo_semanal / c.dias_semana * least(c.dias_checados, c.dias_semana), 2)
      else round(
        c.sueldo_semanal * least(c.horas_red / c.horas_semana, 1)
        + case when c.pagar_extra then least(greatest(c.horas_red - c.horas_semana, 0), c.tope_extra_horas) * (c.sueldo_semanal / c.horas_semana) * c.factor_extra else 0 end,
      2)
    end as monto_sugerido
  from calc c
  order by c.personal_nombre;
$$;

revoke all on function public.fn_nomina_semanal_checador(date) from public;
grant execute on function public.fn_nomina_semanal_checador(date) to authenticated;

comment on function public.fn_nomina_semanal_checador(date) is 'Nómina semanal sugerida por persona a partir del checador y su perfil de jornada (días, horas, retardos, monto según criterio de pago). Solo lectura; RH decide el pago final.';
