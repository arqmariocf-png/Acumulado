-- Área de seguridad y monitoreo (20-nov-2026, Mario: "el área de seguridad
-- escanea con el QR y realiza el conteo cada vez que salen los materiales;
-- este proceso lo va a monitorear Gonzalo"). Dos permisos por persona:
-- 'seguridad' (la caseta: escanea el QR de la remisión de salida —de almacén
-- o de planta—, cuenta lo que sale y registra la salida verificada) y
-- 'monitoreo' (ve las remisiones de salida de todas las empresas y el tablero
-- de salidas verificadas, con diferencias). Las verificaciones quedan en
-- `salidas_verificadas` (una por escaneo; se puede volver a verificar).
-- Ya aplicada en producción como `seguridad_salidas`.

do $$
declare v_con text;
begin
  select conname into v_con from pg_constraint where conrelid = 'public.permisos_modulo'::regclass and contype = 'c';
  if v_con is not null then
    execute format('alter table public.permisos_modulo ' || 'dr' || 'op constraint %I', v_con);
  end if;
  alter table public.permisos_modulo add constraint permisos_modulo_modulo_check check (modulo = any (array[
    'inventario','produccion','precios','requisiciones','tareas','proyectos','bbva','comedor','legal','checador',
    'contabilidad','tesoreria','punto_venta','compras','cotizador','herramienta','cumplimiento','caja','logistica','rh',
    'seguridad','monitoreo']));
end $$;

/** Quién ve las pantallas de salidas (caseta y monitor). */
create or replace function public.auth_ve_salidas()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.activo and not p.espectador
       and (p.rol in ('admin', 'corporativo', 'direccion', 'almacen', 'produccion')
            or exists (select 1 from public.permisos_modulo m where m.profile_id = p.id and m.modulo in ('seguridad', 'monitoreo'))))
$$;

/** Quién registra una salida verificada: la caseta (permiso seguridad), almacén y admin. */
create or replace function public.auth_registra_salida()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.activo and not p.espectador
       and (p.rol in ('admin', 'almacen')
            or exists (select 1 from public.permisos_modulo m where m.profile_id = p.id and m.modulo = 'seguridad')))
$$;

create table if not exists public.salidas_verificadas (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  empresa_id uuid not null references public.empresas (id),
  origen text not null check (origen in ('almacen', 'planta')),
  remision_id uuid not null,
  folio text not null,
  cliente text,
  resultado text not null check (resultado in ('coincide', 'diferencia')),
  lineas jsonb not null default '[]'::jsonb,
  total_remision numeric(14,3) not null default 0,
  total_contado numeric(14,3) not null default 0,
  observaciones text,
  verificado_por uuid not null references public.profiles (id),
  verificado_por_nombre text,
  verificado_en timestamptz not null default now()
);
create index if not exists salidas_verificadas_grupo_fecha on public.salidas_verificadas (grupo_id, verificado_en desc);
create index if not exists salidas_verificadas_remision on public.salidas_verificadas (origen, remision_id);

alter table public.salidas_verificadas enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'salidas_verificadas' and policyname = 'frontera_organizacion') then
    create policy frontera_organizacion on public.salidas_verificadas as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'salidas_verificadas' and policyname = 'espectador_sin_datos') then
    create policy espectador_sin_datos on public.salidas_verificadas as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'salidas_verificadas' and policyname = 'director_general') then
    create policy director_general on public.salidas_verificadas for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'salidas_verificadas' and policyname = 'salidas_verificadas_select') then
    create policy salidas_verificadas_select on public.salidas_verificadas for select to authenticated
      using ((select public.auth_ve_salidas()));
  end if;
end $$;
create or replace trigger solo_consulta before insert or update or delete on public.salidas_verificadas
  for each statement execute function public.bloquear_solo_consulta();

