-- Catálogos completos del backoffice (12-nov-2026).
--
-- Gonzalo expuso dos endpoints nuevos (11-nov-2026):
--   api_proveedores_aut  https://reports.grupoloma.mx/dash/qry-prov-aut
--     {"api_proveedores_aut": [{id, nombre_razon_social, apellido, RFC, banco,
--      cuenta, direccon, num_ext, num_int, CP, colonia, ciudad, estado, pais,
--      correo, telefono, activo}]}   (1,854 proveedores; no trae método ni
--      forma de pago: esos se registran al crear la OC)
--   api_items_aut        https://reports.grupoloma.mx/dash/qry-items-aut
--     {"api_items_aut": [{id, descripcion, unidad, categoria, familia,
--      lleva_iva, ultimo_costo, fecha_costo, id_proveedor, proveedor,
--      id_usuario, usuario, activo}]}   (8,513 items; no trae clave)
--
-- Hasta hoy los catálogos de Acumulado solo se llenaban con lo que salía en
-- alguna OC (fn_proveedores_importar_backoffice / fn_items_importar_backoffice):
-- 330 fichas de proveedor de 1,798 y 1,669 items de 8,375. Ahora:
--   * fn_proveedores_desde_api(jsonb): ficha en `proveedores` (nombre, RFC,
--     domicilio, contacto, teléfono, correo, backoffice_id) para cada
--     proveedor del backoffice, y sus datos bancarios en
--     `proveedores_datos_bancarios` (origen 'backoffice'; nunca pisa lo
--     capturado aquí). Lo que ya existía solo se completa en lo que estaba en
--     blanco. El texto de "cuenta" del backoffice es libre ("CUENTA: …, CLABE:
--     …", "Cuenta 044 293 2504 CLABE 012 650 …", un solo número de 18 dígitos o
--     el texto de ayuda "Cuenta, CLABE, CIE, Referencia, Etcétera..."): se
--     saca la CLABE (18 dígitos con dígito verificador) y la cuenta (6-14).
--   * fn_items_desde_api(jsonb): item en `compras_items` por descripción
--     normalizada (clave IT-#### consecutiva), unidad, servicio si la familia
--     es "Servicio" o la unidad SRV, IVA, precio de referencia = último costo
--     s/IVA (el costo del backoffice trae IVA cuando lleva_iva = 1, igual que
--     las partidas de OC), familia/categoría/último proveedor en notas. Los
--     que ya existían solo se completan (unidad, precio, backoffice_id).
--   * sincronizar_catalogos_backoffice(): descarga los dos payloads (antes de
--     escribir nada) y llama a las dos; corre al final del cron horario
--     `sync-catalogo-oc-ov-horario`. Solo service_role.
-- Columnas nuevas: proveedores.backoffice_id, compras_items.backoffice_id.

alter table public.proveedores add column if not exists backoffice_id integer;
alter table public.compras_items add column if not exists backoffice_id integer;
create index if not exists proveedores_backoffice_id_idx on public.proveedores (grupo_id, backoffice_id);
create index if not exists compras_items_backoffice_id_idx on public.compras_items (grupo_id, backoffice_id);

-- CLABE y cuenta a partir del texto libre del backoffice.
create or replace function public.fn_clabe_de_texto(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when d is null or length(d) < 18 then null
    when public.fn_clabe_valida(substr(d, 1, 18)) then substr(d, 1, 18)
    else null
  end
  from (
    select regexp_replace(
      case when upper(coalesce(p, '')) ~ 'CLABE' then substring(upper(p) from 'CLABE(.*)$') else coalesce(p, '') end,
      '\D', '', 'g') as d
  ) x;
$$;

create or replace function public.fn_cuenta_de_texto(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when length(d) between 6 and 14 then d end
  from (
    select regexp_replace(
      case
        when upper(coalesce(p, '')) ~ 'CUENTA' then coalesce(substring(upper(p) from 'CUENTA(.*?)(CLABE|$)'), '')
        when upper(coalesce(p, '')) ~ 'CLABE' then ''
        else coalesce(p, '')
      end,
      '\D', '', 'g') as d
  ) x;
$$;

-- Limpia el payload de proveedores: una fila por clave (la que trae más datos).
create or replace function public.fn_proveedores_api_limpios(p_datos jsonb)
returns table (backoffice_id int, nombre text, clave text, rfc text, banco text, clabe text, cuenta text,
               domicilio text, correo text, telefono text, activo boolean, contacto text)
language sql
stable
set search_path = public
as $$
  with crudo as (
    select (f ->> 'id')::int as backoffice_id,
           btrim(regexp_replace(coalesce(f ->> 'nombre_razon_social', ''), '\s+', ' ', 'g')) as nombre,
           nullif(btrim(regexp_replace(coalesce(f ->> 'apellido', ''), '\s+', ' ', 'g')), '') as apellido,
           nullif(regexp_replace(upper(coalesce(f ->> 'RFC', '')), '[^A-ZÑ&0-9]', '', 'g'), '') as rfc,
           nullif(btrim(coalesce(f ->> 'banco', '')), '') as banco,
           f ->> 'cuenta' as cuenta_txt,
           nullif(btrim(concat_ws(', ',
             nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(f ->> 'direccon', '')), ''), nullif(btrim(coalesce(f ->> 'num_ext', '')), ''),
               case when nullif(btrim(coalesce(f ->> 'num_int', '')), '') is not null then 'int. ' || btrim(f ->> 'num_int') end)), ''),
             nullif(btrim(coalesce(f ->> 'colonia', '')), ''),
             case when nullif(btrim(coalesce(f ->> 'CP', '')), '') is not null then 'C.P. ' || btrim(f ->> 'CP') end,
             nullif(btrim(coalesce(f ->> 'ciudad', '')), ''),
             nullif(btrim(coalesce(f ->> 'estado', '')), ''))), '') as domicilio,
           nullif(lower(btrim(coalesce(f ->> 'correo', ''))), '') as correo,
           nullif(btrim(coalesce(f ->> 'telefono', '')), '') as telefono,
           coalesce(f ->> 'activo', 'activo') in ('activo', '1', 'true') as activo
    from jsonb_array_elements(coalesce(p_datos, '[]'::jsonb)) as f
  ), limpio as (
    select backoffice_id, nombre, public.fn_proveedor_clave(nombre) as clave,
           case when rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' then rfc end as rfc,
           banco,
           public.fn_clabe_de_texto(cuenta_txt) as clabe,
           public.fn_cuenta_de_texto(cuenta_txt) as cuenta,
           domicilio, correo, telefono, activo,
           case
             when apellido is null then null
             when apellido ~* 's\.?\s?a\.?\s?de\s?c' then null
             when public.normalizar_texto_sql(nombre) like '%' || public.normalizar_texto_sql(apellido) || '%' then null
             else apellido
           end as contacto
    from crudo
    where nombre <> ''
  )
  select distinct on (clave) backoffice_id, nombre, clave, rfc, banco, clabe, cuenta, domicilio, correo, telefono, activo, contacto
  from limpio
  where clave is not null and clave <> ''
  -- el mismo proveedor repetido en el backoffice: gana el renglón con más datos y, a igualdad, el más reciente
  order by clave,
           (rfc is not null)::int + (clabe is not null or cuenta is not null)::int + (domicilio is not null)::int + (correo is not null)::int desc,
           backoffice_id desc;
