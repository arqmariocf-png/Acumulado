-- Cumplimiento (18-oct-2026, Mario con la imagen del curso "Domina Claude para
-- responsables de cumplimiento": "ayúdame a implementar estos pasos en todos
-- mis procesos"). Los cinco pasos, cada uno con su pantalla en /cumplimiento:
--
--   1. Cambios normativos → cumplimiento_normas: la norma nueva (SAT, IMSS,
--      STPS, NOM…) con su fecha de entrada en vigor y las ACCIONES que la
--      vuelven trabajo (cumplimiento_acciones → tarjetas del tablero que se
--      elija: responsable, fecha, recordatorio y semáforo de tareas).
--   2. Revisar controles → cumplimiento_controles (catálogo por
--      organización) + cumplimiento_pruebas (cada revisión con su resultado,
--      población y excepciones). Los controles automáticos se prueban solos
--      contra los datos del sistema (fn_cumplimiento_ejecutar): pagos sin
--      comprobante, pagos sin OC autorizada, OC pagadas de más, estados de
--      cuenta atrasados, SAT sin descargar, e.firma por vencer, expedientes
--      incompletos, ex-empleados con acceso, documentos legales vencidos,
--      EPP vencido, herramienta sin regresar, inventario negativo,
--      comprobaciones de gasto sin revisar. Los manuales se registran con
--      resultado, comentario y evidencia.
--   3. Informe de incidencia → cumplimiento_incidencias (folio
--      INC-<empresa>-0001): qué pasó, impacto, qué se hizo, qué sigue y
--      cuándo se vuelve a informar; acciones correctivas → tarjetas.
--   4. Informe al comité → se arma en pantalla (una página) con lo de arriba.
--   5. Flujos de control → cada control tiene frecuencia (mensual o
--      trimestral); pg_cron corre el día 1 los automáticos del periodo que
--      cerró y la pantalla muestra lo que falta revisar y el histórico.
--
-- Operan: admin o permiso por persona 'legal' o 'cumplimiento'
-- (auth_opera_cumplimiento). Ven y registran incidencias: eso o dirección
-- (auth_ve_cumplimiento). Ya aplicado en producción.

alter table public.permisos_modulo drop constraint if exists permisos_modulo_modulo_check;
alter table public.permisos_modulo add constraint permisos_modulo_modulo_check check (modulo = any (array[
  'inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva', 'comedor', 'legal',
  'checador', 'contabilidad', 'tesoreria', 'punto_venta', 'compras', 'cotizador', 'herramienta', 'cumplimiento']));

create or replace function public.auth_opera_cumplimiento()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo and not p.espectador
      and (p.rol = 'admin'
           or exists (select 1 from public.permisos_modulo pm
                      where pm.profile_id = p.id and pm.modulo in ('legal', 'cumplimiento')))
  )
$$;

create or replace function public.auth_ve_cumplimiento()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_opera_cumplimiento()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo and not p.espectador and p.rol = 'direccion')
$$;

-- 1. Cambios normativos -----------------------------------------------------------
create table if not exists public.cumplimiento_normas (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  titulo text not null check (btrim(titulo) <> ''),
  autoridad text not null default 'otra'
    check (autoridad in ('sat', 'imss', 'infonavit', 'stps', 'semarnat', 'proteccion_civil', 'municipal', 'estatal', 'cliente', 'interna', 'otra')),
  referencia text,
  fecha_publicacion date,
  fecha_vigor date,
  resumen text,
  que_cambia text,
  areas text[] not null default '{}',
  empresas uuid[],
  estatus text not null default 'por_analizar'
    check (estatus in ('por_analizar', 'en_implementacion', 'cumplida', 'no_aplica')),
  responsable_id uuid references public.profiles (id) on delete set null,
  responsable_nombre text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cumplimiento_normas_grupo_idx on public.cumplimiento_normas (grupo_id, estatus);
create index if not exists cumplimiento_normas_responsable_idx on public.cumplimiento_normas (responsable_id);
create index if not exists cumplimiento_normas_created_by_idx on public.cumplimiento_normas (created_by);

-- 2. Controles y sus pruebas ------------------------------------------------------
create table if not exists public.cumplimiento_controles (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  clave text not null check (btrim(clave) <> ''),
  nombre text not null check (btrim(nombre) <> ''),
  objetivo text,
  como_se_prueba text,
  area text not null default 'otro'
    check (area in ('finanzas', 'tesoreria', 'contabilidad', 'compras', 'rh', 'legal', 'almacen', 'seguridad', 'sistemas', 'direccion', 'otro')),
  prueba text,
  frecuencia text not null default 'mensual' check (frecuencia in ('mensual', 'trimestral')),
  tolerancia_pct numeric(5,2) not null default 5 check (tolerancia_pct >= 0 and tolerancia_pct <= 100),
  norma_id uuid references public.cumplimiento_normas (id) on delete set null,
  responsable_id uuid references public.profiles (id) on delete set null,
  responsable_nombre text,
  activo boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grupo_id, clave)
);
create index if not exists cumplimiento_controles_norma_idx on public.cumplimiento_controles (norma_id);
create index if not exists cumplimiento_controles_responsable_idx on public.cumplimiento_controles (responsable_id);
create index if not exists cumplimiento_controles_created_by_idx on public.cumplimiento_controles (created_by);

