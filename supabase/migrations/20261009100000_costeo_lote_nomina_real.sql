-- Costeo real de los lotes con la nómina de la planta (Mario, 9-oct-2026:
-- "ya tienes la información, incluso el registro de sus nóminas y su
-- checador; vincula todo y replantea el lote uno, únicamente deja las
-- fechas de inicio y término para tener el costeo real. Clavicón debe estar
-- completo").
--
-- La mano de obra de un lote ya no se captura a mano: sale de la nómina
-- semanal real del backoffice (nomina_externa_renglones, origen
-- 'nomina_semanal', empresa = la de la planta) entre la fecha de inicio y
-- la de término del lote (o hoy si sigue abierto):
--   * pago por día = pago de la semana / 6 (lunes a sábado; domingo no);
--   * si un día está en una semana que la API aún no trae, se estima con el
--     último pago de esa persona (marca `estimado`) hasta que llegue;
--   * si dos o más lotes de la planta están en proceso el mismo día, el
--     costo de ese día se reparte entre ellos en partes iguales;
--   * solo cuentan lotes en proceso o terminados (uno planeado no absorbe).
-- Lo capturado a mano en mano_de_obra_produccion (si hubiera) se suma aparte.
--
-- personal.backoffice_empleado liga el expediente de RH con el nombre de la
-- persona en la nómina del backoffice.
--
-- Ya aplicado en producción.

alter table public.personal add column if not exists backoffice_empleado text;
create unique index if not exists personal_backoffice_empleado_uq on public.personal (grupo_id, backoffice_empleado) where backoffice_empleado is not null;

-- Nómina de la planta por día y persona (interna: solo la usan las de abajo).
create or replace function public.fn_nomina_planta_dia_base(p_empresa uuid, p_desde date, p_hasta date)
returns table (fecha date, empleado text, puesto text, pago_dia numeric, estimado boolean)
language sql stable security definer set search_path = public as $$
  with emp as (
    select public.normalizar_texto_sql(nombre) as k from public.empresas where id = p_empresa
  ),
  sem as (
    select r.datos ->> 'empleado' as empleado,
           r.datos ->> 'puesto' as puesto,
           (r.datos ->> 'fecha_inicio')::date as ini,
           (r.datos ->> 'fecha_fin')::date as fin,
           (r.datos ->> 'pago')::numeric as pago
      from public.nomina_externa_renglones r, emp
     where r.origen = 'nomina_semanal'
       and public.normalizar_texto_sql(r.datos ->> 'empresa') = emp.k
       and (r.datos ->> 'fecha_fin')::date >= p_desde - 28
       and (r.datos ->> 'fecha_inicio')::date <= p_hasta
  ),
  ultima as (select max(fin) as fin from sem),
  dias as (
    select d::date as fecha from generate_series(p_desde, p_hasta, interval '1 day') d
     where extract(isodow from d) < 7
  ),
  personas as (select distinct empleado from sem)
  select d.fecha, p.empleado, x.puesto, round(x.pago / 6.0, 2), d.fecha > x.fin
    from dias d
   cross join personas p
    join lateral (
      select s.* from sem s where s.empleado = p.empleado and s.ini <= d.fecha order by s.ini desc limit 1
    ) x on true
   cross join ultima u
   where d.fecha <= x.fin
      -- semana que la API todavía no trae: se estima con su último pago
      or (x.fin = u.fin and d.fecha <= current_date and d.fecha - x.fin <= 14);
$$;
revoke all on function public.fn_nomina_planta_dia_base(uuid, date, date) from public, anon, authenticated;

-- Reparto por lote y persona (interna).
create or replace function public.fn_lotes_mano_obra_nomina_base()
returns table (orden_produccion_id uuid, empleado text, puesto text, dias numeric, costo numeric, estimado boolean)
language sql stable security definer set search_path = public as $$
  with lotes as (
    select o.id, o.empresa_id, o.fecha_inicio as ini, least(coalesce(o.fecha_fin, current_date), current_date) as fin
      from public.ordenes_produccion o
     where o.estado in ('en_proceso', 'terminada') and o.empresa_id is not null
  ),
  rango as (select empresa_id, min(ini) as desde, max(fin) as hasta from lotes where fin >= ini group by empresa_id),
  dia as (
    select r.empresa_id, b.* from rango r cross join lateral public.fn_nomina_planta_dia_base(r.empresa_id, r.desde, r.hasta) b
  ),
  activos as (
    select l.id, l.empresa_id, d.fecha
      from lotes l
      join (select distinct empresa_id, fecha from dia) d on d.empresa_id = l.empresa_id and d.fecha between l.ini and l.fin
  ),
  n as (select empresa_id, fecha, count(*) as n from activos group by empresa_id, fecha)
  select a.id, d.empleado, max(d.puesto), round(sum(1.0 / n.n), 2), round(sum(d.pago_dia / n.n), 2), bool_or(d.estimado)
    from activos a
    join n on n.empresa_id = a.empresa_id and n.fecha = a.fecha
    join dia d on d.empresa_id = a.empresa_id and d.fecha = a.fecha
   group by a.id, d.empleado;
$$;
revoke all on function public.fn_lotes_mano_obra_nomina_base() from public, anon, authenticated;

-- Lo que ve la app: mismos roles que ordenes_produccion y solo empresas del
-- alcance (cuenta dinero de nómina: nunca de otra organización).
create or replace function public.fn_lotes_mano_obra_nomina()
returns table (orden_produccion_id uuid, empleado text, puesto text, dias numeric, costo numeric, estimado boolean, personal_id uuid)
language sql stable security definer set search_path = public as $$
  select b.orden_produccion_id, b.empleado, b.puesto, b.dias, b.costo, b.estimado,
         (select pe.id from public.personal pe where pe.backoffice_empleado = b.empleado limit 1)
    from public.fn_lotes_mano_obra_nomina_base() b
    join public.ordenes_produccion o on o.id = b.orden_produccion_id
   where auth.uid() is null  -- procesos sin usuario (pg_cron, migraciones); anon no tiene execute
      or (public.auth_rol_definer() = any (array['produccion'::app_rol, 'admin'::app_rol, 'corporativo'::app_rol])
          and o.empresa_id = any (public.auth_empresas_alcance()));
$$;
revoke all on function public.fn_lotes_mano_obra_nomina() from public, anon;
grant execute on function public.fn_lotes_mano_obra_nomina() to authenticated;

-- Costeo del lote: mano de obra = nómina real + lo capturado a mano.
create or replace view public.v_costeo_orden_produccion with (security_invoker = true) as
with mp as (
  select orden_produccion_id, sum(cantidad * costo_unitario) as costo_materia_prima
    from public.movimientos_materia_prima
   where tipo = 'salida' and orden_produccion_id is not null
   group by orden_produccion_id
),
mo as (
  select orden_produccion_id, sum(costo_total) as costo_mano_obra
    from public.mano_de_obra_produccion
   group by orden_produccion_id
),
nom as (
  select orden_produccion_id, sum(costo) as costo, max(dias) as dias, count(*) as personas, bool_or(estimado) as estimado
    from public.fn_lotes_mano_obra_nomina()
   group by orden_produccion_id
),
ci as (
  select orden_produccion_id, sum(monto) as costo_indirectos
    from public.costos_indirectos_produccion
   group by orden_produccion_id
)
select
  o.id as orden_produccion_id,
  o.folio,
  o.producto_id,
  o.estado,
  o.fecha_inicio,
  o.fecha_fin,
  o.cantidad_planeada,
  o.cantidad_producida,
  o.cantidad_merma,
  coalesce(mp.costo_materia_prima, 0) as costo_materia_prima,
  coalesce(mo.costo_mano_obra, 0) + coalesce(nom.costo, 0) as costo_mano_obra,
  coalesce(ci.costo_indirectos, 0) as costo_indirectos,
  coalesce(mp.costo_materia_prima, 0) + coalesce(mo.costo_mano_obra, 0) + coalesce(nom.costo, 0) + coalesce(ci.costo_indirectos, 0) as costo_total,
  round(
    (coalesce(mp.costo_materia_prima, 0) + coalesce(mo.costo_mano_obra, 0) + coalesce(nom.costo, 0) + coalesce(ci.costo_indirectos, 0))
    / nullif(o.cantidad_producida, 0),
    4
  ) as costo_unitario,
  o.empresa_id,
  coalesce(nom.costo, 0) as costo_mano_obra_nomina,
  coalesce(mo.costo_mano_obra, 0) as costo_mano_obra_captura,
  coalesce(nom.dias, 0) as dias_nomina,
  coalesce(nom.personas, 0) as personas_nomina,
  coalesce(nom.estimado, false) as nomina_estimada
from public.ordenes_produccion o
left join mp on mp.orden_produccion_id = o.id
left join mo on mo.orden_produccion_id = o.id
left join nom on nom.orden_produccion_id = o.id
left join ci on ci.orden_produccion_id = o.id;

-- Revalúa la entrada de producto terminado de un lote cerrado con su costo
-- actual (p. ej. cuando llega la semana de nómina que estaba estimada).
create or replace function public.fn_lote_actualizar_costo(p_orden uuid)
returns numeric
language plpgsql volatile security definer set search_path = public as $$
declare v_costo numeric; v_empresa uuid;
begin
  if public.auth_rol_definer() <> all (array['produccion'::app_rol, 'admin'::app_rol]) then
    raise exception 'Solo producción o el administrador revalúan un lote' using errcode = '42501';
  end if;
  select empresa_id into v_empresa from public.ordenes_produccion where id = p_orden;
  if v_empresa is null or not (v_empresa = any (public.auth_empresas_alcance())) then
    raise exception 'Lote fuera de tu alcance' using errcode = '42501';
  end if;
  select coalesce(costo_unitario, 0) into v_costo from public.v_costeo_orden_produccion where orden_produccion_id = p_orden;
  update public.movimientos_producto_terminado
     set costo_unitario = v_costo
   where orden_produccion_id = p_orden and tipo = 'entrada';
  return v_costo;
end;
$$;
revoke all on function public.fn_lote_actualizar_costo(uuid) from public, anon;
grant execute on function public.fn_lote_actualizar_costo(uuid) to authenticated;

-- Liga de los expedientes de Clavicón con su nombre en la nómina.
update public.personal set backoffice_empleado = 'Alejandro Lilia Perez' where id = '927096cb-6586-47bf-b1ed-61307c3825d7';
update public.personal set backoffice_empleado = 'Christian Herrera Madrid' where id = 'd638ea8b-687f-4d2b-8ac9-acaecd40dad2';

-- Lote 001 de Clavicón replanteado: se quita la captura manual (Alejandro
-- 112 h × $295/h = $33,040, cuando su pago real es $3,670 a la semana) y su
-- mano de obra sale de la nómina entre sus fechas de inicio y término. Se
-- revalúan su entrada de producto terminado y el costo de la RM-000001.
delete from public.mano_de_obra_produccion where id = '5d546590-25b8-4dd5-88b0-51ba50a1d0d1';
update public.movimientos_producto_terminado m
   set costo_unitario = c.costo_unitario
  from public.v_costeo_orden_produccion c
 where c.orden_produccion_id = m.orden_produccion_id and m.tipo = 'entrada'
   and m.orden_produccion_id = '70801f0e-4b7b-40c1-a1f2-affe0efbf454';
update public.remisiones_produccion_lineas l
   set costo_unitario = m.costo_unitario
  from public.movimientos_producto_terminado m
 where m.orden_produccion_id = '70801f0e-4b7b-40c1-a1f2-affe0efbf454' and m.tipo = 'entrada'
   and l.producto_id = m.producto_id and l.id = '7d775995-1d51-406d-b64e-86a6c5ecc116';
