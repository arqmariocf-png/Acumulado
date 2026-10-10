-- Mano de obra al cargar la producción (Mario con Jaime, 10-oct-2026: "al
-- cargar la producción debe calcular el número de días para tener el monto
-- total de mano de obra"). Al cerrar un lote se eligen las fechas y, antes
-- de confirmar, la pantalla muestra días hábiles × nómina diaria = monto,
-- con el mismo cálculo que v_costeo_orden_produccion (pago semanal ÷ 6,
-- lunes a sábado, repartido si otros lotes de la planta están activos esos
-- días).
--
-- Ya aplicado en producción.

create or replace function public.fn_lote_mano_obra_previa(p_orden uuid, p_desde date, p_hasta date)
returns table (dias numeric, personas integer, costo_dia numeric, costo numeric, estimado boolean)
language sql stable security definer set search_path = public as $$
  with o as (
    select id, empresa_id from public.ordenes_produccion
     where id = p_orden
       and (auth.uid() is null
            or (public.auth_rol_definer() = any (array['produccion'::app_rol, 'admin'::app_rol, 'corporativo'::app_rol])
                and empresa_id = any (public.auth_empresas_alcance())))
  ),
  d as (
    select b.* from o
     cross join lateral public.fn_nomina_planta_dia_base(o.empresa_id, p_desde, least(p_hasta, current_date)) b
  ),
  otros as (
    select x.fecha, count(*) as n
      from (select distinct fecha from d) x
      join public.ordenes_produccion l
        on l.empresa_id = (select empresa_id from o) and l.id <> p_orden
       and l.estado in ('en_proceso', 'terminada')
       and x.fecha between l.fecha_inicio and least(coalesce(l.fecha_fin, current_date), current_date)
     group by x.fecha
  ),
  r as (
    select d.fecha, d.empleado, d.pago_dia, d.estimado, 1.0 / (1 + coalesce(otros.n, 0)) as parte
      from d left join otros using (fecha)
  ),
  dia as (select fecha, max(parte) as parte, sum(pago_dia) as pago from r group by fecha)
  select round(coalesce((select sum(parte) from dia), 0), 2),
         (select count(distinct empleado) from r)::integer,
         round(coalesce((select avg(pago) from dia), 0), 2),
         round(coalesce((select sum(pago_dia * parte) from r), 0), 2),
         coalesce((select bool_or(estimado) from r), false);
$$;
revoke all on function public.fn_lote_mano_obra_previa(uuid, date, date) from public, anon;
grant execute on function public.fn_lote_mano_obra_previa(uuid, date, date) to authenticated;