create table if not exists public.cumplimiento_pruebas (
  id uuid primary key default gen_random_uuid(),
  control_id uuid not null references public.cumplimiento_controles (id) on delete cascade,
  grupo_id uuid not null references public.grupos (id),
  periodo text not null,
  desde date not null,
  hasta date not null,
  resultado text not null check (resultado in ('cumple', 'excepciones', 'no_cumple', 'no_aplica')),
  poblacion integer,
  excepciones integer,
  detalle jsonb not null default '[]',
  comentario text,
  evidencia text,
  automatica boolean not null default false,
  probado_por uuid references public.profiles (id) default auth.uid(),
  probado_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists cumplimiento_pruebas_control_idx on public.cumplimiento_pruebas (control_id, periodo, created_at desc);
create index if not exists cumplimiento_pruebas_grupo_idx on public.cumplimiento_pruebas (grupo_id, periodo);
create index if not exists cumplimiento_pruebas_probado_por_idx on public.cumplimiento_pruebas (probado_por);

-- 3. Incidencias ------------------------------------------------------------------
create table if not exists public.cumplimiento_incidencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  folio text,
  titulo text not null check (btrim(titulo) <> ''),
  detectada_el date not null default current_date,
  ocurrio_el date,
  severidad text not null default 'media' check (severidad in ('baja', 'media', 'alta', 'critica')),
  area text not null default 'otro'
    check (area in ('finanzas', 'tesoreria', 'contabilidad', 'compras', 'rh', 'legal', 'almacen', 'seguridad', 'sistemas', 'direccion', 'otro')),
  que_paso text,
  impacto text,
  monto_estimado numeric(14,2),
  personas_afectadas text,
  causa text,
  acciones_inmediatas text,
  acciones_correctivas text,
  proxima_actualizacion date,
  comunicado_a text,
  comunicado_en timestamptz,
  estatus text not null default 'abierta' check (estatus in ('abierta', 'contenida', 'cerrada')),
  cerrada_en date,
  control_id uuid references public.cumplimiento_controles (id) on delete set null,
  prueba_id uuid references public.cumplimiento_pruebas (id) on delete set null,
  norma_id uuid references public.cumplimiento_normas (id) on delete set null,
  responsable_id uuid references public.profiles (id) on delete set null,
  responsable_nombre text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_by_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio)
);
create index if not exists cumplimiento_incidencias_empresa_idx on public.cumplimiento_incidencias (empresa_id, estatus);
create index if not exists cumplimiento_incidencias_control_idx on public.cumplimiento_incidencias (control_id);
create index if not exists cumplimiento_incidencias_prueba_idx on public.cumplimiento_incidencias (prueba_id);
create index if not exists cumplimiento_incidencias_norma_idx on public.cumplimiento_incidencias (norma_id);
create index if not exists cumplimiento_incidencias_responsable_idx on public.cumplimiento_incidencias (responsable_id);
create index if not exists cumplimiento_incidencias_created_by_idx on public.cumplimiento_incidencias (created_by);

