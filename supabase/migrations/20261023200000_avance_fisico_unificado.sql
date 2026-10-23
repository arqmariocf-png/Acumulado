-- Avance físico unificado (23-oct-2026, Mario: "el avance físico sigue sin
-- coincidir"). Finanzas › Avance financiero medía el físico solo con tareas
-- hechas; el resumen físico-financiero de Operación lo mide como promedio de
-- tareas, suministro de requerimientos y precios unitarios
-- (`avanceFisicoDe` en lib/resumenObra.ts). `fn_avance_financiero()` ahora
-- devuelve por obra también `requisiciones` y `pu` (igual que
-- fn_resumen_obras_director) para que la pantalla use la misma fórmula.
--
-- Ya aplicado en producción (avance_fisico_unificado).

create or replace function public.fn_avance_financiero()
returns jsonb
language sql stable security definer set search_path = public as $$
  with alcance as materialized (
    select p.id, p.nombre, p.empresa_id, e.codigo as empresa_codigo, e.nombre as empresa_nombre
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
     where p.activo
       and e.id = any (public.auth_empresas_organizacion())
       and (public.auth_admin_global()
            or (public.auth_rol()::text in ('direccion', 'empresa', 'admin') and e.id = any (public.auth_empresas_alcance())))
  ), ultima as (
    select distinct on (c.tablero_id) c.tablero_id, c.id as columna_id
      from public.tablero_columnas c order by c.tablero_id, c.orden desc
  ), tareas as (
    select tb.proyecto_id, count(t.id)::int as total, count(t.id) filter (where t.columna_id = u.columna_id)::int as hechas
      from public.tableros tb
      join public.tarjetas t on t.tablero_id = tb.id and not t.archivada and t.eliminada_en is null
      left join ultima u on u.tablero_id = tb.id
     where not tb.archivado and tb.proyecto_id in (select id from alcance)
     group by tb.proyecto_id
  ), controles as (
    select pc.proyecto_id, sum(pc.presupuesto) as presupuesto
      from public.proyecto_controles pc where pc.proyecto_id in (select id from alcance) group by pc.proyecto_id
  ), avance as (
    select b.requisicion_id, round(avg(b.avance_pct), 1) as avance_pct
      from public.fn_requisicion_linea_entrega_base() b group by b.requisicion_id
  ), reqs as (
    select r.proyecto_id,
           jsonb_agg(jsonb_build_object('etapa', r.etapa, 'estado', r.estado, 'avance_pct', a.avance_pct)) as lista
      from public.requisiciones r left join avance a on a.requisicion_id = r.id
     where r.proyecto_id in (select id from alcance)
     group by r.proyecto_id
  ), pus as (
    select pa.proyecto_id,
           jsonb_agg(jsonb_build_object('estado', pa.estado, 'cliente_autorizado_en', pa.cliente_autorizado_en)) as lista
      from public.pu_analisis pa where pa.proyecto_id in (select id from alcance)
     group by pa.proyecto_id
  ), reales as materialized (
    select b.* from public.fn_avance_financiero_base() b where b.proyecto_id in (select id from alcance)
  )
  select jsonb_build_object(
    'obras', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'nombre', a.nombre, 'empresa_id', a.empresa_id, 'empresa_codigo', a.empresa_codigo,
        'empresa_nombre', a.empresa_nombre, 'tareas', coalesce(t.total, 0), 'hechas', coalesce(t.hechas, 0),
        'presupuesto_control', coalesce(c.presupuesto, 0),
        'requisiciones', coalesce(r.lista, '[]'::jsonb), 'pu', coalesce(u.lista, '[]'::jsonb)) order by a.nombre)
      from alcance a
      left join tareas t on t.proyecto_id = a.id
      left join controles c on c.proyecto_id = a.id
      left join reqs r on r.proyecto_id = a.id
      left join pus u on u.proyecto_id = a.id), '[]'::jsonb),
    'real', coalesce((select jsonb_agg(jsonb_build_object(
        'proyecto_id', r.proyecto_id, 'mes', to_char(r.mes, 'YYYY-MM'), 'categoria', r.categoria, 'real', r.monto_real, 'pagado', r.pagado))
      from reales r), '[]'::jsonb))
$$;
revoke all on function public.fn_avance_financiero() from public, anon;
grant execute on function public.fn_avance_financiero() to authenticated;
