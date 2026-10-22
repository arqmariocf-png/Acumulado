-- Sin inter empresa sobre órdenes canceladas (Laura, 22-oct-2026: "sobre
-- órdenes canceladas quitar el botón de interempresa"). La pantalla ya lo
-- escondía para las canceladas aquí y las rechazadas; fn_orden_interempresa
-- solo revisaba rechazada_en, así que una OC que el backoffice da por
-- "Cancelada" (rechazada_en vacío) todavía pasaba. Se agrega esa condición
-- sobre la definición vigente (sin reescribir el resto de la función).
--
-- Ya aplicado en producción (interempresa_sin_canceladas_backoffice).

do $do$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_orden_interempresa' and p.pronargs = 9;
  if v_def is null then
    raise exception 'No encuentro fn_orden_interempresa de 9 parámetros';
  end if;
  if position('estatus_backoffice' in v_def) = 0 then
    v_def := replace(v_def,
      'if v_oc.rechazada_en is not null then',
      'if v_oc.rechazada_en is not null or coalesce(v_oc.estatus_backoffice, '''') ilike ''cancel%'' then');
    execute v_def;
  end if;
end;
$do$;