$$;

create or replace function public.fn_proveedores_desde_api(p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
  v_grupo uuid;
  v_nuevos int := 0;
  v_actualizados int := 0;
  v_bancarios int := 0;
begin
  if v_usuario is not null and not public.auth_admin_global() then
    raise exception 'Solo el proceso de sincronización importa el catálogo de proveedores' using errcode = '42501';
  end if;
  select id into v_grupo from public.grupos where es_maestro limit 1;
  if v_grupo is null or p_datos is null or jsonb_typeof(p_datos) <> 'array' then
    return jsonb_build_object('nuevos', 0, 'actualizados', 0, 'bancarios', 0, 'error', 'sin datos');
  end if;

  with escritos as (
    insert into public.proveedores as t
      (grupo_id, nombre, rfc, domicilio, contacto, telefono, correo, notas, activo, backoffice_id)
    select v_grupo, nombre, rfc, domicilio, contacto, telefono, correo,
           'Del catálogo de proveedores del backoffice (API).', activo, backoffice_id
    from public.fn_proveedores_api_limpios(p_datos)
    on conflict (grupo_id, clave) do update set
      rfc = coalesce(t.rfc, excluded.rfc),
      domicilio = coalesce(t.domicilio, excluded.domicilio),
      contacto = coalesce(t.contacto, excluded.contacto),
      telefono = coalesce(t.telefono, excluded.telefono),
      correo = coalesce(t.correo, excluded.correo),
      backoffice_id = excluded.backoffice_id
    where (t.rfc, t.domicilio, t.contacto, t.telefono, t.correo, t.backoffice_id) is distinct from
          (coalesce(t.rfc, excluded.rfc), coalesce(t.domicilio, excluded.domicilio), coalesce(t.contacto, excluded.contacto),
           coalesce(t.telefono, excluded.telefono), coalesce(t.correo, excluded.correo), excluded.backoffice_id)
    returning (xmax = 0) as insertado
  )
  select count(*) filter (where insertado), count(*) filter (where not insertado)
    into v_nuevos, v_actualizados
  from escritos;

  with escritos as (
    insert into public.proveedores_datos_bancarios as t
      (clave, nombre, beneficiario, banco, clabe, cuenta, rfc, correo, notas, grupo_id, origen, updated_at)
    select clave, nombre, nombre, coalesce(banco, public.fn_banco_de_clabe(clabe)), clabe, cuenta, rfc, correo,
           'Del catálogo de proveedores del backoffice (API).', v_grupo, 'backoffice', now()
    from public.fn_proveedores_api_limpios(p_datos)
    where clabe is not null or cuenta is not null or rfc is not null
    on conflict (clave) do update set
      banco = coalesce(excluded.banco, t.banco),
      clabe = coalesce(excluded.clabe, t.clabe),
      cuenta = coalesce(excluded.cuenta, t.cuenta),
      rfc = coalesce(excluded.rfc, t.rfc),
      correo = coalesce(t.correo, excluded.correo),
      notas = excluded.notas,
      origen = 'backoffice',
      updated_at = now()
    where t.origen <> 'captura'
      and (t.banco, t.clabe, t.cuenta, t.rfc, t.correo, t.origen) is distinct from
          (coalesce(excluded.banco, t.banco), coalesce(excluded.clabe, t.clabe), coalesce(excluded.cuenta, t.cuenta),
           coalesce(excluded.rfc, t.rfc), coalesce(t.correo, excluded.correo), 'backoffice')
    returning 1
  )
  select count(*) into v_bancarios from escritos;

  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_actualizados, 'bancarios', v_bancarios,
                            'recibidos', (select count(*) from public.fn_proveedores_api_limpios(p_datos)));
