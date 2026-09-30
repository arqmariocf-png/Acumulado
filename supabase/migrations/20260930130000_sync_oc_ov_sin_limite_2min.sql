-- La sincronización con el backoffice fallaba desde el 29-sep 21:15 UTC
-- ("canceling statement due to statement timeout" a los 2:00, en la
-- descarga de partidas): Gonzalo agregó información a la API y ahora tarda
-- más de los 120 s del statement_timeout general. El límite se sube SOLO
-- para estos trabajos de pg_cron, fijándolo antes de la llamada (un SET
-- dentro de la función no rearma el temporizador de la sentencia que ya
-- corre).
--
-- Ya aplicado en producción.

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.alter_job(jobid, command := 'set statement_timeout = ''10min''; select public.sincronizar_catalogo_oc_ov();')
    from cron.job where jobname = 'sync-catalogo-oc-ov-horario';
  end if;
end $$;

create or replace function public.solicitar_sincronizacion_oc_ov()
returns uuid language plpgsql security definer set search_path = public as $function$
declare
  v_id uuid;
begin
  if public.auth_rol() not in ('admin', 'corporativo', 'direccion') and not public.auth_puede_escribir_inventario() then
    raise exception 'Sin permiso para sincronizar el catálogo de OC/OV';
  end if;

  select id into v_id
    from public.sincronizaciones_oc_ov
   where terminada_en is null and solicitada_en > now() - interval '5 minutes'
   order by solicitada_en desc
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.sincronizaciones_oc_ov (solicitada_por) values (auth.uid()) returning id into v_id;
  perform cron.schedule(
    'sync-oc-ov-manual-' || v_id::text,
    '5 seconds',
    format('set statement_timeout = ''10min''; select public.ejecutar_sincronizacion_oc_ov(%L::uuid)', v_id)
  );
  return v_id;
end;
$function$;
