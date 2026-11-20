-- 20-nov-2026 (Mario: "con Delia marca como pendiente el estado de cuenta,
-- sin embargo es porque muchas veces no hay movimientos posteriores y se
-- queda como 'pendiente'"). Los tres reportes que todavía medían "al día"
-- por el ÚLTIMO MOVIMIENTO cargado ahora usan también
-- cuentas_bancarias.estado_cuenta_al (hasta qué fecha llega el último estado
-- de cuenta subido, traiga o no movimientos nuevos; 20261119090000):
--   · fn_cumplimiento_ejecutar, prueba 'estados_cuenta_al_dia'
--   · fn_reporte_area_finanzas (cuentas_sin_estado_7d, saldos_por_empresa.al)
--   · fn_reporte_area_contabilidad (cuentas_sin_estado_7d, ultimo_estado)
-- Se reescriben por reemplazo sobre su definición vigente (como
-- 20261019110000): el bloque falla si el texto esperado no está, para que
-- no quede a medias. Ya aplicado en producción.
do $$
declare
  v_def text;
  v_fn text;
  v_pares text[][];
  v_par text[];
begin
  foreach v_fn in array array['fn_cumplimiento_ejecutar', 'fn_reporte_area_finanzas', 'fn_reporte_area_contabilidad'] loop
    select pg_get_functiondef(p.oid) into strict v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;

    v_pares := case v_fn
      -- 1. Cumplimiento CON-01 (estados de cuenta al día).
      when 'fn_cumplimiento_ejecutar' then array[
        ['(select max(m.fecha_pago) from public.movimientos m where m.cuenta_id = c.id) as ultimo',
         'greatest((select max(m.fecha_pago) from public.movimientos m where m.cuenta_id = c.id), c.estado_cuenta_al) as ultimo'],
        ['case when x.ultimo is null then ''Sin movimientos cargados''
                             else ''Último movimiento cargado '' || to_char(x.ultimo, ''DD/MM/YYYY'') end',
         'case when x.ultimo is null then ''Sin estado de cuenta cargado''
                             else ''Estado de cuenta al '' || to_char(x.ultimo, ''DD/MM/YYYY'') end']]
      -- 2. Reporte del área de finanzas (cuentas_sin_estado_7d, saldos_por_empresa.al).
      when 'fn_reporte_area_finanzas' then array[
        ['coalesce(m.saldo, 0) + coalesce(c.ajuste_saldo, 0) as saldo, m.fecha_pago
      from public.cuentas_bancarias c',
         'coalesce(m.saldo, 0) + coalesce(c.ajuste_saldo, 0) as saldo, greatest(m.fecha_pago, c.estado_cuenta_al) as fecha_pago
      from public.cuentas_bancarias c']]
      -- 3. Reporte del área de contabilidad (cuentas_sin_estado_7d, ultimo_estado).
      else array[
        ['select c.id, c.empresa_id, m.fecha_pago
      from public.cuentas_bancarias c join emp e on e.id = c.empresa_id',
         'select c.id, c.empresa_id, greatest(m.fecha_pago, c.estado_cuenta_al) as fecha_pago
      from public.cuentas_bancarias c join emp e on e.id = c.empresa_id']]
      end;

    foreach v_par slice 1 in array v_pares loop
      if position(v_par[1] in v_def) = 0 then
        raise exception 'estado_cuenta_al_en_reportes: en % no se encontró el texto esperado: %', v_fn, left(v_par[1], 80);
      end if;
      v_def := replace(v_def, v_par[1], v_par[2]);
    end loop;
    execute v_def;
  end loop;
end $$;