end;
$$;

-- Limpia el payload de items: una fila por descripción normalizada (la del
-- costo más reciente), solo activos.
create or replace function public.fn_items_api_limpios(p_datos jsonb)
returns table (backoffice_id int, descripcion text, norma text, unidad text, familia text, categoria text, iva boolean,
               precio numeric, fecha_costo text, proveedor text, categoria_app text)
language sql
stable
set search_path = public
as $$
  with crudo as (
    select (f ->> 'id')::int as backoffice_id,
           btrim(regexp_replace(coalesce(f ->> 'descripcion', ''), '\s+', ' ', 'g')) as descripcion,
           nullif(upper(btrim(coalesce(f ->> 'unidad', ''))), '') as unidad,
           nullif(btrim(coalesce(f ->> 'familia', '')), '') as familia,
           nullif(btrim(coalesce(f ->> 'categoria', '')), '') as categoria,
           coalesce(f ->> 'lleva_iva', '1') in ('1', 'true') as iva,
           nullif(f ->> 'ultimo_costo', '')::numeric as costo,
           nullif(f ->> 'fecha_costo', '') as fecha_costo,
           nullif(btrim(coalesce(f ->> 'proveedor', '')), '') as proveedor,
           coalesce(f ->> 'activo', '1') in ('1', 'true', 'activo') as activo
    from jsonb_array_elements(coalesce(p_datos, '[]'::jsonb)) as f
  ), limpio as (
    select backoffice_id, descripcion, public.normalizar_texto_sql(descripcion) as norma, unidad, familia, categoria, iva,
           case when costo > 0 then round(costo / case when iva then 1.16 else 1 end, 2) end as precio,
           fecha_costo, proveedor,
           case when familia ilike 'servicio%' or unidad = 'SRV' then 'servicio' else 'material' end as categoria_app
    from crudo
    where descripcion <> '' and activo
  )
  select distinct on (norma) backoffice_id, descripcion, norma, unidad, familia, categoria, iva, precio, fecha_costo, proveedor, categoria_app
  from limpio
  where norma is not null and norma <> ''
  order by norma, fecha_costo desc nulls last, backoffice_id desc;
$$;