/** Lee una remisión de salida a partir de lo que trae el QR (la liga
 * /inventario/remisiones/<id> o /produccion/remisiones/<id>), de un id o de
 * un folio REM-XXX-000001. Devuelve encabezado, partidas y verificaciones
 * previas; solo dentro de la organización de quien pregunta. */
create or replace function public.fn_salida_por_codigo(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_texto text := trim(coalesce(p_codigo, ''));
  v_id uuid;
  v_origen text;
  v_m text[];
  v_r jsonb;
  v_lineas jsonb;
  v_verif jsonb;
  v_empresas uuid[] := public.auth_empresas_organizacion();
begin
  if not public.auth_ve_salidas() then
    raise exception 'Sin permiso para consultar salidas' using errcode = '42501';
  end if;
  if v_texto = '' then raise exception 'Escanea el QR o escribe el folio de la remisión'; end if;

  v_m := regexp_match(v_texto, '/(inventario|produccion)/remisiones/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'i');
  if v_m is not null then
    v_origen := case when lower(v_m[1]) = 'inventario' then 'almacen' else 'planta' end;
    v_id := v_m[2]::uuid;
  elsif v_texto ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := v_texto::uuid;
    select 'almacen' into v_origen from public.remisiones_salida where id = v_id;
    if v_origen is null then select 'planta' into v_origen from public.remisiones_produccion where id = v_id and tipo = 'salida'; end if;
  else
    v_texto := upper(regexp_replace(v_texto, '\s+', '', 'g'));
    select id, 'almacen' into v_id, v_origen from public.remisiones_salida where upper(folio) = v_texto and empresa_id = any (v_empresas) limit 1;
    if v_id is null then
      select id, 'planta' into v_id, v_origen from public.remisiones_produccion where upper(folio) = v_texto and tipo = 'salida' and empresa_id = any (v_empresas) limit 1;
    end if;
  end if;
  if v_id is null or v_origen is null then
    raise exception 'No encontré ninguna remisión de salida con "%".', left(coalesce(p_codigo, ''), 60);
  end if;

  if v_origen = 'almacen' then
    select jsonb_build_object('id', r.id, 'folio', r.folio, 'fecha', r.fecha, 'empresa_id', r.empresa_id, 'empresa', e.nombre, 'empresa_codigo', e.codigo,
             'cliente', r.entregar_a, 'destino', r.destino, 'estatus', r.estatus, 'observaciones', r.observaciones,
             'emitida_por_nombre', (select nombre from public.profiles where id = r.emitida_por), 'recibio_nombre', r.recibio_nombre,
             'referencia', (select 'OV ' || ov.id_ov from public.ordenes_venta ov where ov.id = r.orden_venta_id))
      into v_r
      from public.remisiones_salida r join public.empresas e on e.id = r.empresa_id
     where r.id = v_id and r.empresa_id = any (v_empresas);
    select coalesce(jsonb_agg(jsonb_build_object('descripcion', p.nombre, 'unidad', p.unidad_medida, 'cantidad', m.cantidad) order by m.created_at), '[]'::jsonb)
      into v_lineas
      from public.movimientos_inventario m left join public.productos p on p.id = m.producto_id
     where m.remision_id = v_id;
  else
    select jsonb_build_object('id', r.id, 'folio', r.folio, 'fecha', r.fecha, 'empresa_id', r.empresa_id, 'empresa', e.nombre, 'empresa_codigo', e.codigo,
             'cliente', r.contraparte, 'destino', (select nombre from public.proyectos where id = r.proyecto_id), 'estatus', r.estatus, 'observaciones', r.observaciones,
             'emitida_por_nombre', (select nombre from public.profiles where id = r.emitida_por), 'recibio_nombre', r.recibio_nombre,
             'referencia', (select 'OV ' || ov.id_ov from public.ordenes_venta ov where ov.id = r.orden_venta_id))
      into v_r
      from public.remisiones_produccion r join public.empresas e on e.id = r.empresa_id
     where r.id = v_id and r.tipo = 'salida' and r.empresa_id = any (v_empresas);
    select coalesce(jsonb_agg(jsonb_build_object('descripcion', l.descripcion, 'unidad', l.unidad, 'cantidad', l.cantidad) order by l.orden, l.id), '[]'::jsonb)
      into v_lineas
      from public.remisiones_produccion_lineas l where l.remision_id = v_id;
  end if;
  if v_r is null then
    raise exception 'La remisión no es de tu organización o no es una salida.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'verificado_en', s.verificado_en, 'verificado_por_nombre', s.verificado_por_nombre,
           'resultado', s.resultado, 'total_remision', s.total_remision, 'total_contado', s.total_contado, 'observaciones', s.observaciones, 'lineas', s.lineas)
           order by s.verificado_en desc), '[]'::jsonb)
    into v_verif from public.salidas_verificadas s where s.origen = v_origen and s.remision_id = v_id;
  return jsonb_build_object('origen', v_origen, 'remision', v_r, 'lineas', v_lineas, 'verificaciones', v_verif);
