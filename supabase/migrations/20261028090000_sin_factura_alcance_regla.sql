-- Cuántos movimientos tocaría una regla "siempre que el concepto diga…"
-- (28-oct-2026, Mario: "Allison hizo un movimiento como depósito erróneo, el
-- cual se hizo bien, pero en automático hizo todos los demás y los cuentas de
-- tercero no todos llevan esa condición"). El 26-oct las palabras "PAGO
-- CUENTA DE TERCERO" y "ERROR" marcaron 489 movimientos de 6 empresas como
-- N/A - DEPOSITO POR ERROR (se restauraron desde audit_log y las dos reglas
-- quedaron inactivas). Antes de guardar, la pantalla pregunta con esta
-- función cuántos pendientes dicen esa palabra y pide confirmarlo.
--
-- fn_movimientos_sin_factura_alcance(palabra): mismo filtro que aplica
-- fn_movimientos_sin_factura (alcance de empresas, sin factura, no resuelto,
-- nombre o comentarios con la palabra sin acentos) → total y por empresa.
--
-- Ya aplicado en producción (sin_factura_alcance_regla).

create or replace function public.fn_movimientos_sin_factura_alcance(p_palabra text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_rol text := public.auth_rol();
  v_clave text := translate(upper(btrim(coalesce(p_palabra, ''))), 'ÁÉÍÓÚÜ', 'AEIOUU');
  v_total int := 0;
  v_empresas jsonb := '[]'::jsonb;
begin
  if v_rol not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo dirección, corporativo o el administrador marcan movimientos sin factura' using errcode = '42501';
  end if;
  if length(v_clave) < 4 then
    return jsonb_build_object('n', 0, 'empresas', v_empresas);
  end if;
  select count(*), coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'n', n) order by n desc, codigo), '[]'::jsonb)
    into v_total, v_empresas
    from (
      select e.codigo, count(*) as n
        from public.movimientos m join public.empresas e on e.id = m.empresa_id
       where m.empresa_id = any (public.auth_empresas_alcance())
         and m.factura is null and m.estado_clasificacion <> 'resuelto'
         and translate(upper(coalesce(m.nombre_razon_social, '') || ' ' || coalesce(m.comentarios, '')), 'ÁÉÍÓÚÜ', 'AEIOUU') like '%' || v_clave || '%'
       group by e.codigo
    ) s;
  select coalesce(sum((x->>'n')::int), 0) into v_total from jsonb_array_elements(v_empresas) x;
  return jsonb_build_object('n', v_total, 'empresas', v_empresas);
end;
$$;
revoke all on function public.fn_movimientos_sin_factura_alcance(text) from public, anon;
grant execute on function public.fn_movimientos_sin_factura_alcance(text) to authenticated;
