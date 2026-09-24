-- El botón "Sincronizar catálogo OC/OV" fallaba con "HTTP request cancelled"
-- (Mario, 23-sep-2026): la llamada al API del backoffice tarda 30-60 s y la
-- petición HTTP que la esperaba se cancelaba a medio camino. Ahora el botón
-- solo SOLICITA la sincronización; pg_cron la corre en segundo plano (sin
-- conexión de cliente que se pueda cortar) y el frontend consulta el estado.

create table public.sincronizaciones_oc_ov (
  id uuid primary key default gen_random_uuid(),
  solicitada_por uuid references public.profiles(id),
  solicitada_en timestamptz not null default now(),
  iniciada_en timestamptz,
  terminada_en timestamptz,
  resultado jsonb,
  error text
);

alter table public.sincronizaciones_oc_ov enable row level security;

create policy sincronizaciones_oc_ov_select on public.sincronizaciones_oc_ov
  for select to authenticated
  using (public.auth_rol() in ('admin', 'corporativo'));

-- Corre UNA sincronización solicitada. La invoca pg_cron (como postgres);
-- lo primero que hace es desprogramar su propio job para que sea de una
-- sola corrida, y guarda el resultado o el error en la fila.
create or replace function public.ejecutar_sincronizacion_oc_ov(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_job text := 'sync-oc-ov-manual-' || p_id::text;
  v_res jsonb;
begin
  if exists (select 1 from cron.job where jobname = v_job) then
    perform cron.unschedule(v_job);
  end if;
  if exists (select 1 from public.sincronizaciones_oc_ov where id = p_id and terminada_en is not null) then
    return;
  end if;
  update public.sincronizaciones_oc_ov set iniciada_en = clock_timestamp() where id = p_id;
  begin
    v_res := public.sincronizar_catalogo_oc_ov();
    update public.sincronizaciones_oc_ov set terminada_en = clock_timestamp(), resultado = v_res where id = p_id;
  exception when others then
    update public.sincronizaciones_oc_ov set terminada_en = clock_timestamp(), error = sqlerrm where id = p_id;
  end;
end;
$$;

revoke all on function public.ejecutar_sincronizacion_oc_ov(uuid) from public, anon, authenticated;

-- Solicita una sincronización (admin/corporativo). Si ya hay una en curso
-- de los últimos 5 minutos, devuelve esa misma en vez de encimar otra.
create or replace function public.solicitar_sincronizacion_oc_ov()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if public.auth_rol() not in ('admin', 'corporativo') then
    raise exception 'Solo corporativo/admin pueden sincronizar el catálogo de todas las empresas';
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

revoke all on function public.solicitar_sincronizacion_oc_ov() from public, anon;
grant execute on function public.solicitar_sincronizacion_oc_ov() to authenticated;
