-- Una sola serie para órdenes de compra y de servicio (19-oct-2026, Mario:
-- "en el caso de Alma y de Laura cada una tiene sus órdenes de compra y de
-- servicio, debiendo ser una serie global para todos"). Antes OC y OS
-- llevaban cada una su contador (IA-OC-0002 e IA-OS-0002 a la vez) y las OC
-- que salen de requisiciones usaban RQ-<empresa>-0001. Ahora todas toman el
-- número de un solo consecutivo (secuencia folio_ia_oc) y conservan su prefijo
-- (IA-OC-0003, IA-OS-0004, IA-OC-0005…). Las ya emitidas no se renumeran.
-- folio_ia_os queda sin uso. Ya aplicado en producción (folio_global_oc_os).

-- El consecutivo sigue después del número más alto ya usado en OC u OS.
select setval('public.folio_ia_oc', greatest(
  coalesce((select max(substring(id_orden from '^IA-O[CS]-([0-9]+)$')::int) from public.ordenes_compra where id_orden ~ '^IA-O[CS]-[0-9]+$'), 0),
  (select last_value from public.folio_ia_oc where is_called),
  (select last_value from public.folio_ia_os where is_called),
  1), true);

do $x$
declare d text; n text;
begin
  d := pg_get_functiondef('public.fn_orden_ia_guardar(uuid,text,uuid,text,text,date,jsonb,text,text,date,text,text)'::regprocedure);
  n := replace(d, $r$nextval((case when v_tipo = 'OC' then 'public.folio_ia_oc' else 'public.folio_ia_os' end)::regclass)$r$, $r$nextval('public.folio_ia_oc')$r$);
  n := replace(n, '-- Cambió de OC a OS o al revés: folio de la serie que corresponde.', '-- Cambió de OC a OS o al revés: número nuevo de la serie única con el prefijo que corresponde.');
  if n = d then raise exception 'fn_orden_ia_guardar no tenía la serie por tipo esperada'; end if;
  execute n;

  d := pg_get_functiondef('public.fn_oc_desde_necesidades(jsonb,text,date,boolean)'::regprocedure);
  n := replace(d, $r$public.fn_siguiente_folio(v_empresa, 'RQ')$r$, $r$'IA-OC-' || lpad(nextval('public.folio_ia_oc')::text, 4, '0')$r$);
  if n = d then raise exception 'fn_oc_desde_necesidades no tenía el folio RQ esperado'; end if;
  execute n;
end $x$;
