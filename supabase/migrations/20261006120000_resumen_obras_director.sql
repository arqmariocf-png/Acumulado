-- Resumen físico-financiero de todas las obras, solo para el director general
-- (Mario, 6-oct-2026: "en proyectos, así como me aparecen mis actividades,
-- quisiera el resumen por obra en tema físico-financiero, solamente como
-- director general"). Una sola consulta con los totales crudos por obra; la
-- pantalla calcula los porcentajes con las mismas reglas que la pestaña
-- "Resumen físico-financiero" de cada obra (proyectos/ResumenObra.tsx), así
-- que las cifras cuadran.
--
-- Solo el admin de la organización maestra (auth_admin_global): para
-- cualquier otro devuelve cero filas. Suma dinero de todas las empresas.
--
-- Ya aplicado en producción.

create or replace function public.fn_resumen_obras_director()
returns table (
  proyecto_id uuid, nombre text, empresa_codigo text, responsable text,
  presupuesto numeric, materiales numeric, materiales_pagados numeric, nomina numeric,
  tarjetas integer, hechas integer, requisiciones jsonb, pu jsonb)
language sql stable security definer set search_path = public as $$
  with ultima as (
    select distinct on (c.tablero_id) c.tablero_id, c.id as columna_id
    from public.tablero_columnas c
    order by c.tablero_id, c.orden desc
  ), tareas as (
    select tb.proyecto_id,
           count(t.id)::int as total,
           count(t.id) filter (where t.columna_id = u.columna_id)::int as hechas
    from public.tableros tb
    join public.tarjetas t on t.tablero_id = tb.id and not t.archivada
    left join ultima u on u.tablero_id = tb.id
    where not tb.archivado and tb.proyecto_id is not null
    group by tb.proyecto_id
  ), controles as (
    select pc.proyecto_id, sum(pc.presupuesto) as presupuesto
    from public.proyecto_controles pc group by pc.proyecto_id
  ), compras as (
    select pc.proyecto_id, sum(cc.importe) as materiales,
           sum(cc.importe) filter (where cc.estatus = 'pagado') as pagados
    from public.proyecto_control_compras cc join public.proyecto_controles pc on pc.id = cc.control_id
    group by pc.proyecto_id
  ), nomina as (
    select pc.proyecto_id, sum(n.sueldo) as nomina
    from public.proyecto_control_nomina n join public.proyecto_controles pc on pc.id = n.control_id
    group by pc.proyecto_id
  ), avance as (
    select b.requisicion_id, round(avg(b.avance_pct), 1) as avance_pct
    from public.fn_requisicion_linea_entrega_base() b group by b.requisicion_id
  ), reqs as (
    select r.proyecto_id,
           jsonb_agg(jsonb_build_object('etapa', r.etapa, 'estado', r.estado, 'avance_pct', a.avance_pct)) as lista
    from public.requisiciones r left join avance a on a.requisicion_id = r.id
    group by r.proyecto_id
  ), pus as (
    select pa.proyecto_id,
           jsonb_agg(jsonb_build_object('estado', pa.estado, 'cliente_autorizado_en', pa.cliente_autorizado_en)) as lista
    from public.pu_analisis pa where pa.proyecto_id is not null
    group by pa.proyecto_id
  )
  select p.id, p.nombre, e.codigo, (select pr.nombre from public.profiles pr where pr.id = p.responsable_id),
         coalesce(c.presupuesto, 0), coalesce(cm.materiales, 0), coalesce(cm.pagados, 0), coalesce(n.nomina, 0),
         coalesce(t.total, 0), coalesce(t.hechas, 0), coalesce(r.lista, '[]'::jsonb), coalesce(u.lista, '[]'::jsonb)
  from public.proyectos p
  join public.empresas e on e.id = p.empresa_id
  left join tareas t on t.proyecto_id = p.id
  left join controles c on c.proyecto_id = p.id
  left join compras cm on cm.proyecto_id = p.id
  left join nomina n on n.proyecto_id = p.id
  left join reqs r on r.proyecto_id = p.id
  left join pus u on u.proyecto_id = p.id
  where p.activo and public.auth_admin_global()
    and e.id = any (public.auth_empresas_organizacion())
    and (c.presupuesto is not null or t.total is not null or r.lista is not null or u.lista is not null)
  order by p.nombre
$$;
revoke all on function public.fn_resumen_obras_director() from public, anon;
grant execute on function public.fn_resumen_obras_director() to authenticated;
