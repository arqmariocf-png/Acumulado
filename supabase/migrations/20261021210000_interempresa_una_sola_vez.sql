-- Venta inter empresa una sola vez por partida (21-oct-2026, Mario: "en las
-- que son de inter empresa, si ya se generó la venta y compra total, que ya no
-- te deje volverlo a hacer; que se elimine el botón").
--
-- Cada OV inter empresa guarda qué partidas de la OC/OS de origen cubrió y
-- cuánto (`ordenes_venta.interempresa_partidas` = [{linea, cantidad}]; vive en
-- el encabezado para que editar las partidas de la OV no pierda la liga). Lo
-- que falta de cada partida = cantidad de la partida − lo generado en OV inter
-- empresa no canceladas (fn_interempresa_restante). fn_orden_interempresa ya
-- no deja generar más de lo que falta ni repetir una orden ya completa, y la
-- lista de órdenes esconde el botón con fn_interempresa_estado.
-- Las 7 que había al 21-oct (IA-OV-0001…0007) cubrían su orden completa
-- (mismas partidas y cantidades): se rellenan con sus partidas de origen.
-- Ya aplicado en producción (interempresa_una_sola_vez).

alter table public.ordenes_venta add column if not exists interempresa_partidas jsonb;

update public.ordenes_venta ov
   set interempresa_partidas = (
     select coalesce(jsonb_agg(jsonb_build_object('linea', l.id, 'cantidad', l.cantidad) order by l.numero), '[]'::jsonb)
       from public.ordenes_compra_lineas l
      where l.orden_compra_id = ov.interempresa_origen_id)
 where ov.interempresa_origen_id is not null
   and ov.interempresa_partidas is null;

-- Lo que falta por vender de cada partida de la orden de origen.
create or replace function public.fn_interempresa_restante(p_origen uuid)
returns table (linea_id uuid, numero integer, item text, unidad text, cantidad numeric, costo numeric, iva boolean, generada numeric, restante numeric)
language sql
stable
security definer
set search_path = public
as $$
  with origen as (
    select o.id from public.ordenes_compra o
     where o.id = p_origen and o.empresa_id = any (public.auth_empresas_alcance())
  ), hecho as (
    select (x ->> 'linea')::uuid as linea, sum((x ->> 'cantidad')::numeric) as cantidad
      from public.ordenes_venta ov
      cross join lateral jsonb_array_elements(coalesce(ov.interempresa_partidas, '[]'::jsonb)) x
     where ov.interempresa_origen_id = p_origen and ov.cancelada_en is null
     group by 1
  )
  select l.id, l.numero::integer, l.item::text, l.unidad::text, l.cantidad, l.costo, l.iva,
         coalesce(h.cantidad, 0), greatest(coalesce(l.cantidad, 0) - coalesce(h.cantidad, 0), 0)
    from public.ordenes_compra_lineas l
    join origen o on o.id = l.orden_compra_id
    left join hecho h on h.linea = l.id
   where coalesce(btrim(l.item), '') <> '' and coalesce(l.cantidad, 0) > 0
   order by l.numero;
$$;

revoke all on function public.fn_interempresa_restante(uuid) from public, anon;
grant execute on function public.fn_interempresa_restante(uuid) to authenticated;

-- Para la lista: por cada orden con venta inter empresa viva, si ya está completa.
create or replace function public.fn_interempresa_estado()
returns table (origen_id uuid, completa boolean, restante numeric, ventas integer)
language sql
stable
security definer
set search_path = public
as $$
  with origenes as (
    select ov.interempresa_origen_id as id, count(*)::integer as ventas
      from public.ordenes_venta ov
      join public.ordenes_compra o on o.id = ov.interempresa_origen_id
     where ov.cancelada_en is null and o.empresa_id = any (public.auth_empresas_alcance())
     group by 1
  )
  select g.id,
         coalesce(sum(r.restante), 0) = 0,
         coalesce(sum(r.restante), 0),
         g.ventas
    from origenes g
    left join lateral public.fn_interempresa_restante(g.id) r on true
   group by g.id, g.ventas;
$$;

revoke all on function public.fn_interempresa_estado() from public, anon;
grant execute on function public.fn_interempresa_estado() to authenticated;

-- Nueva firma con las partidas de origen; la anterior se quita para que la
-- API no tenga dos funciones con el mismo nombre.
drop function if exists public.fn_orden_interempresa(uuid, uuid, jsonb, numeric, text, text, text, text);

create or replace function public.fn_orden_interempresa(
  p_origen uuid,
  p_empresa_compradora uuid,
  p_lineas jsonb,
  p_comision numeric default null,
  p_proyecto text default null,
  p_forma_pago text default null,
  p_condicion text default null,
  p_notas text default null,
  p_partidas_origen jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_oc public.ordenes_compra;
  v_vende public.empresas;
  v_compra public.empresas;
  v_nota text;
  v_ov jsonb;
  v_oc2 jsonb;
  v_falta numeric;
  r record;
begin
  if not public.auth_captura_ordenes() then
    raise exception 'Sin permiso para capturar órdenes (compras, almacén o dirección).' using errcode = '42501';
  end if;
  select * into v_oc from public.ordenes_compra where id = p_origen for update;
  if v_oc.id is null or not (v_oc.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'No encuentro la orden de origen o no es de una empresa que manejes.' using errcode = '42501';
  end if;
  if v_oc.rechazada_en is not null then
    raise exception 'La orden % está cancelada o rechazada.', v_oc.id_orden;
  end if;

  -- Una sola vez por partida: nada de más ni repetir una orden ya completa.
  select coalesce(sum(x.restante), 0) into v_falta from public.fn_interempresa_restante(p_origen) x;
  if v_falta <= 0 then
    raise exception 'La orden % ya tiene su venta y compra inter empresa completas.', v_oc.id_orden;
  end if;
  if p_partidas_origen is not null then
    for r in
      select (e ->> 'linea')::uuid as linea, sum((e ->> 'cantidad')::numeric) as cantidad
        from jsonb_array_elements(p_partidas_origen) e
       group by 1
    loop
      if r.cantidad is null or r.cantidad <= 0 then
        raise exception 'Cantidad inválida en una partida.';
      end if;
      select x.restante into v_falta from public.fn_interempresa_restante(p_origen) x where x.linea_id = r.linea;
      if v_falta is null then
        raise exception 'Una partida no es de la orden %.', v_oc.id_orden;
      end if;
      if r.cantidad > v_falta + 0.0001 then
        raise exception 'De una partida de % solo faltan % por vender inter empresa.', v_oc.id_orden, trim(to_char(v_falta, 'FM999999990.####'));
      end if;
    end loop;
  end if;

  select * into v_vende from public.empresas where id = v_oc.empresa_id;
  select * into v_compra from public.empresas where id = p_empresa_compradora;
  if v_compra.id is null or v_compra.grupo_id is distinct from v_vende.grupo_id then
    raise exception 'Elige la empresa que compra (del mismo grupo).';
  end if;
  if v_compra.id = v_vende.id then
    raise exception 'La empresa que compra debe ser otra distinta de %.', v_vende.codigo;
  end if;

  v_nota := concat_ws(' · ',
    format('Inter empresa: base %s %s (%s)', v_oc.tipo, v_oc.id_orden, coalesce(v_oc.proveedor, 'sin proveedor')),
    case when p_comision is not null then format('comisión %s %%', trim(to_char(p_comision, 'FM999990.##'))) end,
    nullif(btrim(coalesce(p_notas, '')), ''));

  v_ov := public.fn_orden_ia_guardar(
    null, 'OV', v_vende.id, coalesce(nullif(btrim(v_compra.razon_social), ''), v_compra.nombre),
    coalesce(p_proyecto, v_oc.proyecto), null, p_lineas, p_forma_pago, p_condicion,
    v_oc.fecha_entrega, v_oc.lugar_entrega, v_nota);
  v_oc2 := public.fn_orden_ia_guardar(
    null, case when v_oc.tipo = 'OS' then 'OS' else 'OC' end, v_compra.id, coalesce(nullif(btrim(v_vende.razon_social), ''), v_vende.nombre),
    coalesce(p_proyecto, v_oc.proyecto), null, p_lineas, p_forma_pago, p_condicion,
    v_oc.fecha_entrega, v_oc.lugar_entrega, v_nota || format(' · OV %s', v_ov ->> 'folio'));

  -- Sin partidas de origen (pantalla vieja): se toma como la orden completa.
  update public.ordenes_venta
     set interempresa_origen_id = v_oc.id,
         interempresa_partidas = coalesce(p_partidas_origen,
           (select jsonb_agg(jsonb_build_object('linea', x.linea_id, 'cantidad', x.restante))
              from public.fn_interempresa_restante(v_oc.id) x where x.restante > 0))
   where id = (v_ov ->> 'id')::uuid;
  update public.ordenes_compra set interempresa_origen_id = v_oc.id where id = (v_oc2 ->> 'id')::uuid;

  return jsonb_build_object('ov', v_ov, 'oc', v_oc2, 'origen', v_oc.id_orden);
end;
$$;
revoke all on function public.fn_orden_interempresa(uuid, uuid, jsonb, numeric, text, text, text, text, jsonb) from public, anon;
grant execute on function public.fn_orden_interempresa(uuid, uuid, jsonb, numeric, text, text, text, text, jsonb) to authenticated;
