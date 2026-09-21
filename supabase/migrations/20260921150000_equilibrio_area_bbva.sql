-- Punto de equilibrio del área de mantenimiento BBVA (pedido 21-sep-2026):
-- Christian (encargado del área) ve semana a semana lo que se paga a su
-- equipo (nómina fija semanal, quincenal y mano de obra de las APIs de
-- Grupo Loma, proyecto "BBVA Puebla"), lo que ejecuta (folios generados en
-- el control BBVA) y lo que realmente cobra (folios con pago realizado).
--
-- El equipo lo arma RH marcando en cada persona el área; el gasto se
-- atribuye a cada integrante por nombre (la API trae el nombre, a veces
-- con sufijo "_CSC"), y lo que la API cargue al proyecto sin coincidir con
-- nadie del equipo se muestra aparte para que RH lo agregue.
alter table public.personal add column area text check (area in ('bbva_puebla'));
comment on column public.personal.area is 'Área operativa para el punto de equilibrio: bbva_puebla = equipo de mantenimiento BBVA Puebla-Tlaxcala (lo asigna RH).';

-- Nombre comparable: sin acentos, minúsculas, sin sufijo "_CSC" ni dobles espacios.
create or replace function public.nombre_comparable(p text)
returns text language sql stable as $$
  select regexp_replace(lower(unaccent(regexp_replace(coalesce(p, ''), '_[A-Za-z]+$', ''))), '\s+', ' ', 'g')
$$;

create or replace function public.auth_ve_equilibrio_bbva()
returns boolean language sql stable as $$
  select public.auth_rol() in ('admin', 'corporativo', 'direccion', 'rh') or public.auth_bbva_mantenimiento()
$$;

-- Semana de domingo a sábado, igual que las APIs de nómina (Fecha_inicio
-- domingo, Fecha_fin sábado).
create or replace function public.semana_domingo(p date)
returns date language sql immutable as $$ select p - extract(dow from p)::int $$;

-- Gasto del área por semana y por persona (todas las fuentes de nómina).
create or replace function public.fn_equilibrio_bbva_gasto()
returns table (semana_inicio date, origen text, nombre text, nombre_comparable text, monto numeric)
language sql stable security definer set search_path = public as $$
  select
    public.semana_domingo(coalesce(nullif(r.datos->>'Fecha_fin', '')::date, nullif(r.datos->>'fecha_fin', '')::date)) as semana_inicio,
    r.origen,
    trim(coalesce(r.datos->>'Nombre', r.datos->>'empleado')) as nombre,
    public.nombre_comparable(coalesce(r.datos->>'Nombre', r.datos->>'empleado')) as nombre_comparable,
    coalesce(nullif(r.datos->>'Monto', '')::numeric, nullif(r.datos->>'pago', '')::numeric, 0) as monto
  from public.nomina_externa_renglones r
  where public.auth_ve_equilibrio_bbva()
    and trim(coalesce(r.datos->>'Proyecto', r.datos->>'proyecto')) ilike 'BBVA Puebla'
    and coalesce(nullif(r.datos->>'Fecha_fin', ''), nullif(r.datos->>'fecha_fin', '')) is not null
$$;
revoke execute on function public.fn_equilibrio_bbva_gasto() from anon, public;
grant execute on function public.fn_equilibrio_bbva_gasto() to authenticated;

-- Resumen semanal: gasto (todas las fuentes), ejecutado (folios recibidos
-- esa semana, sin cancelados) y cobrado (folios con pago realizado por la
-- fecha de recepción de factura / pago).
create or replace function public.fn_equilibrio_bbva_semanal()
returns table (
  semana_inicio date, gasto_mano_obra numeric, gasto_nomina numeric, gasto_total numeric,
  folios_generados int, monto_ejecutado numeric, folios_cobrados int, monto_cobrado numeric
)
language sql stable security definer set search_path = public as $$
  with gasto as (
    select semana_inicio,
      sum(case when origen = 'mano_obra' then monto else 0 end) as mano_obra,
      sum(case when origen <> 'mano_obra' then monto else 0 end) as nomina
    from public.fn_equilibrio_bbva_gasto()
    group by semana_inicio
  ),
  ejecutado as (
    select public.semana_domingo(fecha_recepcion) as semana_inicio, count(*)::int as folios, sum(coalesce(monto_a_cobrar, 0)) as monto
    from public.bbva_folios_control
    where fecha_recepcion is not null and upper(coalesce(estatus_operativo, '')) <> 'CANCELADO'
    group by 1
  ),
  cobrado as (
    select public.semana_domingo(fecha_recepcion_factura) as semana_inicio, count(*)::int as folios, sum(coalesce(monto_a_cobrar, 0)) as monto
    from public.bbva_folios_control
    where fecha_recepcion_factura is not null and lower(coalesce(estado_pago, '')) like 'pago realizado%'
    group by 1
  ),
  semanas as (
    select semana_inicio from gasto union select semana_inicio from ejecutado union select semana_inicio from cobrado
  )
  select s.semana_inicio,
    round(coalesce(g.mano_obra, 0), 2), round(coalesce(g.nomina, 0), 2), round(coalesce(g.mano_obra, 0) + coalesce(g.nomina, 0), 2),
    coalesce(e.folios, 0), round(coalesce(e.monto, 0), 2),
    coalesce(c.folios, 0), round(coalesce(c.monto, 0), 2)
  from semanas s
  left join gasto g on g.semana_inicio = s.semana_inicio
  left join ejecutado e on e.semana_inicio = s.semana_inicio
  left join cobrado c on c.semana_inicio = s.semana_inicio
  where public.auth_ve_equilibrio_bbva()
  order by s.semana_inicio
$$;
revoke execute on function public.fn_equilibrio_bbva_semanal() from anon, public;
grant execute on function public.fn_equilibrio_bbva_semanal() to authenticated;

-- Equipo del área (personal.area) con lo pagado a cada quien, más los
-- nombres que la API carga al proyecto y no están en el equipo.
create or replace function public.fn_equilibrio_bbva_equipo()
returns table (personal_id uuid, nombre text, puesto text, en_equipo boolean, semanas int, total_pagado numeric, ultima_semana date)
language sql stable security definer set search_path = public as $$
  with equipo as (
    select p.id, p.nombre, p.puesto, public.nombre_comparable(p.nombre) as comparable
    from public.personal p where p.activo and p.area = 'bbva_puebla'
  ),
  gasto as (select * from public.fn_equilibrio_bbva_gasto()),
  por_equipo as (
    select e.id, e.nombre, e.puesto, true as en_equipo,
      count(distinct g.semana_inicio)::int as semanas, round(coalesce(sum(g.monto), 0), 2) as total, max(g.semana_inicio) as ultima
    from equipo e left join gasto g on g.nombre_comparable = e.comparable
    group by e.id, e.nombre, e.puesto
  ),
  sin_equipo as (
    select null::uuid, g.nombre, null::text, false, count(distinct g.semana_inicio)::int, round(sum(g.monto), 2), max(g.semana_inicio)
    from gasto g
    where not exists (select 1 from equipo e where e.comparable = g.nombre_comparable)
    group by g.nombre
  )
  select * from por_equipo union all select * from sin_equipo
  order by 4 desc, 6 desc
$$;
revoke execute on function public.fn_equilibrio_bbva_equipo() from anon, public;
grant execute on function public.fn_equilibrio_bbva_equipo() to authenticated;
