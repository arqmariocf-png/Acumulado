-- Ligar solo, sin clic, lo que el banco ya trae con número de orden
-- (20-oct-2026, Mario: "una vez que el estatus está en revisión tendría que
-- abrir la lista de OC/OV por número para hacerlo en automático"). 158 de los
-- 1,554 cargos en revisión dicen la orden en el concepto ("SPEI ENVIADO …
-- 0191026OC 41492 CSC").
--
-- - fn_movimiento_ligar_orden_aplicar(mov, tipo, orden, quien): lo que hace
--   "Ligar" (referencia, proyecto/nombre si faltaban, CFDI por monto, estado),
--   sin guarda; revocada, solo la llaman las otras dos.
-- - fn_movimiento_ligar_orden (la del botón) queda con su guarda y llama a la
--   de arriba.
-- - fn_movimientos_ligar_por_concepto(): movimientos en revisión o ambiguos cuyo
--   concepto (o la referencia que ya traen) nombra UNA sola orden de la misma
--   empresa (OC/OS no rechazada ni cancelada para cargos, OV no cancelada para
--   abonos). Corre cada hora (pg_cron minuto 50) y una vez al aplicar; así lo
--   que "Reclasificar" regresa a revisión (el motor desplegado deja en revisión
--   lo que tiene orden pero no CFDI) vuelve a quedar ligado.
-- Ya aplicado en producción (movimientos_ligar_por_concepto).

create or replace function public.fn_movimiento_ligar_orden_aplicar(p_movimiento uuid, p_tipo text, p_orden uuid, p_quien text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_mov public.movimientos%rowtype;
  v_tipo text := upper(btrim(coalesce(p_tipo, '')));
  v_numero text;
  v_proyecto text;
  v_contraparte text;
  v_monto numeric;
  v_tipo_cfdi text;
  v_folios text[];
  v_factura text;
  v_estado text;
begin
  select * into v_mov from public.movimientos where id = p_movimiento for update;
  if not found then
    raise exception 'Movimiento no encontrado';
  end if;
  if v_mov.estado_clasificacion = 'resuelto' then
    raise exception 'Ese movimiento ya está conciliado';
  end if;

  if v_tipo in ('OC', 'OS') then
    select o.id_orden, o.proyecto, o.proveedor, o.tipo into v_numero, v_proyecto, v_contraparte, v_tipo
      from public.ordenes_compra o
     where o.id = p_orden and o.empresa_id = v_mov.empresa_id;
  elsif v_tipo = 'OV' then
    select o.id_ov, o.proyecto, o.cliente into v_numero, v_proyecto, v_contraparte
      from public.ordenes_venta o
     where o.id = p_orden and o.empresa_id = v_mov.empresa_id;
  else
    raise exception 'Tipo de orden inválido: %', p_tipo;
  end if;
  if v_numero is null then
    raise exception 'La orden no existe o es de otra empresa';
  end if;
  v_tipo := coalesce(nullif(upper(v_tipo), ''), 'OC');

  v_monto := coalesce(v_mov.cargo_total, v_mov.abono_total);
  v_tipo_cfdi := case when v_mov.cargo_total is not null then 'recibido' else 'emitido' end;
  if v_mov.factura is null and v_monto is not null then
    select array_agg(c.folio) into v_folios from public.cfdi c
     where c.empresa_id = v_mov.empresa_id and c.tipo = v_tipo_cfdi
       and abs(c.total - v_monto) <= 0.01;
    if coalesce(array_length(v_folios, 1), 0) > 1 then
      select array_agg(c.folio) into v_folios from public.cfdi c
       where c.empresa_id = v_mov.empresa_id and c.tipo = v_tipo_cfdi
         and abs(c.total - v_monto) <= 0.01
         and public.fn_proveedor_clave(c.contraparte) = public.fn_proveedor_clave(v_contraparte);
    end if;
    if coalesce(array_length(v_folios, 1), 0) = 1 then
      v_factura := 'F- ' || v_folios[1];
    end if;
  end if;

  v_estado := case when coalesce(v_factura, v_mov.factura) is not null then 'resuelto' else 'pendiente_esperado' end;

  update public.movimientos m
     set referencia_tipo = v_tipo,
         referencia_numero = v_numero,
         proyecto = coalesce(m.proyecto, v_proyecto),
         nombre_razon_social = coalesce(m.nombre_razon_social, v_contraparte),
         factura = coalesce(m.factura, v_factura),
         estado_clasificacion = v_estado,
         posible_duplicado = false,
         observacion = 'Ligado a ' || v_tipo || ' ' || v_numero || coalesce(' (' || v_contraparte || ')', '')
                       || ' ' || p_quien
                       || case when v_estado = 'resuelto' then '' else '; falta factura' end,
         updated_by = auth.uid(), updated_at = now()
   where m.id = p_movimiento;

  return jsonb_build_object('tipo', v_tipo, 'numero', v_numero, 'factura', coalesce(v_factura, v_mov.factura), 'estado', v_estado);
end;
$$;
revoke all on function public.fn_movimiento_ligar_orden_aplicar(uuid, text, uuid, text) from public, anon, authenticated;

create or replace function public.fn_movimiento_ligar_orden(p_movimiento uuid, p_tipo text, p_orden uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_nombre text;
begin
  if public.auth_rol() not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo dirección, corporativo o el administrador ligan movimientos a órdenes' using errcode = '42501';
  end if;
  if not exists (select 1 from public.movimientos m
                  where m.id = p_movimiento and m.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'Movimiento no encontrado o de una empresa que no manejas' using errcode = '42501';
  end if;
  select nombre into v_nombre from public.profiles where id = auth.uid();
  return public.fn_movimiento_ligar_orden_aplicar(p_movimiento, p_tipo, p_orden, 'por ' || coalesce(v_nombre, 'usuario'));
end;
$$;
revoke all on function public.fn_movimiento_ligar_orden(uuid, text, uuid) from public, anon;
grant execute on function public.fn_movimiento_ligar_orden(uuid, text, uuid) to authenticated;

create or replace function public.fn_movimientos_ligar_por_concepto()
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  r record;
  v_ligados int := 0;
begin
  for r in
    with cand as (
      select m.id, m.empresa_id, m.cargo_total is not null as es_cargo,
             m.referencia_tipo,
             case when m.referencia_numero is not null then array[m.referencia_numero] else
             array(select distinct x[1]
                     from regexp_matches(coalesce(m.nombre_razon_social, '') || ' ' || coalesce(m.comentarios, ''),
                                         '(?<![A-Za-z])(?:O\.?\s?[CSV]\.?|ORDEN)\s*[-#:]?\s*(\d{4,6})(?!\d)', 'gi') x) end as numeros
        from public.movimientos m
       where m.estado_clasificacion in ('pendiente_revision', 'ambiguo')
         and (m.referencia_numero is null or m.referencia_tipo in ('OC', 'OS', 'OV'))
         and coalesce(m.cargo_total, m.abono_total) is not null
    ), ordenes as (
      select c.id as mov_id, 'OC' as tipo, o.id as orden_id
        from cand c
        join public.ordenes_compra o on o.empresa_id = c.empresa_id and o.id_orden = any (c.numeros)
       where c.es_cargo and coalesce(c.referencia_tipo, o.tipo) = o.tipo and o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
      union all
      select c.id, 'OV', o.id
        from cand c
        join public.ordenes_venta o on o.empresa_id = c.empresa_id and o.id_ov = any (c.numeros)
       where not c.es_cargo and coalesce(c.referencia_tipo, 'OV') = 'OV' and o.cancelada_en is null
    )
    select mov_id, min(tipo) as tipo, (array_agg(orden_id))[1] as orden_id
      from ordenes
     group by mov_id
    having count(*) = 1
  loop
    perform public.fn_movimiento_ligar_orden_aplicar(r.mov_id, r.tipo, r.orden_id, 'automáticamente por el concepto del banco');
    v_ligados := v_ligados + 1;
  end loop;
  return v_ligados;
end;
$$;
revoke all on function public.fn_movimientos_ligar_por_concepto() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('movimientos-ligar-por-concepto', '50 * * * *', 'select public.fn_movimientos_ligar_por_concepto();');
  end if;
end $$;

select public.fn_movimientos_ligar_por_concepto();