-- Acciones (de una norma o de una incidencia) que se vuelven tarjetas.
create table if not exists public.cumplimiento_acciones (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  norma_id uuid references public.cumplimiento_normas (id) on delete cascade,
  incidencia_id uuid references public.cumplimiento_incidencias (id) on delete cascade,
  texto text not null check (btrim(texto) <> ''),
  responsable_id uuid references public.profiles (id) on delete set null,
  responsable_nombre text,
  fecha date,
  tarjeta_id uuid references public.tarjetas (id) on delete set null,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (norma_id is not null or incidencia_id is not null)
);
create index if not exists cumplimiento_acciones_norma_idx on public.cumplimiento_acciones (norma_id);
create index if not exists cumplimiento_acciones_incidencia_idx on public.cumplimiento_acciones (incidencia_id);
create index if not exists cumplimiento_acciones_tarjeta_idx on public.cumplimiento_acciones (tarjeta_id);
create index if not exists cumplimiento_acciones_responsable_idx on public.cumplimiento_acciones (responsable_id);
create index if not exists cumplimiento_acciones_created_by_idx on public.cumplimiento_acciones (created_by);
create index if not exists cumplimiento_acciones_grupo_idx on public.cumplimiento_acciones (grupo_id);

-- Triggers: organización, nombres, folio, fechas -------------------------------------
create or replace function public.cumplimiento_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old_resp uuid;
begin
  if tg_table_name = 'cumplimiento_incidencias' then
    if tg_op = 'INSERT' then
      if nullif(btrim(new.folio), '') is null then
        new.folio := public.fn_siguiente_folio(new.empresa_id, 'INC');
      end if;
      select nullif(btrim(nombre), '') into new.created_by_nombre from public.profiles where id = new.created_by;
    end if;
    if new.estatus = 'cerrada' and new.cerrada_en is null then new.cerrada_en := current_date; end if;
    if new.estatus <> 'cerrada' then new.cerrada_en := null; end if;
  elsif tg_table_name <> 'cumplimiento_pruebas' and tg_op = 'INSERT' and new.grupo_id is null then
    new.grupo_id := public.auth_grupo_id();
  end if;
  if tg_table_name = 'cumplimiento_pruebas' then
    if new.grupo_id is null then
      select grupo_id into new.grupo_id from public.cumplimiento_controles where id = new.control_id;
    end if;
    if new.probado_por is not null then
      select nullif(btrim(nombre), '') into new.probado_por_nombre from public.profiles where id = new.probado_por;
    end if;
    return new;
  end if;
  v_old_resp := case when tg_op = 'UPDATE' then old.responsable_id end;
  if new.responsable_id is distinct from v_old_resp and new.responsable_id is not null then
    select nullif(btrim(nombre), '') into new.responsable_nombre from public.profiles where id = new.responsable_id;
  end if;
  if tg_table_name <> 'cumplimiento_acciones' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['cumplimiento_normas', 'cumplimiento_controles', 'cumplimiento_pruebas', 'cumplimiento_incidencias', 'cumplimiento_acciones'] loop
    execute format('drop trigger if exists cumplimiento_antes on public.%I', t);
    execute format('create trigger cumplimiento_antes before insert or update on public.%I for each row execute function public.cumplimiento_antes()', t);
  end loop;
end $$;

-- RLS ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cumplimiento_normas', 'cumplimiento_controles', 'cumplimiento_pruebas', 'cumplimiento_acciones', 'cumplimiento_incidencias'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists frontera_organizacion on public.%I', t);
    if t = 'cumplimiento_incidencias' then
      execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
        using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
        with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))$p$, t);
    else
      execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
        using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
        with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))$p$, t);
    end if;
    execute format('drop policy if exists espectador_sin_datos on public.%I', t);
    execute format($p$create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()))$p$, t);
    execute format('drop policy if exists director_general on public.%I', t);
    execute format($p$create policy director_general on public.%I for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()))$p$, t);
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using ((select public.auth_ve_cumplimiento()))$p$, t || '_ver', t);
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Escriben: normas, controles y acciones de norma los que operan; pruebas
-- manuales también; incidencias (y sus acciones) quien ve cumplimiento.
drop policy if exists cumplimiento_normas_opera on public.cumplimiento_normas;
create policy cumplimiento_normas_opera on public.cumplimiento_normas for all to authenticated
  using ((select public.auth_opera_cumplimiento())) with check ((select public.auth_opera_cumplimiento()));
drop policy if exists cumplimiento_controles_opera on public.cumplimiento_controles;
create policy cumplimiento_controles_opera on public.cumplimiento_controles for all to authenticated
  using ((select public.auth_opera_cumplimiento())) with check ((select public.auth_opera_cumplimiento()));