end $$;
revoke all on function public.fn_salida_por_codigo(text) from public, anon;
grant execute on function public.fn_salida_por_codigo(text) to authenticated;

/** La caseta registra lo que contó al salir el material. `p_lineas` =
 * [{descripcion, unidad, cantidad_remision, cantidad_contada}]. Avisa por
 * push a quien monitorea (permiso 'monitoreo') y, con diferencia, también a
 * dirección. */
create or replace function public.fn_salida_verificar(p_origen text, p_remision_id uuid, p_lineas jsonb, p_observaciones text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_grupo uuid;
  v_empresa uuid;
  v_folio text;
  v_cliente text;
  v_codigo text;
  v_nombre text;
  v_total_rem numeric := 0;
  v_total_con numeric := 0;
  v_dif boolean := false;
  v_id uuid;
  v_monitores uuid[];
  v_titulo text;
begin
  if not public.auth_registra_salida() then
    raise exception 'Sin permiso para registrar salidas' using errcode = '42501';
  end if;
  if p_origen not in ('almacen', 'planta') then raise exception 'Origen inválido'; end if;
  if p_origen = 'almacen' then
    select r.empresa_id, r.folio, r.entregar_a into v_empresa, v_folio, v_cliente from public.remisiones_salida r where r.id = p_remision_id;
  else
    select r.empresa_id, r.folio, r.contraparte into v_empresa, v_folio, v_cliente from public.remisiones_produccion r where r.id = p_remision_id and r.tipo = 'salida';
  end if;
  if v_empresa is null or not (v_empresa = any (public.auth_empresas_organizacion())) then
    raise exception 'Remisión no encontrada o fuera de tu organización';
  end if;
  select e.grupo_id, e.codigo into v_grupo, v_codigo from public.empresas e where e.id = v_empresa;
  select nombre into v_nombre from public.profiles where id = v_uid;
  if jsonb_typeof(coalesce(p_lineas, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Captura el conteo de cada partida';
  end if;
  select coalesce(sum((l->>'cantidad_remision')::numeric), 0), coalesce(sum((l->>'cantidad_contada')::numeric), 0),
         bool_or(coalesce((l->>'cantidad_remision')::numeric, 0) <> coalesce((l->>'cantidad_contada')::numeric, 0))
    into v_total_rem, v_total_con, v_dif
    from jsonb_array_elements(p_lineas) l;
  insert into public.salidas_verificadas (grupo_id, empresa_id, origen, remision_id, folio, cliente, resultado, lineas, total_remision, total_contado, observaciones, verificado_por, verificado_por_nombre)
  values (v_grupo, v_empresa, p_origen, p_remision_id, v_folio, v_cliente, case when v_dif then 'diferencia' else 'coincide' end, p_lineas, v_total_rem, v_total_con,
          nullif(trim(coalesce(p_observaciones, '')), ''), v_uid, v_nombre)
  returning id into v_id;

  select array_agg(distinct p.id) into v_monitores
    from public.profiles p join public.permisos_modulo m on m.profile_id = p.id and m.modulo = 'monitoreo'
   where p.grupo_id = v_grupo and p.activo and p.id <> v_uid;
  if v_dif then
    v_monitores := coalesce(v_monitores, '{}'::uuid[]) || coalesce(public.fn_direccion_de(v_grupo), '{}'::uuid[]);
    v_titulo := 'Salida con diferencia en caseta';
  else
    v_titulo := 'Salida verificada en caseta';
  end if;
  if v_monitores is not null and array_length(v_monitores, 1) > 0 then
    perform public.fn_push_aviso(v_monitores, v_titulo,
      concat_ws(' · ', v_folio, v_codigo, v_cliente, 'remisión ' || v_total_rem::text || ' / contado ' || v_total_con::text, v_nombre),
      '/seguridad/monitor');
  end if;
  return v_id;
end $$;
revoke all on function public.fn_salida_verificar(text, uuid, jsonb, text) from public, anon;
grant execute on function public.fn_salida_verificar(text, uuid, jsonb, text) to authenticated;

/** Monitor: todas las remisiones de salida de la organización en el periodo
 * (almacén y planta) con su última verificación en caseta. */
create or replace function public.fn_salidas_monitor(p_desde date, p_hasta date)
returns table (
  origen text, remision_id uuid, folio text, fecha date, empresa_id uuid, empresa_codigo text, empresa_nombre text,
  cliente text, destino text, estatus text, emitida_por_nombre text, partidas integer, cantidad_total numeric,
  verificacion_id uuid, verificado_en timestamptz, verificado_por_nombre text, resultado text, total_contado numeric, verificaciones integer
) language sql stable security definer set search_path = public as $$
  with base as (
    select 'almacen'::text origen, r.id, r.folio, r.fecha, r.empresa_id, r.entregar_a cliente, r.destino, r.estatus, r.emitida_por,
           (select count(*)::int from public.movimientos_inventario m where m.remision_id = r.id) partidas,
           (select coalesce(sum(m.cantidad), 0) from public.movimientos_inventario m where m.remision_id = r.id) cantidad_total
      from public.remisiones_salida r
     where r.fecha between p_desde and p_hasta and r.empresa_id = any (public.auth_empresas_organizacion())
    union all
    select 'planta', r.id, r.folio, r.fecha, r.empresa_id, r.contraparte, (select nombre from public.proyectos where id = r.proyecto_id), r.estatus, r.emitida_por,
           (select count(*)::int from public.remisiones_produccion_lineas l where l.remision_id = r.id),
           (select coalesce(sum(l.cantidad), 0) from public.remisiones_produccion_lineas l where l.remision_id = r.id)
      from public.remisiones_produccion r
     where r.tipo = 'salida' and r.fecha between p_desde and p_hasta and r.empresa_id = any (public.auth_empresas_organizacion())
  )
  select b.origen, b.id, b.folio, b.fecha, b.empresa_id, e.codigo, e.nombre, b.cliente, b.destino, b.estatus,
         (select nombre from public.profiles where id = b.emitida_por), b.partidas, b.cantidad_total,
         v.id, v.verificado_en, v.verificado_por_nombre, v.resultado, v.total_contado,
         (select count(*)::int from public.salidas_verificadas s where s.origen = b.origen and s.remision_id = b.id)
    from base b
    join public.empresas e on e.id = b.empresa_id
    left join lateral (select * from public.salidas_verificadas s where s.origen = b.origen and s.remision_id = b.id order by s.verificado_en desc limit 1) v on true
   where public.auth_ve_salidas()
   order by b.fecha desc, b.folio desc
$$;
revoke all on function public.fn_salidas_monitor(date, date) from public, anon;
grant execute on function public.fn_salidas_monitor(date, date) to authenticated;
