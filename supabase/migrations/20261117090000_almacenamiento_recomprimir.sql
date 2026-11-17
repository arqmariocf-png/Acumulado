-- Almacenamiento: resumen por carpeta y candidatos a recomprimir (17-nov-2026,
-- Mario: "ajusta todos al mínimo"). La compresión automática del 17-nov solo
-- aplica a lo nuevo; lo ya guardado (RH 378 MB en 74 PDF escaneados, checador
-- 249 MB en 1,907 selfies) se recomprime desde el navegador del director
-- general en Sistemas › Almacenamiento (misma regla que al subir), con la
-- edge `archivos-recomprimir`. Estas dos funciones solo las llama esa edge
-- (service_role) y devuelven nada si hay usuario y no es el admin maestro.
--
-- Carpetas que se recomprimen: rh, checador, tareas, pagos, legal,
-- comprobaciones, cotizaciones, remisiones-produccion, notas-entrega.
-- NUNCA: estados-cuenta, sat, cfdi, planos, oc-excel, ov-excel, cxc.
-- La fecha sale de metadata->>'lastModified' porque el stub de storage.objects
-- del validador local no tiene created_at.

create or replace function public.fn_almacenamiento_carpetas_recomprimibles()
returns text[]
language sql
immutable
as $$
  select array['rh', 'checador', 'tareas', 'pagos', 'legal', 'comprobaciones', 'cotizaciones', 'remisiones-produccion', 'notas-entrega']::text[];
$$;

-- Umbral por carpeta: selfies del checador > 110 KB (a 800 px quedan en ~80);
-- otras fotos > 300 KB; PDF > 1.5 MB.
create or replace function public.fn_almacenamiento_es_candidato(p_carpeta text, p_mime text, p_bytes bigint)
returns boolean
language sql
immutable
as $$
  select case
    when p_carpeta <> all (public.fn_almacenamiento_carpetas_recomprimibles()) then false
    when p_mime like 'image/%' and p_carpeta = 'checador' then p_bytes > 110 * 1024
    when p_mime like 'image/%' then p_bytes > 300 * 1024
    when p_mime = 'application/pdf' then p_bytes > 1536 * 1024
    else false
  end;
$$;

create or replace function public.fn_almacenamiento_resumen()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is not null and not public.auth_admin_global() then null else (
    select jsonb_build_object(
      'total', jsonb_build_object('archivos', count(*), 'bytes', coalesce(sum((o.metadata->>'size')::bigint), 0)),
      'carpetas', coalesce((
        select jsonb_agg(c order by (c->>'bytes')::bigint desc) from (
          select jsonb_build_object(
            'carpeta', split_part(o2.name, '/', 1),
            'archivos', count(*),
            'bytes', coalesce(sum((o2.metadata->>'size')::bigint), 0),
            'imagenes', count(*) filter (where o2.metadata->>'mimetype' like 'image/%'),
            'pdfs', count(*) filter (where o2.metadata->>'mimetype' = 'application/pdf'),
            'recomprimible', split_part(o2.name, '/', 1) = any (public.fn_almacenamiento_carpetas_recomprimibles()),
            'candidatos', count(*) filter (where public.fn_almacenamiento_es_candidato(split_part(o2.name, '/', 1), o2.metadata->>'mimetype', (o2.metadata->>'size')::bigint)),
            'bytes_candidatos', coalesce(sum((o2.metadata->>'size')::bigint) filter (where public.fn_almacenamiento_es_candidato(split_part(o2.name, '/', 1), o2.metadata->>'mimetype', (o2.metadata->>'size')::bigint)), 0),
            'ultimo', max((o2.metadata->>'lastModified')::timestamptz)
          ) as c
          from storage.objects o2
          where o2.bucket_id = 'cargas'
          group by split_part(o2.name, '/', 1)
        ) x), '[]'::jsonb),
      'en', now()
    )
    from storage.objects o where o.bucket_id = 'cargas'
  ) end;
$$;

create or replace function public.fn_almacenamiento_candidatos(p_carpeta text, p_limite int default 300)
returns table (ruta text, mime text, bytes bigint, creado timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.name, o.metadata->>'mimetype', (o.metadata->>'size')::bigint, (o.metadata->>'lastModified')::timestamptz
  from storage.objects o
  where (auth.uid() is null or public.auth_admin_global())
    and o.bucket_id = 'cargas'
    and split_part(o.name, '/', 1) = p_carpeta
    and public.fn_almacenamiento_es_candidato(p_carpeta, o.metadata->>'mimetype', (o.metadata->>'size')::bigint)
  order by (o.metadata->>'size')::bigint desc
  limit greatest(1, least(coalesce(p_limite, 300), 2000));
$$;

revoke all on function public.fn_almacenamiento_resumen() from public, anon, authenticated;
revoke all on function public.fn_almacenamiento_candidatos(text, int) from public, anon, authenticated;
grant execute on function public.fn_almacenamiento_resumen() to service_role;
grant execute on function public.fn_almacenamiento_candidatos(text, int) to service_role;