drop policy if exists cumplimiento_pruebas_opera on public.cumplimiento_pruebas;
create policy cumplimiento_pruebas_opera on public.cumplimiento_pruebas for insert to authenticated
  with check ((select public.auth_opera_cumplimiento()) and not automatica);
drop policy if exists cumplimiento_incidencias_escribe on public.cumplimiento_incidencias;
create policy cumplimiento_incidencias_escribe on public.cumplimiento_incidencias for all to authenticated
  using ((select public.auth_ve_cumplimiento())) with check ((select public.auth_ve_cumplimiento()));
drop policy if exists cumplimiento_acciones_escribe on public.cumplimiento_acciones;
create policy cumplimiento_acciones_escribe on public.cumplimiento_acciones for all to authenticated
  using ((select public.auth_opera_cumplimiento()) or (incidencia_id is not null and (select public.auth_ve_cumplimiento())))
  with check ((select public.auth_opera_cumplimiento()) or (incidencia_id is not null and (select public.auth_ve_cumplimiento())));

-- Acciones con su tarjeta: ¿ya está en la última columna de su tablero?
create or replace view public.v_cumplimiento_acciones with (security_invoker = true) as
select a.*, t.tablero_id, t.titulo as tarjeta_titulo, t.fecha_limite as tarjeta_fecha,
       coalesce(t.archivada, false) or t.eliminada_en is not null as tarjeta_cerrada,
       (c.orden = (select max(c2.orden) from public.tablero_columnas c2 where c2.tablero_id = t.tablero_id)) as terminada
from public.cumplimiento_acciones a
left join public.tarjetas t on t.id = a.tarjeta_id
left join public.tablero_columnas c on c.id = t.columna_id;
grant select on public.v_cumplimiento_acciones to authenticated;

-- 4. Periodos: '2026-10' (mensual) o '2026-T4' (trimestral) ----------------------
create or replace function public.fn_cumplimiento_rango(p_periodo text, out desde date, out hasta date)
language plpgsql immutable as $$
declare a int; n int;
begin
  if p_periodo ~ '^\d{4}-T[1-4]$' then
    a := substr(p_periodo, 1, 4)::int; n := substr(p_periodo, 7, 1)::int;
    desde := make_date(a, (n - 1) * 3 + 1, 1);
    hasta := (desde + interval '3 months' - interval '1 day')::date;
  elsif p_periodo ~ '^\d{4}-\d{2}$' then
    desde := (p_periodo || '-01')::date;
    hasta := (desde + interval '1 month' - interval '1 day')::date;
  else
    raise exception 'Periodo no válido: %', p_periodo;
  end if;
end;
$$;

create or replace function public.fn_cumplimiento_periodo(p_fecha date, p_frecuencia text)
returns text language sql immutable as $$
  select case when p_frecuencia = 'trimestral'
              then to_char(p_fecha, 'YYYY') || '-T' || extract(quarter from p_fecha)::int
              else to_char(p_fecha, 'YYYY-MM') end
$$;

