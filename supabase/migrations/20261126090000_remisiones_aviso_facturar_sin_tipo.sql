-- "No deja confirmar" (26-nov-2026, Mario): confirmar la entrega de una
-- remisión de salida de almacén (REM-AEP-000020, Alma) respondía 400:
-- record "new" has no field "tipo". El trigger remisiones_aviso_facturar
-- (aviso a contabilidad "lista para facturar", 20261104100000) corre en
-- remisiones_salida y remisiones_produccion y preguntaba new.tipo /
-- new.paga_nombre / new.contraparte, columnas que solo existen en planta;
-- plpgsql resuelve new.<campo> al preparar la expresión, así que el `and`
-- no lo salvaba y la confirmación entera se deshacía. Ahora los campos que
-- no comparten las dos tablas se leen con to_jsonb(new).
--
-- Ya aplicado en producción (remisiones_aviso_facturar_sin_tipo).

create or replace function public.remisiones_aviso_facturar()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_grupo uuid; v_cliente text; v_empresa text; v_fila jsonb;
begin
  if new.estatus <> 'entregada' or old.estatus = 'entregada' then return null; end if;
  if new.factura_estado <> 'por_facturar' then return null; end if;
  -- Los campos que solo existen en una de las dos tablas se leen por JSON:
  -- plpgsql resuelve new.<campo> al preparar la expresión y, en
  -- remisiones_salida, new.tipo tronaba ("record new has no field tipo") y
  -- deshacía la confirmación de entrega.
  v_fila := to_jsonb(new);
  if tg_table_name = 'remisiones_produccion' and coalesce(v_fila->>'tipo', 'salida') <> 'salida' then return null; end if;
  select e.grupo_id, e.codigo into v_grupo, v_empresa from public.empresas e where e.id = new.empresa_id;
  if tg_table_name = 'remisiones_salida' then
    v_cliente := v_fila->>'entregar_a';
  else
    v_cliente := coalesce(v_fila->>'paga_nombre', v_fila->>'contraparte');
  end if;
  perform public.fn_push_aviso(
    public.fn_contabilidad_de(v_grupo),
    'Remisión entregada, lista para facturar',
    concat_ws(' · ', new.folio, v_empresa, v_cliente),
    '/contabilidad/remisiones');
  return null;
end;
$$;
