-- Botón "Actualizar OC/OV" en Finanzas → Programación de pagos (Mario,
-- 29-sep-2026): dirección (Laura) puede pedir la sincronización con el
-- backoffice y ver su estado, explícitamente y sin depender de
-- auth_puede_escribir_inventario. Ya aplicado en producción.
create or replace function public.solicitar_sincronizacion_oc_ov()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  -- admin/corporativo/dirección, y también quien captura inventario
  -- (almacen, empresa): las OC se usan al registrar entradas y al pagar.
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
    format('select public.ejecutar_sincronizacion_oc_ov(%L::uuid)', v_id)
  );
  return v_id;
end;
$$;

drop policy if exists sincronizaciones_oc_ov_select on public.sincronizaciones_oc_ov;
create policy sincronizaciones_oc_ov_select on public.sincronizaciones_oc_ov for select
  using ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'corporativo'::app_rol, 'direccion'::app_rol])
         or (select public.auth_puede_escribir_inventario_definer()));