-- 5. Pruebas automáticas ------------------------------------------------------------
-- Devuelve {poblacion, excepciones, muestra[]} de la organización p_grupo.
-- Solo la llaman fn_cumplimiento_probar (con guarda) y el cron.
create or replace function public.fn_cumplimiento_ejecutar(p_prueba text, p_grupo uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_pob int := 0;
  v_exc jsonb := '[]';
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_corte date := least(p_hasta, (now() at time zone 'America/Mexico_City')::date);
begin
  if p_prueba = 'pagos_con_comprobante' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', e.codigo, 'ref', coalesce(oc.id_orden, left(p.concepto, 40)),
             'detalle', p.beneficiario || ' · $' || to_char(p.monto, 'FM999,999,990.00') || ' · pagado ' || to_char(coalesce(p.pagado_en::date, p.fecha_programada), 'DD/MM/YYYY'))
             order by coalesce(p.pagado_en::date, p.fecha_programada)) filter (where p.comprobante_path is null), '[]')
      into v_pob, v_exc
      from public.pagos_programados p
      join public.empresas e on e.id = p.empresa_id and e.grupo_id = p_grupo
      left join public.ordenes_compra oc on oc.id = p.orden_compra_id
     where p.estatus = 'pagado' and coalesce(p.pagado_en::date, p.fecha_programada) between p_desde and p_hasta;

  elsif p_prueba = 'pagos_con_oc' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', x.codigo, 'ref', coalesce(x.id_orden, left(x.concepto, 40)),
             'detalle', x.motivo || ' · ' || x.beneficiario || ' · $' || to_char(x.monto, 'FM999,999,990.00'))
             order by x.fecha) filter (where x.motivo is not null), '[]')
      into v_pob, v_exc
      from (select e.codigo, oc.id_orden, p.concepto, p.beneficiario, p.monto,
                   coalesce(p.pagado_en::date, p.fecha_programada) as fecha,
                   case when p.orden_compra_id is null then 'Pago sin orden de compra'
                        when oc.rechazada_en is not null then 'La orden está cancelada o rechazada'
                        when oc.autorizada_en is null and (oc.fuente <> 'api' or oc.estatus_backoffice in ('Pendiente de Autorización', 'Cancelada'))
                          then 'La orden no estaba autorizada' end as motivo
              from public.pagos_programados p
              join public.empresas e on e.id = p.empresa_id and e.grupo_id = p_grupo
              left join public.ordenes_compra oc on oc.id = p.orden_compra_id
             where p.estatus = 'pagado' and coalesce(p.tipo, 'proveedor') = 'proveedor'
               and coalesce(p.pagado_en::date, p.fecha_programada) between p_desde and p_hasta) x;

  elsif p_prueba = 'oc_sin_sobrepago' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', x.codigo, 'ref', x.id_orden,
             'detalle', x.proveedor || ' · total $' || to_char(x.total, 'FM999,999,990.00') || ' · pagado $' || to_char(x.pagado, 'FM999,999,990.00'))
             order by x.pagado - x.total desc) filter (where x.pagado > x.total + 1), '[]')
      into v_pob, v_exc
      from (select e.codigo, oc.id_orden, oc.proveedor, oc.total, sum(p.monto) as pagado
              from public.pagos_programados p
              join public.ordenes_compra oc on oc.id = p.orden_compra_id
              join public.empresas e on e.id = oc.empresa_id and e.grupo_id = p_grupo
             where p.estatus = 'pagado'
             group by e.codigo, oc.id, oc.id_orden, oc.proveedor, oc.total
            having max(coalesce(p.pagado_en::date, p.fecha_programada)) between p_desde and p_hasta) x;

  elsif p_prueba = 'estados_cuenta_al_dia' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', x.codigo, 'ref', x.banco || ' ' || coalesce(x.ultimos_4, ''),
             'detalle', case when x.ultimo is null then 'Sin movimientos cargados'
                             else 'Último movimiento cargado ' || to_char(x.ultimo, 'DD/MM/YYYY') end)
             order by x.ultimo nulls first) filter (where x.ultimo is null or x.ultimo < v_corte - 10), '[]')
      into v_pob, v_exc
      from (select e.codigo, c.banco, c.ultimos_4,
                   (select max(m.fecha_pago) from public.movimientos m where m.cuenta_id = c.id) as ultimo
              from public.cuentas_bancarias c
              join public.empresas e on e.id = c.empresa_id and e.grupo_id = p_grupo and e.activo
             where c.activo) x;

  elsif p_prueba = 'cfdi_sat_al_dia' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', x.codigo, 'ref', x.nombre, 'detalle', x.motivo) order by x.codigo) filter (where x.motivo is not null), '[]')
      into v_pob, v_exc
      from (select e.codigo, e.nombre,
                   case when s.id is null then 'Sin e.firma cargada: no se descargan sus CFDI'
                        when s.ultimo_error is not null then 'El SAT responde: ' || left(s.ultimo_error, 120)
                        when s.ultima_descarga_en is null or s.ultima_descarga_en < now() - interval '3 days'
                          then 'Última descarga ' || coalesce(to_char(s.ultima_descarga_en at time zone 'America/Mexico_City', 'DD/MM/YYYY'), 'nunca') end as motivo
              from public.empresas e
              left join public.sat_efirmas s on s.empresa_id = e.id
             where e.grupo_id = p_grupo and e.activo and nullif(btrim(e.rfc), '') is not null) x;

  elsif p_prueba = 'efirma_vigente' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', e.codigo, 'ref', s.rfc,
             'detalle', case when s.vigente_hasta::date < v_hoy then 'Vencida el ' else 'Vence el ' end || to_char(s.vigente_hasta::date, 'DD/MM/YYYY'))
             order by s.vigente_hasta) filter (where s.vigente_hasta::date < v_hoy + 30), '[]')
      into v_pob, v_exc
      from public.sat_efirmas s
      join public.empresas e on e.id = s.empresa_id and e.grupo_id = p_grupo;

  elsif p_prueba = 'expedientes_rh_completos' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'ref', x.nombre, 'detalle', 'Falta: ' || x.faltan) order by x.nombre) filter (where x.faltan is not null), '[]')
      into v_pob, v_exc
      from (select pe.nombre,
                   (select string_agg(split_part(t.nombre, ' (', 1), ', ' order by t.orden)
                      from public.tipos_documento_personal t
                     where t.activo and t.aplica_a = 'todos' and (t.grupo_id = p_grupo or t.grupo_id is null)
                       and not exists (select 1 from public.documentos_personal d
                                        where d.personal_id = pe.id and d.tipo_documento_id = t.id)) as faltan
              from public.personal pe
             where pe.grupo_id = p_grupo and pe.activo) x;

  elsif p_prueba = 'accesos_bajas' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'ref', pe.nombre,
             'detalle', 'Baja ' || coalesce(to_char(pe.fecha_baja, 'DD/MM/YYYY'), 'sin fecha') || ' y su cuenta sigue activa')
             order by pe.fecha_baja) filter (where pr.activo), '[]')
      into v_pob, v_exc
      from public.personal pe
      join public.profiles pr on pr.id = pe.profile_id
     where pe.grupo_id = p_grupo and not pe.activo;

  elsif p_prueba = 'documentos_legales_vigentes' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', e.codigo, 'ref', d.nombre, 'detalle', 'Venció el ' || to_char(d.vence, 'DD/MM/YYYY'))
             order by d.vence) filter (where d.vence < v_hoy), '[]')
      into v_pob, v_exc
      from public.legal_empresa_documentos d
      join public.empresas e on e.id = d.empresa_id and e.grupo_id = p_grupo
     where d.vence is not null;

  elsif p_prueba = 'arrendamientos_vigentes' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', e.codigo, 'ref', coalesce(a.folio, a.contraparte),
             'detalle', a.contraparte || ' · terminó el ' || to_char(a.fin, 'DD/MM/YYYY') || ' sin renovar ni darse por terminado')
             order by a.fin) filter (where a.fin < v_hoy), '[]')
      into v_pob, v_exc
      from public.legal_arrendamientos a
      join public.empresas e on e.id = a.empresa_id and e.grupo_id = p_grupo
     where a.estatus = 'firmado';

  elsif p_prueba = 'epp_vigente' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', e.codigo, 'ref', coalesce(pe.nombre, a.folio),
             'detalle', l.descripcion || ' · venció el ' || to_char(l.vence_el, 'DD/MM/YYYY'))
             order by l.vence_el) filter (where l.vence_el < v_hoy), '[]')
      into v_pob, v_exc
      from public.epp_asignacion_lineas l
      join public.epp_asignaciones a on a.id = l.asignacion_id
      join public.empresas e on e.id = l.empresa_id and e.grupo_id = p_grupo
      left join public.personal pe on pe.id = a.personal_id
     where l.estado = 'entregado' and l.vence_el is not null;

  elsif p_prueba = 'herramienta_devuelta' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', e.codigo, 'ref', h.folio,
             'detalle', h.nombre || ' · ' || coalesce(h.responsable_nombre, 'sin responsable') || ' · debía regresar el ' || to_char(h.devolver_el, 'DD/MM/YYYY'))
             order by h.devolver_el) filter (where h.devolver_el < v_hoy), '[]')
      into v_pob, v_exc
      from public.herramientas h
      join public.empresas e on e.id = h.empresa_id and e.grupo_id = p_grupo
     where h.estado = 'asignada';

  elsif p_prueba = 'inventario_sin_negativos' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', e.codigo, 'ref', x.producto_nombre,
             'detalle', 'Existencia ' || x.existencia || ' ' || coalesce(x.unidad_medida, '') || ' en ' || coalesce(x.almacen_nombre, 'almacén'))
             order by x.existencia) filter (where x.existencia < 0), '[]')
      into v_pob, v_exc
      from public.existencias x
      join public.empresas e on e.id = x.empresa_id and e.grupo_id = p_grupo
     where x.existencia <> 0;

  elsif p_prueba = 'gastos_revisados' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
             'empresa', e.codigo, 'ref', left(g.concepto, 40),
             'detalle', '$' || to_char(g.monto, 'FM999,999,990.00') || ' · enviada el ' || to_char(g.created_at at time zone 'America/Mexico_City', 'DD/MM/YYYY') || ' y sin revisar')
             order by g.created_at) filter (where g.estatus = 'enviada' and g.created_at < now() - interval '7 days'), '[]')
      into v_pob, v_exc
      from public.comprobaciones_gasto g
      join public.empresas e on e.id = g.empresa_id and e.grupo_id = p_grupo
     where (g.created_at at time zone 'America/Mexico_City')::date between p_desde and p_hasta;

  else
    raise exception 'Prueba automática desconocida: %', p_prueba;
  end if;

  return jsonb_build_object(
    'poblacion', v_pob,
    'excepciones', jsonb_array_length(v_exc),
    'muestra', coalesce((select jsonb_agg(x) from (select x from jsonb_array_elements(v_exc) x limit 50) s), '[]'));
