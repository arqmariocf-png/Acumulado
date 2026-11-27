-- "Hecho" cuenta como terminada aunque no sea la última columna (27-nov-2026,
-- Laura: "confirmar actividades de la imagen 2, 3, 4 como hechas"). En
-- "RH · Actividades" las columnas son Por hacer · En progreso · Hecho ·
-- Archivados: las tareas en Hecho seguían saliendo como VENCIDAS (Mis
-- actividades, KPI de RH, reporte del director general, evaluación de
-- desempeño, personajes) y el escalamiento rojo avisaba a RH, porque todo eso
-- medía "hecha = última columna". El candado de cierre ya usaba
-- `fn_tablero_columnas_cierre` (Hecho/Terminado/Listo/Completado/Finalizado +
-- la última); ahora los reportes usan la misma regla.
--
-- Reescribe por reemplazo sobre la definición vigente y falla si no encuentra
-- el texto. Ya aplicado en producción (tareas_hecho_cuenta_como_terminada).

do $$
declare
  v_def text;
  v_nuevo text;
  r record;
  v_sub_tb constant text := '(select c.id from public.tablero_columnas c where c.tablero_id = tb.id order by c.orden desc limit 1)';
  v_sub_tj constant text := '(select c.id from public.tablero_columnas c where c.tablero_id = tj.tablero_id order by c.orden desc limit 1)';
  v_nombre constant text := 'lower(public.normalizar_texto_sql(c.nombre)) ~ ''(hech|termin|listo|complet|finaliz)''';
begin
  -- 1. Las que calculan "hecho" por tablero: ahora es el arreglo de columnas de cierre.
  for r in select unnest(array['fn_rh_kpi_actividades()', 'fn_reporte_rh_director(integer)', 'fn_evaluacion_datos(uuid, date, date)']) as f loop
    v_def := pg_get_functiondef(('public.' || r.f)::regprocedure);
    if position(v_sub_tb in v_def) = 0 or position('tj.columna_id = tb.hecho' in v_def) = 0 then
      raise exception 'No encontré el texto a reemplazar en %', r.f;
    end if;
    v_nuevo := replace(replace(v_def, v_sub_tb, 'public.fn_tablero_columnas_cierre(tb.id)'),
                       'tj.columna_id = tb.hecho', 'tj.columna_id = any (tb.hecho)');
    execute v_nuevo;
  end loop;

  -- 2. Reporte de operación: compara contra la última columna en línea.
  v_def := pg_get_functiondef('public.fn_reporte_area_operacion(uuid, date, date)'::regprocedure);
  if position('tj.columna_id = ' || v_sub_tb in v_def) = 0 then
    raise exception 'No encontré el texto a reemplazar en fn_reporte_area_operacion';
  end if;
  execute replace(v_def, 'tj.columna_id = ' || v_sub_tb, 'tj.columna_id = any (public.fn_tablero_columnas_cierre(tb.id))');

  -- 3. Escalamiento del semáforo: no avisa de tareas ya en Hecho.
  v_def := pg_get_functiondef('public.fn_tarjetas_escalamientos()'::regprocedure);
  if position('tj.columna_id <> ' || v_sub_tj in v_def) = 0 then
    raise exception 'No encontré el texto a reemplazar en fn_tarjetas_escalamientos';
  end if;
  execute replace(v_def, 'tj.columna_id <> ' || v_sub_tj, 'not (tj.columna_id = any (public.fn_tablero_columnas_cierre(tj.tablero_id)))');

  -- 4. Personajes: terminada = última columna o columna de cierre por nombre.
  for r in select unnest(array['fn_personajes_stats(uuid, uuid)', 'fn_mi_personaje()']) as f loop
    v_def := pg_get_functiondef(('public.' || r.f)::regprocedure);
    if position('(c.orden = u.orden) as terminada' in v_def) = 0 then
      raise exception 'No encontré el texto a reemplazar en %', r.f;
    end if;
    execute replace(v_def, '(c.orden = u.orden) as terminada', '(c.orden = u.orden or ' || v_nombre || ') as terminada');
  end loop;
end $$;