create or replace function public.fn_items_desde_api(p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
  v_grupo uuid;
  v_nuevos int := 0;
  v_actualizados int := 0;
  v_base int;
begin
  if v_usuario is not null and not public.auth_admin_global() then
    raise exception 'Solo el proceso de sincronización importa el catálogo de items' using errcode = '42501';
  end if;
  select id into v_grupo from public.grupos where es_maestro limit 1;
  if v_grupo is null or p_datos is null or jsonb_typeof(p_datos) <> 'array' then
    return jsonb_build_object('nuevos', 0, 'actualizados', 0, 'error', 'sin datos');
  end if;

  with cambios as (
    update public.compras_items i
       set unidad = coalesce(i.unidad, a.unidad),
           precio_referencia = coalesce(i.precio_referencia, a.precio),
           backoffice_id = a.backoffice_id,
           updated_at = now()
      from public.fn_items_api_limpios(p_datos) a
     where i.grupo_id = v_grupo
       and public.normalizar_texto_sql(i.descripcion) = a.norma
       and (i.unidad, i.precio_referencia, i.backoffice_id) is distinct from
           (coalesce(i.unidad, a.unidad), coalesce(i.precio_referencia, a.precio), a.backoffice_id)
    returning 1
  )
  select count(*) into v_actualizados from cambios;

  select coalesce(max(substring(i.clave from '^IT-(\d+)$')::int), 0) into v_base
    from public.compras_items i where i.grupo_id = v_grupo;

  with faltan as (
    select a.*, row_number() over (order by a.descripcion) as n
      from public.fn_items_api_limpios(p_datos) a
     where not exists (
       select 1 from public.compras_items i
        where i.grupo_id = v_grupo and public.normalizar_texto_sql(i.descripcion) = a.norma)
  ), nuevos as (
    insert into public.compras_items (grupo_id, clave, descripcion, unidad, categoria, iva, precio_referencia, notas, activo, backoffice_id)
    select v_grupo, 'IT-' || lpad((v_base + n)::text, 4, '0'), descripcion, unidad, categoria_app, iva, precio,
           'Del catálogo de items del backoffice (API)'
             || coalesce(' · familia: ' || familia, '') || coalesce(' · categoría: ' || categoria, '')
             || coalesce(' · último proveedor: ' || proveedor, '') || '.',
           true, backoffice_id
      from faltan
    on conflict do nothing
    returning 1
  )
  select count(*) into v_nuevos from nuevos;

  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_actualizados,
                            'recibidos', (select count(*) from public.fn_items_api_limpios(p_datos)));
end;
$$;

-- Descarga los dos catálogos (antes de escribir nada) y los aplica. La llama
-- el cron horario; cada parte se protege sola para que un endpoint caído no
-- detenga al otro.
create or replace function public.sincronizar_catalogos_backoffice()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_prov jsonb;
  v_items jsonb;
  v_r_prov jsonb;
  v_r_items jsonb;
  v_err_prov text;
  v_err_items text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '300000');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '20000');

  begin
    select (content::jsonb) -> 'api_proveedores_aut' into v_prov
      from extensions.http_get('https://reports.grupoloma.mx/dash/qry-prov-aut');
  exception when others then
    v_err_prov := 'descarga: ' || sqlerrm;
  end;
  begin
    select (content::jsonb) -> 'api_items_aut' into v_items
      from extensions.http_get('https://reports.grupoloma.mx/dash/qry-items-aut');
  exception when others then
    v_err_items := 'descarga: ' || sqlerrm;
  end;

  if v_prov is not null then
    begin
      v_r_prov := public.fn_proveedores_desde_api(v_prov);
    exception when others then
      v_err_prov := 'proveedores: ' || sqlerrm;
    end;
  end if;
  if v_items is not null then
    begin
      v_r_items := public.fn_items_desde_api(v_items);
    exception when others then
      v_err_items := 'items: ' || sqlerrm;
    end;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'proveedores', v_r_prov, 'items', v_r_items,
    'error_proveedores', v_err_prov, 'error_items', v_err_items, 'en', now()));
end;
$$;

revoke all on function public.fn_proveedores_api_limpios(jsonb) from public, anon, authenticated;
revoke all on function public.fn_items_api_limpios(jsonb) from public, anon, authenticated;
revoke all on function public.fn_proveedores_desde_api(jsonb) from public, anon, authenticated;
revoke all on function public.fn_items_desde_api(jsonb) from public, anon, authenticated;
revoke all on function public.sincronizar_catalogos_backoffice() from public, anon, authenticated;
grant execute on function public.fn_proveedores_desde_api(jsonb) to service_role;
grant execute on function public.fn_items_desde_api(jsonb) to service_role;
grant execute on function public.sincronizar_catalogos_backoffice() to service_role;

-- Al final del cron horario (ya aplicado en producción).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.alter_job(jobid, command := 'set statement_timeout = ''10min''; select public.sincronizar_catalogo_oc_ov(); select public.fn_proyectos_desde_backoffice(); select public.fn_proveedores_importar_backoffice(); select public.fn_items_importar_backoffice(); select public.fn_clientes_importar_backoffice(); select public.sincronizar_catalogos_backoffice();')
    from cron.job where jobname = 'sync-catalogo-oc-ov-horario';
  end if;
end $$;
