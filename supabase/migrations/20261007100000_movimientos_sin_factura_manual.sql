-- Marcar a mano un movimiento "sin factura" con su motivo (Mario, 7-oct-2026,
-- tras las correcciones de Laura: "pago a intereses-capital del crédito no
-- lleva factura, poner pago a crédito"; "penaliz sdo prom min, N/A -
-- comisión bancaria"). Antes solo lo ponían las reglas_clasificacion (que
-- solo edita el admin) y dirección ni siquiera puede escribir en
-- movimientos (auth_puede_escribir).
--
-- fn_movimientos_sin_factura(ids, etiqueta, palabra_clave):
--   - Pueden admin, dirección y corporativo, solo en empresas de su alcance.
--   - La etiqueta siempre queda "N/A - …" en mayúsculas.
--   - Deja factura = etiqueta, estado 'resuelto' y la nota de quién lo marcó.
--     El motor respeta una FACTURA capturada a mano al reclasificar.
--   - Con palabra_clave (≥ 4 letras) además crea la regla para la
--     organización (los siguientes estados de cuenta salen solos) y la
--     aplica a los movimientos sin factura que ya digan eso.
--
-- Ya aplicado en producción.

create or replace function public.fn_movimientos_sin_factura(p_ids uuid[], p_etiqueta text, p_palabra_clave text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_rol text := public.auth_rol();
  v_grupo uuid;
  v_nombre text;
  v_etiqueta text;
  v_clave text := upper(btrim(coalesce(p_palabra_clave, '')));
  v_fuera int;
  v_marcados int := 0;
  v_por_regla int := 0;
  v_regla_nueva boolean := false;
begin
  if v_rol not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo dirección, corporativo o el administrador marcan movimientos sin factura' using errcode = '42501';
  end if;
  v_etiqueta := upper(btrim(regexp_replace(coalesce(p_etiqueta, ''), '^\s*N\s*/\s*A\s*-?\s*', '', 'i')));
  if length(v_etiqueta) < 3 then
    raise exception 'Escribe el motivo (ej. COMISION BANCARIA)';
  end if;
  v_etiqueta := 'N/A - ' || v_etiqueta;
  select grupo_id, nombre into v_grupo, v_nombre from public.profiles where id = auth.uid();

  select count(*) into v_fuera from public.movimientos m
  where m.id = any (p_ids) and not (m.empresa_id = any (public.auth_empresas_alcance()));
  if v_fuera > 0 then
    raise exception 'Hay movimientos de empresas que no manejas' using errcode = '42501';
  end if;

  update public.movimientos m
     set factura = v_etiqueta, estado_clasificacion = 'resuelto', posible_duplicado = false,
         observacion = 'Marcado sin factura por ' || coalesce(v_nombre, 'usuario') || ': ' || v_etiqueta,
         updated_by = auth.uid(), updated_at = now()
   where m.id = any (p_ids);
  get diagnostics v_marcados = row_count;

  if length(v_clave) >= 4 and v_grupo is not null then
    if not exists (select 1 from public.reglas_clasificacion r where r.grupo_id = v_grupo and upper(r.palabra_clave) = v_clave) then
      insert into public.reglas_clasificacion (palabra_clave, etiqueta, orden, activo, grupo_id, updated_by)
      values (v_clave, v_etiqueta, 200, true, v_grupo, auth.uid());
      v_regla_nueva := true;
    end if;
    update public.movimientos m
       set factura = v_etiqueta, estado_clasificacion = 'resuelto',
           observacion = 'Clasificado automáticamente: ' || v_etiqueta,
           updated_by = auth.uid(), updated_at = now()
     where m.empresa_id = any (public.auth_empresas_alcance())
       and m.factura is null and m.estado_clasificacion <> 'resuelto'
       and translate(upper(coalesce(m.nombre_razon_social, '') || ' ' || coalesce(m.comentarios, '')), 'ÁÉÍÓÚÜ', 'AEIOUU')
           like '%' || translate(v_clave, 'ÁÉÍÓÚÜ', 'AEIOUU') || '%';
    get diagnostics v_por_regla = row_count;
  end if;

  return jsonb_build_object('etiqueta', v_etiqueta, 'marcados', v_marcados, 'regla_nueva', v_regla_nueva, 'por_regla', v_por_regla);
end;
$$;
revoke all on function public.fn_movimientos_sin_factura(uuid[], text, text) from public, anon;
grant execute on function public.fn_movimientos_sin_factura(uuid[], text, text) to authenticated;