end;
$$;
revoke all on function public.fn_cumplimiento_ejecutar(text, uuid, date, date) from public, anon, authenticated;

-- Corre la prueba de un control y guarda el resultado.
create or replace function public.fn_cumplimiento_registrar_automatica(p_control uuid, p_periodo text, p_usuario uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.cumplimiento_controles;
  r record;
  v jsonb;
  v_pob int; v_exc int; v_res text; v_id uuid;
begin
  select * into c from public.cumplimiento_controles where id = p_control;
  if c.id is null or c.prueba is null then raise exception 'El control no tiene prueba automática.'; end if;
  select * into r from public.fn_cumplimiento_rango(p_periodo);
  v := public.fn_cumplimiento_ejecutar(c.prueba, c.grupo_id, r.desde, r.hasta);
  v_pob := (v->>'poblacion')::int;
  v_exc := (v->>'excepciones')::int;
  v_res := case when v_exc = 0 then 'cumple'
                when v_pob > 0 and v_exc * 100.0 / v_pob <= c.tolerancia_pct then 'excepciones'
                else 'no_cumple' end;
  insert into public.cumplimiento_pruebas (control_id, grupo_id, periodo, desde, hasta, resultado, poblacion, excepciones, detalle, automatica, probado_por)
  values (c.id, c.grupo_id, p_periodo, r.desde, r.hasta, v_res, v_pob, v_exc, v->'muestra', true, p_usuario)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.fn_cumplimiento_registrar_automatica(uuid, text, uuid) from public, anon, authenticated;

-- "Probar ahora" desde la pantalla (periodo en curso o el que se elija).
create or replace function public.fn_cumplimiento_probar(p_control uuid, p_periodo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.cumplimiento_controles;
begin
  if not public.auth_ve_cumplimiento() then raise exception 'Sin permiso para revisar controles.'; end if;
  select * into c from public.cumplimiento_controles where id = p_control;
  if c.id is null or not (c.grupo_id = any (public.auth_grupos_alcance())) then raise exception 'Control no encontrado.'; end if;
  return public.fn_cumplimiento_registrar_automatica(
    c.id,
    coalesce(nullif(btrim(p_periodo), ''), public.fn_cumplimiento_periodo((now() at time zone 'America/Mexico_City')::date, c.frecuencia)),
    auth.uid());
end;
$$;
grant execute on function public.fn_cumplimiento_probar(uuid, text) to authenticated;

-- Flujo de control: el día 1 corre los automáticos del periodo que cerró
-- (mensuales cada mes; trimestrales al cerrar marzo, junio, septiembre y
-- diciembre), una vez por control y periodo.
create or replace function public.fn_cumplimiento_cierre_periodo()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_ayer date := (now() at time zone 'America/Mexico_City')::date - 1;
  c record;
  v_periodo text;
  n int := 0;
begin
  for c in select * from public.cumplimiento_controles where activo and prueba is not null loop
    if c.frecuencia = 'trimestral' and extract(month from v_ayer)::int % 3 <> 0 then continue; end if;
    v_periodo := public.fn_cumplimiento_periodo(v_ayer, c.frecuencia);
    if exists (select 1 from public.cumplimiento_pruebas p
                where p.control_id = c.id and p.periodo = v_periodo and p.automatica and p.created_at::date > v_ayer - 1) then
      continue;
    end if;
    begin
      perform public.fn_cumplimiento_registrar_automatica(c.id, v_periodo, null);
      n := n + 1;
    exception when others then
      raise warning 'Control % (%): %', c.clave, c.prueba, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;
revoke all on function public.fn_cumplimiento_cierre_periodo() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cumplimiento-cierre-periodo', '30 13 1 * *',
      $c$set statement_timeout = '10min'; select public.fn_cumplimiento_cierre_periodo();$c$);
  end if;
end $$;

-- 6. Catálogo inicial de controles (organización maestra) ------------------------
insert into public.cumplimiento_controles (grupo_id, clave, nombre, objetivo, como_se_prueba, area, prueba, frecuencia, created_by)
select g.id, v.clave, v.nombre, v.objetivo, v.como, v.area, v.prueba, v.frecuencia, null
from public.grupos g
cross join (values
  ('PAG-01', 'Todo pago lleva su comprobante', 'Que cada salida de dinero tenga evidencia del banco.', 'Pagos marcados como pagados en el periodo sin comprobante subido.', 'tesoreria', 'pagos_con_comprobante', 'mensual'),
  ('PAG-02', 'Todo pago a proveedor sale de una orden autorizada', 'Que no se pague nada que dirección no autorizó.', 'Pagos a proveedor del periodo sin orden de compra, con la orden cancelada o sin autorizar.', 'finanzas', 'pagos_con_oc', 'mensual'),
  ('PAG-03', 'Ninguna orden se paga de más', 'Evitar pagos duplicados o por encima del total.', 'Órdenes cuyo total pagado rebasa el total de la orden.', 'finanzas', 'oc_sin_sobrepago', 'mensual'),
  ('CON-01', 'Estados de cuenta al día', 'Que los saldos de banco que ve dirección sean reales.', 'Cuentas activas cuyo último movimiento cargado tiene más de 10 días.', 'contabilidad', 'estados_cuenta_al_dia', 'mensual'),
  ('CON-02', 'CFDI del SAT descargándose', 'Que toda factura emitida y recibida esté en el sistema.', 'Empresas con RFC sin e.firma, con error del SAT o sin descarga en 3 días.', 'contabilidad', 'cfdi_sat_al_dia', 'mensual'),
  ('CON-03', 'e.firma vigente', 'Que ninguna empresa se quede sin poder facturar o descargar.', 'e.firmas vencidas o que vencen en menos de 30 días.', 'contabilidad', 'efirma_vigente', 'trimestral'),
  ('RH-01', 'Expediente de personal completo', 'Que cada trabajador activo tenga su documentación obligatoria.', 'Personal activo al que le falta algún documento obligatorio.', 'rh', 'expedientes_rh_completos', 'trimestral'),
  ('SIS-01', 'Quien sale de la empresa ya no entra al sistema', 'Cerrar accesos el mismo día de la baja.', 'Personal dado de baja cuya cuenta sigue activa.', 'sistemas', 'accesos_bajas', 'mensual'),
  ('LEG-01', 'Documentos legales vigentes', 'Que actas, poderes, licencias y permisos estén al día.', 'Documentos del expediente legal de cada empresa ya vencidos.', 'legal', 'documentos_legales_vigentes', 'trimestral'),
  ('LEG-02', 'Arrendamientos vigentes', 'Que ningún inmueble se ocupe sin contrato vigente.', 'Contratos firmados cuyo plazo ya terminó sin renovar ni cerrar.', 'legal', 'arrendamientos_vigentes', 'trimestral'),
  ('SEG-01', 'Equipo de protección vigente', 'Que nadie trabaje con EPP vencido (NOM-017-STPS).', 'Piezas de EPP entregadas cuya vigencia ya pasó.', 'seguridad', 'epp_vigente', 'mensual'),
  ('ALM-01', 'La herramienta regresa a tiempo', 'Cuidar el activo del almacén.', 'Herramienta asignada con fecha de regreso vencida.', 'almacen', 'herramienta_devuelta', 'mensual'),
  ('ALM-02', 'Inventario sin existencias negativas', 'Que las existencias reflejen lo que hay físicamente.', 'Productos con existencia menor a cero.', 'almacen', 'inventario_sin_negativos', 'mensual'),
  ('FIN-01', 'Comprobaciones de gasto revisadas en 7 días', 'Que el gasto de obra se revise a tiempo.', 'Comprobaciones del periodo enviadas hace más de 7 días sin revisar.', 'finanzas', 'gastos_revisados', 'mensual')
) as v(clave, nombre, objetivo, como, area, prueba, frecuencia)
where g.codigo = 'LOMA'
on conflict (grupo_id, clave) do nothing;
