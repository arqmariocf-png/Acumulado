-- Quitar un comprobante subido por error (21-oct-2026, Mario: "en la de
-- Delia hay una orden de compra que subieron en efectivo; ella subió un
-- comprobante que no corresponde y se quedó atorada"). La OC 41381 de AEP
-- (El Lobo, $5,750, forma de pago Efectivo) tenía su pago programado como
-- transferencia (antes de la regla del 20-oct), así que salió en Tesorería;
-- Delia le confirmó el comprobante del SAT de CSC (OS 0009-0010) y quedó
-- confirmada sin pagar, sin forma de corregirla desde la app.
--
-- fn_pago_quitar_comprobante(pago, motivo): admin, dirección o corporativo
-- (tesorería) en su alcance. Quita el comprobante y la confirmación (el
-- archivo se queda en Storage, ya no ligado), anota el motivo en las notas y,
-- si el pago sigue pendiente y su OC es en efectivo (condición efectivo o
-- forma de pago Efectivo), lo pasa a método efectivo sin cuenta: sale de
-- Tesorería y lo confirma dirección en Efectivo por confirmar. Un pago ya
-- pagado conserva su estatus (queda en "pagos sin comprobante").
--
-- Ya aplicado en producción (pago_quitar_comprobante).

create or replace function public.fn_pago_quitar_comprobante(p_pago uuid, p_motivo text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_rol text := public.auth_rol();
  v_nombre text;
  v_pago public.pagos_programados%rowtype;
  v_efectivo boolean := false;
begin
  if v_rol not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo tesorería, dirección o el administrador quitan comprobantes' using errcode = '42501';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'Escribe por qué se quita el comprobante';
  end if;
  select * into v_pago from public.pagos_programados where id = p_pago for update;
  if not found or not (v_pago.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'Pago no encontrado o de una empresa que no manejas' using errcode = '42501';
  end if;
  if v_pago.comprobante_path is null and v_pago.confirmado_en is null then
    raise exception 'Ese pago no tiene comprobante';
  end if;

  if v_pago.orden_compra_id is not null then
    select coalesce(o.condicion_pago = 'efectivo', false) or coalesce(o.tipo_pago_backoffice ilike 'efectivo%', false)
      into v_efectivo
      from public.ordenes_compra o where o.id = v_pago.orden_compra_id;
  end if;

  select nombre into v_nombre from public.profiles where id = auth.uid();
  update public.pagos_programados p
     set comprobante_path = null, comprobante_nombre = null, comprobante_en = null, comprobante_por = null,
         confirmado_en = null, confirmado_por = null,
         metodo = case when p.estatus = 'pendiente' and coalesce(v_efectivo, false) then 'efectivo' else p.metodo end,
         cuenta_id = case when p.estatus = 'pendiente' and coalesce(v_efectivo, false) then null else p.cuenta_id end,
         notas = btrim(coalesce(p.notas, '') || ' [' || to_char(now() at time zone 'America/Mexico_City', 'DD/MM/YYYY')
                 || ': ' || coalesce(v_nombre, 'usuario') || ' quitó el comprobante "'
                 || coalesce(v_pago.comprobante_nombre, '') || '": ' || btrim(p_motivo) || ']'),
         updated_at = now()
   where p.id = p_pago;

  return jsonb_build_object('pasa_a_efectivo', v_pago.estatus = 'pendiente' and coalesce(v_efectivo, false) and v_pago.metodo <> 'efectivo');
end;
$$;
revoke all on function public.fn_pago_quitar_comprobante(uuid, text) from public, anon;
grant execute on function public.fn_pago_quitar_comprobante(uuid, text) to authenticated;
