-- "Esto es en inventarios" (Mario, 24-sep-2026): el botón para traer las OC
-- del backoffice vive también en Inventario > Registrar movimiento, así que
-- quien captura inventario (almacen, direccion, empresa) puede solicitar la
-- sincronización y ver su estado, no solo admin/corporativo.

create or replace function public.solicitar_sincronizacion_oc_ov()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if public.auth_rol() not in ('admin', 'corporativo') and not public.auth_puede_escribir_inventario() then
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
    format('select public.ejecutar_sincronizacion_oc_ov(%L::uuid)', v_id)
  );
  return v_id;
end;
$$;

drop policy if exists sincronizaciones_oc_ov_select on public.sincronizaciones_oc_ov;
create policy sincronizaciones_oc_ov_select on public.sincronizaciones_oc_ov
  for select to authenticated
  using (public.auth_rol() in ('admin', 'corporativo') or public.auth_puede_escribir_inventario());
