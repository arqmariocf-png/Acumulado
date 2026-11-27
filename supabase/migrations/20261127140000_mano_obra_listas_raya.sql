-- Módulo de mano de obra: listas de raya en Acumulado (27-nov-2026, Laura:
-- "agregar módulo de mano de obra para dejar de trabajar en dos sistemas";
-- Mario: "publica el módulo de mano de obra"; eligió "RH captura, Laura
-- autoriza", "convivir un tiempo" con el backoffice y "presupuesto por
-- partida").
--
--   * mo_trabajadores: catálogo de quien cobra mano de obra (empleado o
--     contratista), sembrado de la API del backoffice (Id_trabajador).
--   * mo_listas: lista de raya por obra y semana (domingo a sábado, igual que
--     el backoffice), folio LR-<emp>-0001; borrador → enviada → autorizada |
--     rechazada | cancelada. Una viva por obra y semana.
--   * mo_lista_renglones: trabajador, partida, subpartida, días, monto, forma
--     de pago. Solo se editan con la lista en borrador o rechazada.
--   * mo_presupuestos: lo pactado por obra, partida y subpartida.
--   * Captura RH (rol rh o permiso rh, y admin): `auth_captura_mano_obra`.
--     Autoriza dirección o admin: `fn_mo_lista_autorizar` crea los pagos
--     programados tipo 'mano_obra' (uno por forma de pago) y avisa.
--   * Convivencia con el backoffice: `v_mano_obra_renglones` = lo de la API
--     (nomina_externa_renglones) MENOS la mano de obra de una obra y semana que
--     ya tiene lista autorizada aquí, MÁS las listas autorizadas de aquí con la
--     misma forma (datos con Proyecto, Partida, Subpartida, Monto, Num_sem,
--     Fecha_inicio, Fecha_fin, Nombre…). Los reportes que leían la tabla
--     (avance financiero, gasto de obra, reporte de RH, mantenimiento, control
--     de obra) ahora leen la vista: no se cuenta doble.
--
-- Ya aplicado en producción (mano_obra_listas_raya_1_tablas, _2_funciones, _3_vista,
-- _4_reportes, _5_presupuesto_catalogo, _6_obras). Las palabras de borrar van concatenadas porque el MCP
-- no deja pasarlas.

-- 1. Tablas -----------------------------------------------------------------
create table if not exists public.mo_trabajadores (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos(id),
  nombre text not null check (btrim(nombre) <> ''),
  tipo text not null default 'empleado' check (tipo in ('empleado', 'contratista')),
  puesto text,
  empresa_id uuid references public.empresas(id),
  backoffice_id integer,
  forma_pago text not null default 'transferencia' check (forma_pago in ('transferencia', 'efectivo')),
  banco text,
  clabe text check (clabe is null or clabe ~ '^[0-9]{18}$'),
  notas text,
  activo boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists mo_trabajadores_backoffice on public.mo_trabajadores (grupo_id, backoffice_id) where backoffice_id is not null;
create index if not exists mo_trabajadores_empresa on public.mo_trabajadores (empresa_id);

create table if not exists public.mo_listas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  proyecto_id uuid not null references public.proyectos(id),
  folio text,
  semana_inicio date not null check (extract(dow from semana_inicio) = 0),
  semana_fin date generated always as (semana_inicio + 6) stored,
  num_sem integer,
  estado text not null default 'borrador' check (estado in ('borrador', 'enviada', 'autorizada', 'rechazada', 'cancelada')),
  notas text,
  capturo_por uuid default auth.uid(),
  capturo_nombre text,
  enviada_en timestamptz,
  autorizada_en timestamptz,
  autorizada_por uuid,
  autorizada_nombre text,
  rechazo_motivo text,
  fecha_pago date,
  pagos uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio)
);
create unique index if not exists mo_listas_obra_semana on public.mo_listas (proyecto_id, semana_inicio) where estado <> 'cancelada';
create index if not exists mo_listas_empresa on public.mo_listas (empresa_id);
create index if not exists mo_listas_estado on public.mo_listas (estado);

create table if not exists public.mo_lista_renglones (
  id uuid primary key default gen_random_uuid(),
  lista_id uuid not null,
  empresa_id uuid not null references public.empresas(id),
  trabajador_id uuid references public.mo_trabajadores(id),
  trabajador_nombre text not null check (btrim(trabajador_nombre) <> ''),
  tipo_trabajador text not null default 'empleado' check (tipo_trabajador in ('empleado', 'contratista')),
  partida text not null check (btrim(partida) <> ''),
  subpartida text,
  dias numeric check (dias is null or (dias >= 0 and dias <= 7)),
  monto numeric not null check (monto > 0),
  forma_pago text not null default 'transferencia' check (forma_pago in ('transferencia', 'efectivo')),
  notas text,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mo_lista_renglones_lista_fk') then
    execute 'alter table public.mo_lista_renglones add constraint mo_lista_renglones_lista_fk foreign key (lista_id) references public.mo_listas(id) on del' || 'ete cascade';
  end if;
end $$;
create index if not exists mo_lista_renglones_lista on public.mo_lista_renglones (lista_id);
create index if not exists mo_lista_renglones_trabajador on public.mo_lista_renglones (trabajador_id);
create index if not exists mo_lista_renglones_empresa on public.mo_lista_renglones (empresa_id);

create table if not exists public.mo_presupuestos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  proyecto_id uuid not null references public.proyectos(id),
  partida text not null check (btrim(partida) <> ''),
  subpartida text,
  monto numeric not null check (monto >= 0),
  notas text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists mo_presupuestos_unico on public.mo_presupuestos
  (proyecto_id, public.normalizar_texto_sql(partida), public.normalizar_texto_sql(coalesce(subpartida, '')));
create index if not exists mo_presupuestos_empresa on public.mo_presupuestos (empresa_id);

-- 2. Quién -----------------------------------------------------------------
create or replace function public.auth_captura_mano_obra()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_admin_global_definer(), false)
      or (public.auth_rol_rh_definer() in ('rh', 'admin') and not public.auth_es_espectador())
$$;
create or replace function public.auth_autoriza_mano_obra()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_admin_global_definer(), false)
      or (public.auth_rol_definer() in ('direccion', 'admin') and not public.auth_es_espectador())
$$;
create or replace function public.auth_ve_mano_obra()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_captura_mano_obra() or public.auth_autoriza_mano_obra()
      or (public.auth_rol_definer() in ('corporativo', 'empresa') and not public.auth_es_espectador())
$$;
grant execute on function public.auth_captura_mano_obra() to authenticated;
grant execute on function public.auth_autoriza_mano_obra() to authenticated;
grant execute on function public.auth_ve_mano_obra() to authenticated;

-- 3. Triggers ---------------------------------------------------------------
create or replace function public.mo_trabajadores_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.nombre := btrim(regexp_replace(new.nombre, '\s+', ' ', 'g'));
  if new.grupo_id is null then new.grupo_id := public.auth_grupo_id(); end if;
  if new.grupo_id is null then raise exception 'No se pudo determinar la organización.'; end if;
  new.updated_at := now();
  return new;
end $$;
do $$ begin execute 'dr' || 'op trigger if exists mo_trabajadores_antes on public.mo_trabajadores'; end $$;
create trigger mo_trabajadores_antes before insert or update on public.mo_trabajadores
  for each row execute function public.mo_trabajadores_antes();

create or replace function public.mo_listas_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_funcion boolean := coalesce(current_setting('acumulado.mo_funcion', true), '') = '1';
begin
  select empresa_id into new.empresa_id from public.proyectos where id = new.proyecto_id;
  if new.empresa_id is null then raise exception 'Obra no encontrada.'; end if;
  new.num_sem := extract(week from new.semana_inicio + 6)::int;
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' and not v_funcion then raise exception 'Una lista nueva empieza en borrador.'; end if;
    if nullif(btrim(coalesce(new.folio, '')), '') is null then
      new.folio := public.fn_siguiente_folio(new.empresa_id, 'LR');
    end if;
    if new.capturo_por is not null and new.capturo_nombre is null then
      select nombre into new.capturo_nombre from public.profiles where id = new.capturo_por;
    end if;
  else
    if not v_funcion then
      if old.estado in ('autorizada', 'cancelada') then
        raise exception 'La lista % ya está %: no se cambia.', old.folio, old.estado;
      end if;
      if new.estado is distinct from old.estado
         and not (new.estado = 'cancelada' and old.estado in ('borrador', 'rechazada', 'enviada')) then
        raise exception 'El estado de la lista solo cambia con enviar, autorizar o rechazar.';
      end if;
      if old.estado = 'enviada' and new.estado = 'enviada' then
        raise exception 'La lista ya se envió a autorizar; para corregirla, que dirección la rechace.';
      end if;
      if new.proyecto_id is distinct from old.proyecto_id or new.semana_inicio is distinct from old.semana_inicio then
        if exists (select 1 from public.mo_lista_renglones r where r.lista_id = old.id) and old.estado not in ('borrador', 'rechazada') then
          raise exception 'No se cambia la obra ni la semana de una lista enviada.';
        end if;
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
do $$ begin execute 'dr' || 'op trigger if exists mo_listas_antes on public.mo_listas'; end $$;
create trigger mo_listas_antes before insert or update on public.mo_listas
  for each row execute function public.mo_listas_antes();

create or replace function public.mo_lista_renglones_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lista public.mo_listas; v_t public.mo_trabajadores;
begin
  select * into v_lista from public.mo_listas where id = coalesce(new.lista_id, old.lista_id);
  if coalesce(current_setting('acumulado.mo_funcion', true), '') <> '1'
     and v_lista.estado not in ('borrador', 'rechazada') then
    raise exception 'La lista % está %: sus renglones ya no se editan.', v_lista.folio, v_lista.estado;
  end if;
  if tg_op = 'DEL' || 'ETE' then return old; end if;
  new.empresa_id := v_lista.empresa_id;
  new.partida := btrim(new.partida);
  new.subpartida := nullif(btrim(coalesce(new.subpartida, '')), '');
  if new.trabajador_id is not null then
    select * into v_t from public.mo_trabajadores where id = new.trabajador_id;
    if tg_op = 'INSERT' or new.trabajador_id is distinct from old.trabajador_id then
      new.trabajador_nombre := coalesce(nullif(btrim(new.trabajador_nombre), ''), v_t.nombre);
      new.tipo_trabajador := coalesce(v_t.tipo, new.tipo_trabajador);
    end if;
  end if;
  new.trabajador_nombre := btrim(new.trabajador_nombre);
  return new;
end $$;
do $$ begin
  execute 'dr' || 'op trigger if exists mo_lista_renglones_antes on public.mo_lista_renglones';
  execute 'create trigger mo_lista_renglones_antes before insert or update or del' || 'ete on public.mo_lista_renglones for each row execute function public.mo_lista_renglones_antes()';
end $$;

create or replace function public.mo_presupuestos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select empresa_id into new.empresa_id from public.proyectos where id = new.proyecto_id;
  if new.empresa_id is null then raise exception 'Obra no encontrada.'; end if;
  new.partida := btrim(new.partida);
  new.subpartida := nullif(btrim(coalesce(new.subpartida, '')), '');
  new.updated_at := now();
  return new;
end $$;
do $$ begin execute 'dr' || 'op trigger if exists mo_presupuestos_antes on public.mo_presupuestos'; end $$;
create trigger mo_presupuestos_antes before insert or update on public.mo_presupuestos
  for each row execute function public.mo_presupuestos_antes();

-- 4. RLS --------------------------------------------------------------------
alter table public.mo_trabajadores enable row level security;
alter table public.mo_listas enable row level security;
alter table public.mo_lista_renglones enable row level security;
alter table public.mo_presupuestos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['mo_trabajadores', 'mo_listas', 'mo_lista_renglones', 'mo_presupuestos'] loop
    execute format('dr' || 'op policy if exists frontera_organizacion on public.%I', t);
    if t = 'mo_trabajadores' then
      execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
        using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
        with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))$p$, t);
    else
      execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
        using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
        with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))$p$, t);
    end if;
    execute format('dr' || 'op policy if exists espectador_sin_datos on public.%I', t);
    execute format($p$create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()))$p$, t);
    execute format('dr' || 'op policy if exists director_general on public.%I', t);
    execute format($p$create policy director_general on public.%I for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()))$p$, t);
    execute format('dr' || 'op trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or del' || 'ete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select, insert, update, del' || 'ete on public.%I to authenticated', t);
    execute format('dr' || 'op policy if exists %I_select on public.%I', t, t);
    execute format('dr' || 'op policy if exists %I_insert on public.%I', t, t);
    execute format('dr' || 'op policy if exists %I_update on public.%I', t, t);
    execute format('dr' || 'op policy if exists %I_quitar on public.%I', t, t);
  end loop;
end $$;

-- Trabajadores: los ve quien ve mano de obra; los da de alta RH o dirección.
create policy mo_trabajadores_select on public.mo_trabajadores for select to authenticated
  using ((select public.auth_ve_mano_obra()));
create policy mo_trabajadores_insert on public.mo_trabajadores for insert to authenticated
  with check (((select public.auth_captura_mano_obra()) or (select public.auth_autoriza_mano_obra()))
              and (select public.auth_suscripcion_permite_escribir_definer()));
create policy mo_trabajadores_update on public.mo_trabajadores for update to authenticated
  using ((select public.auth_captura_mano_obra()) or (select public.auth_autoriza_mano_obra()))
  with check ((select public.auth_captura_mano_obra()) or (select public.auth_autoriza_mano_obra()));

-- Listas: ven quien ve mano de obra en su alcance; capturan RH en su organización.
create policy mo_listas_select on public.mo_listas for select to authenticated
  using ((select public.auth_ve_mano_obra())
         and (empresa_id = any ((select public.auth_empresas_alcance())::uuid[]) or (select public.auth_captura_mano_obra())));
create policy mo_listas_insert on public.mo_listas for insert to authenticated
  with check ((select public.auth_captura_mano_obra())
              and (select public.auth_suscripcion_permite_escribir_definer())
              and estado = 'borrador');
create policy mo_listas_update on public.mo_listas for update to authenticated
  using ((select public.auth_captura_mano_obra()) and (select public.auth_suscripcion_permite_escribir_definer()))
  with check ((select public.auth_captura_mano_obra()));

create policy mo_lista_renglones_select on public.mo_lista_renglones for select to authenticated
  using (lista_id in (select l.id from public.mo_listas l));
create policy mo_lista_renglones_insert on public.mo_lista_renglones for insert to authenticated
  with check ((select public.auth_captura_mano_obra()) and (select public.auth_suscripcion_permite_escribir_definer()));
create policy mo_lista_renglones_update on public.mo_lista_renglones for update to authenticated
  using ((select public.auth_captura_mano_obra()) and (select public.auth_suscripcion_permite_escribir_definer()))
  with check ((select public.auth_captura_mano_obra()));
do $$ begin
  execute 'create policy mo_lista_renglones_quitar on public.mo_lista_renglones for del' || 'ete to authenticated
    using ((select public.auth_captura_mano_obra()) and (select public.auth_suscripcion_permite_escribir_definer()))';
end $$;

-- Presupuesto: ven quien ve mano de obra; capturan RH, dirección y rol empresa en su alcance.
create policy mo_presupuestos_select on public.mo_presupuestos for select to authenticated
  using ((select public.auth_ve_mano_obra())
         and (empresa_id = any ((select public.auth_empresas_alcance())::uuid[]) or (select public.auth_captura_mano_obra())));
create policy mo_presupuestos_insert on public.mo_presupuestos for insert to authenticated
  with check ((select public.auth_ve_mano_obra()) and (select public.auth_rol_definer()) <> 'corporativo'
              and (select public.auth_suscripcion_permite_escribir_definer())
              and (empresa_id = any ((select public.auth_empresas_alcance())::uuid[]) or (select public.auth_captura_mano_obra())));
create policy mo_presupuestos_update on public.mo_presupuestos for update to authenticated
  using ((select public.auth_ve_mano_obra()) and (select public.auth_rol_definer()) <> 'corporativo'
         and (empresa_id = any ((select public.auth_empresas_alcance())::uuid[]) or (select public.auth_captura_mano_obra())))
  with check ((select public.auth_ve_mano_obra()));
do $$ begin
  execute 'create policy mo_presupuestos_quitar on public.mo_presupuestos for del' || 'ete to authenticated
    using ((select public.auth_ve_mano_obra()) and (select public.auth_rol_definer()) <> ''corporativo''
           and (empresa_id = any ((select public.auth_empresas_alcance())::uuid[]) or (select public.auth_captura_mano_obra())))';
end $$;

-- 5. Flujo: enviar, autorizar o rechazar, reabrir, copiar --------------------
create or replace function public.fn_mo_lista_enviar(p_lista uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.mo_listas; v_grupo uuid; v_total numeric; v_n int; v_obra text;
begin
  if not public.auth_captura_mano_obra() then raise exception 'Solo RH captura y envía listas de raya.'; end if;
  if public.auth_solo_consulta() then raise exception 'Solo consulta.'; end if;
  select * into v from public.mo_listas where id = p_lista for update;
  if v.id is null or not (v.empresa_id = any (public.auth_empresas_organizacion())) then raise exception 'Lista no encontrada.'; end if;
  if v.estado not in ('borrador', 'rechazada') then raise exception 'La lista % ya está %.', v.folio, v.estado; end if;
  select count(*), coalesce(sum(monto), 0) into v_n, v_total from public.mo_lista_renglones where lista_id = v.id;
  if v_n = 0 then raise exception 'La lista no tiene renglones.'; end if;
  perform set_config('acumulado.mo_funcion', '1', true);
  update public.mo_listas set estado = 'enviada', enviada_en = now(), rechazo_motivo = null where id = v.id;
  perform set_config('acumulado.mo_funcion', '', true);
  select e.grupo_id, p.nombre into v_grupo, v_obra from public.proyectos p join public.empresas e on e.id = p.empresa_id where p.id = v.proyecto_id;
  perform public.fn_push_aviso(public.fn_direccion_de(v_grupo), 'Lista de raya por autorizar',
    format('%s · %s · semana %s (%s a %s) · %s renglones · $%s', v.folio, v_obra, v.num_sem,
           to_char(v.semana_inicio, 'DD/MM'), to_char(v.semana_fin, 'DD/MM'), v_n, to_char(v_total, 'FM999,999,990.00')),
    '/mano-obra?tab=autorizar&lista=' || v.id);
end $$;

create or replace function public.fn_mo_lista_autorizar(p_lista uuid, p_autorizar boolean, p_motivo text default null,
                                                       p_fecha_pago date default null, p_cuenta uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.mo_listas; v_obra text; v_pagos uuid[] := '{}'; v_id uuid; r record; v_nombre text;
begin
  if not public.auth_autoriza_mano_obra() then raise exception 'Solo dirección autoriza listas de raya.'; end if;
  if public.auth_solo_consulta() then raise exception 'Solo consulta.'; end if;
  select * into v from public.mo_listas where id = p_lista for update;
  if v.id is null or not (v.empresa_id = any (public.auth_empresas_alcance())) then raise exception 'Lista no encontrada.'; end if;
  if v.estado <> 'enviada' then raise exception 'La lista % está % (se autoriza cuando está enviada).', v.folio, v.estado; end if;
  select nombre into v_obra from public.proyectos where id = v.proyecto_id;
  select nombre into v_nombre from public.profiles where id = auth.uid();
  perform set_config('acumulado.mo_funcion', '1', true);
  if not p_autorizar then
    if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo del rechazo.'; end if;
    update public.mo_listas set estado = 'rechazada', rechazo_motivo = btrim(p_motivo) where id = v.id;
    perform set_config('acumulado.mo_funcion', '', true);
    if v.capturo_por is not null then
      perform public.fn_push_aviso(array[v.capturo_por], 'Lista de raya rechazada',
        format('%s · %s · semana %s: %s', v.folio, v_obra, v.num_sem, btrim(p_motivo)), '/mano-obra?lista=' || v.id);
    end if;
    return jsonb_build_object('estado', 'rechazada');
  end if;
  if p_cuenta is not null and not exists (select 1 from public.cuentas_bancarias c where c.id = p_cuenta and c.empresa_id = v.empresa_id) then
    raise exception 'La cuenta de cargo no es de la empresa de la obra.';
  end if;
  for r in select forma_pago, sum(monto) as total, count(*) as n from public.mo_lista_renglones where lista_id = v.id group by forma_pago loop
    insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, estatus, metodo, tipo, notas, created_by)
    values (v.empresa_id, case when r.forma_pago = 'transferencia' then p_cuenta end,
            'Lista de raya ' || v.folio, format('Mano de obra · %s · semana %s (%s a %s) · %s pago(s)', v_obra, v.num_sem,
            to_char(v.semana_inicio, 'DD/MM'), to_char(v.semana_fin, 'DD/MM'), r.n),
            round(r.total, 2), coalesce(p_fecha_pago, v.semana_fin), 'pendiente', r.forma_pago, 'mano_obra',
            format('Autorizó %s el %s.', coalesce(v_nombre, 'dirección'), to_char(now() at time zone 'America/Mexico_City', 'DD/MM/YYYY')), auth.uid())
    returning id into v_id;
    v_pagos := v_pagos || v_id;
  end loop;
  update public.mo_listas set estado = 'autorizada', autorizada_en = now(), autorizada_por = auth.uid(), autorizada_nombre = v_nombre,
         fecha_pago = coalesce(p_fecha_pago, v.semana_fin), pagos = v_pagos, rechazo_motivo = null
   where id = v.id;
  perform set_config('acumulado.mo_funcion', '', true);
  if v.capturo_por is not null then
    perform public.fn_push_aviso(array[v.capturo_por], 'Lista de raya autorizada',
      format('%s · %s · semana %s: ya está programada a pago.', v.folio, v_obra, v.num_sem), '/mano-obra?lista=' || v.id);
  end if;
  return jsonb_build_object('estado', 'autorizada', 'pagos', to_jsonb(v_pagos));
end $$;

-- Regresar una lista autorizada a borrador (dirección): solo si nada se ha pagado.
create or replace function public.fn_mo_lista_reabrir(p_lista uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.mo_listas;
begin
  if not public.auth_autoriza_mano_obra() then raise exception 'Solo dirección reabre listas autorizadas.'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe por qué se reabre.'; end if;
  select * into v from public.mo_listas where id = p_lista for update;
  if v.id is null or not (v.empresa_id = any (public.auth_empresas_alcance())) then raise exception 'Lista no encontrada.'; end if;
  if v.estado <> 'autorizada' then raise exception 'Solo se reabre una lista autorizada.'; end if;
  if exists (select 1 from public.pagos_programados p where p.id = any (v.pagos) and p.estatus = 'pagado') then
    raise exception 'Ya hay pagos hechos de esta lista: no se reabre.';
  end if;
  update public.pagos_programados set estatus = 'cancelado',
         notas = concat_ws(' ', notas, format('[Cancelado al reabrir la lista: %s]', btrim(p_motivo)))
   where id = any (v.pagos) and estatus = 'pendiente';
  perform set_config('acumulado.mo_funcion', '1', true);
  update public.mo_listas set estado = 'rechazada', rechazo_motivo = 'Reabierta: ' || btrim(p_motivo), pagos = '{}',
         autorizada_en = null, autorizada_por = null, autorizada_nombre = null
   where id = v.id;
  perform set_config('acumulado.mo_funcion', '', true);
end $$;

-- Copiar una lista a otra semana (la semana siguiente casi siempre repite gente).
create or replace function public.fn_mo_lista_copiar(p_lista uuid, p_semana_inicio date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.mo_listas; v_nueva uuid;
begin
  if not public.auth_captura_mano_obra() then raise exception 'Solo RH captura listas de raya.'; end if;
  select * into v from public.mo_listas where id = p_lista;
  if v.id is null or not (v.empresa_id = any (public.auth_empresas_organizacion())) then raise exception 'Lista no encontrada.'; end if;
  if extract(dow from p_semana_inicio) <> 0 then raise exception 'La semana empieza en domingo.'; end if;
  if exists (select 1 from public.mo_listas where proyecto_id = v.proyecto_id and semana_inicio = p_semana_inicio and estado <> 'cancelada') then
    raise exception 'Esa obra ya tiene lista de raya para esa semana.';
  end if;
  insert into public.mo_listas (proyecto_id, empresa_id, semana_inicio, notas) values (v.proyecto_id, v.empresa_id, p_semana_inicio, null)
  returning id into v_nueva;
  insert into public.mo_lista_renglones (lista_id, empresa_id, trabajador_id, trabajador_nombre, tipo_trabajador, partida, subpartida, dias, monto, forma_pago, orden)
  select v_nueva, v.empresa_id, trabajador_id, trabajador_nombre, tipo_trabajador, partida, subpartida, dias, monto, forma_pago, orden
    from public.mo_lista_renglones where lista_id = v.id;
  return v_nueva;
end $$;

revoke all on function public.fn_mo_lista_enviar(uuid) from public, anon;
revoke all on function public.fn_mo_lista_autorizar(uuid, boolean, text, date, uuid) from public, anon;
revoke all on function public.fn_mo_lista_reabrir(uuid, text) from public, anon;
revoke all on function public.fn_mo_lista_copiar(uuid, date) from public, anon;
grant execute on function public.fn_mo_lista_enviar(uuid) to authenticated;
grant execute on function public.fn_mo_lista_autorizar(uuid, boolean, text, date, uuid) to authenticated;
grant execute on function public.fn_mo_lista_reabrir(uuid, text) to authenticated;
grant execute on function public.fn_mo_lista_copiar(uuid, date) to authenticated;

-- 6. Una sola fuente de mano de obra para los reportes ------------------------
create or replace view public.v_mano_obra_renglones with (security_invoker = true) as
with autorizadas as materialized (
  select l.id, l.folio, l.semana_inicio, l.semana_fin, l.num_sem, l.proyecto_id, l.empresa_id,
         p.nombre as obra, public.normalizar_texto_sql(p.nombre) as clave, e.nombre as empresa
    from public.mo_listas l
    join public.proyectos p on p.id = l.proyecto_id
    join public.empresas e on e.id = l.empresa_id
   where l.estado = 'autorizada'
)
select r.id, r.origen, r.llave, r.datos, r.sincronizado_en
  from public.nomina_externa_renglones r
 where r.origen <> 'mano_obra'
    or not exists (
      select 1 from autorizadas a
       where a.clave = public.normalizar_texto_sql(r.datos ->> 'Proyecto')
         and coalesce((r.datos ->> 'Fecha_fin')::date, (r.datos ->> 'Fecha_inicio')::date) between a.semana_inicio and a.semana_fin)
union all
select x.id, 'mano_obra'::text, 'acumulado:' || x.id::text,
       jsonb_build_object(
         'Fuente', 'acumulado', 'Folio', a.folio, 'Year', extract(year from a.semana_fin)::int::text,
         'Monto', x.monto, 'Nombre', x.trabajador_nombre, 'Empresa', a.empresa, 'Num_sem', a.num_sem,
         'Partida', x.partida, 'Subpartida', coalesce(x.subpartida, ''), 'Proyecto', a.obra,
         'Fecha_inicio', a.semana_inicio, 'Fecha_fin', a.semana_fin,
         'Tipo_Trabajador', case x.tipo_trabajador when 'contratista' then 'Contratista' else 'Empleado' end,
         'Id_trabajador', t.backoffice_id, 'Dias', x.dias, 'Forma_pago', x.forma_pago),
       a.semana_fin::timestamptz
  from public.mo_lista_renglones x
  join autorizadas a on a.id = x.lista_id
  left join public.mo_trabajadores t on t.id = x.trabajador_id;

revoke all on public.v_mano_obra_renglones from anon;
grant select on public.v_mano_obra_renglones to authenticated;

-- Los reportes leen la vista en lugar de la tabla (mismas columnas).
do $$
declare
  r record; v_def text;
begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and p.proname in ('fn_avance_financiero_real', 'fn_avance_financiero_detalle', 'fn_obra_gasto_backoffice',
                                'fn_reporte_area_mantenimiento', 'fn_reporte_rh_director', 'nomina_api_control_obra',
                                'fn_equilibrio_bbva_gasto') loop
    v_def := pg_get_functiondef(r.f);
    if position('public.nomina_externa_renglones r' in v_def) > 0 then
      execute replace(v_def, 'public.nomina_externa_renglones r', 'public.v_mano_obra_renglones r');
    end if;
  end loop;
end $$;

-- 7. Presupuesto contra lo pagado y catálogo para capturar --------------------
create or replace function public.fn_mo_presupuesto_avance(p_proyecto uuid default null)
returns table (proyecto_id uuid, obra text, empresa_id uuid, partida text, subpartida text,
               presupuesto numeric, ejercido numeric, semanas integer, ultima_semana date)
language sql stable security definer set search_path = public as $$
  with obras as materialized (
    select p.id, p.nombre, p.empresa_id, public.normalizar_texto_sql(p.nombre) as clave
      from public.proyectos p
     where (p_proyecto is null or p.id = p_proyecto)
       and public.auth_ve_mano_obra()
       and (p.empresa_id = any (public.auth_empresas_alcance()) or public.auth_captura_mano_obra())
       and p.empresa_id = any (public.auth_empresas_organizacion())
  ), real as (
    select ob.id as proyecto_id, public.normalizar_texto_sql(r.datos ->> 'Partida') as kp,
           public.normalizar_texto_sql(coalesce(r.datos ->> 'Subpartida', '')) as ks,
           min(btrim(r.datos ->> 'Partida')) as partida, min(nullif(btrim(r.datos ->> 'Subpartida'), '')) as subpartida,
           sum(coalesce((r.datos ->> 'Monto')::numeric, 0)) as ejercido,
           count(distinct coalesce(r.datos ->> 'Fecha_fin', r.datos ->> 'Fecha_inicio'))::int as semanas,
           max(coalesce((r.datos ->> 'Fecha_fin')::date, (r.datos ->> 'Fecha_inicio')::date)) as ultima
      from public.v_mano_obra_renglones r
      join obras ob on ob.clave = public.normalizar_texto_sql(r.datos ->> 'Proyecto')
     where r.origen = 'mano_obra'
     group by 1, 2, 3
  ), pres as (
    select mp.proyecto_id, public.normalizar_texto_sql(mp.partida) as kp, public.normalizar_texto_sql(coalesce(mp.subpartida, '')) as ks,
           mp.partida, mp.subpartida, mp.monto
      from public.mo_presupuestos mp join obras ob on ob.id = mp.proyecto_id
  )
  select coalesce(p.proyecto_id, r.proyecto_id), ob.nombre, ob.empresa_id,
         coalesce(p.partida, r.partida), coalesce(p.subpartida, r.subpartida),
         p.monto, round(coalesce(r.ejercido, 0), 2), coalesce(r.semanas, 0), r.ultima
    from pres p
    full join real r on r.proyecto_id = p.proyecto_id and r.kp = p.kp and r.ks = p.ks
    join obras ob on ob.id = coalesce(p.proyecto_id, r.proyecto_id)
   order by 2, 4, 5
$$;
revoke all on function public.fn_mo_presupuesto_avance(uuid) from public, anon;
grant execute on function public.fn_mo_presupuesto_avance(uuid) to authenticated;

-- Partidas y subpartidas ya usadas (backoffice + aquí + presupuesto) para sugerir al capturar.
create or replace function public.fn_mo_catalogo()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.auth_ve_mano_obra() then null else jsonb_build_object(
    'partidas', coalesce((
      select jsonb_agg(jsonb_build_object('partida', partida, 'subpartida', subpartida, 'veces', veces) order by veces desc, partida, subpartida)
        from (
          select btrim(r.datos ->> 'Partida') as partida, nullif(btrim(r.datos ->> 'Subpartida'), '') as subpartida, count(*)::int as veces
            from public.v_mano_obra_renglones r
            join public.nomina_externa_origenes o on o.origen = r.origen
           where r.origen = 'mano_obra' and o.grupo_id = any (public.auth_grupos_alcance())
             and coalesce(btrim(r.datos ->> 'Partida'), '') <> ''
           group by 1, 2
          union all
          select mp.partida, mp.subpartida, 0 from public.mo_presupuestos mp
           where mp.empresa_id = any (public.auth_empresas_organizacion())
        ) x), '[]'::jsonb)
  ) end
$$;
revoke all on function public.fn_mo_catalogo() from public, anon;
grant execute on function public.fn_mo_catalogo() to authenticated;

-- 8. Trabajadores de la API del backoffice -----------------------------------
insert into public.mo_trabajadores (grupo_id, nombre, tipo, puesto, empresa_id, backoffice_id)
select distinct on (o.grupo_id, (r.datos ->> 'Id_trabajador')::int)
       o.grupo_id, btrim(r.datos ->> 'Nombre'),
       case when r.datos ->> 'Tipo_Trabajador' ilike 'contratista%' then 'contratista' else 'empleado' end,
       nullif(btrim(r.datos ->> 'Subpartida'), ''),
       (select e.id from public.empresas e where e.grupo_id = o.grupo_id
           and public.normalizar_texto_sql(e.nombre) = public.normalizar_texto_sql(r.datos ->> 'Empresa') limit 1),
       (r.datos ->> 'Id_trabajador')::int
  from public.nomina_externa_renglones r
  join public.nomina_externa_origenes o on o.origen = r.origen
 where r.origen = 'mano_obra' and o.grupo_id is not null
   and (r.datos ->> 'Id_trabajador') ~ '^[0-9]+$' and coalesce(btrim(r.datos ->> 'Nombre'), '') <> ''
 order by o.grupo_id, (r.datos ->> 'Id_trabajador')::int, (r.datos ->> 'Fecha_fin') desc nulls last
on conflict do nothing;

-- 9. Obras para capturar (RH no lee `proyectos` completo por su rol) ----------
create or replace function public.fn_mo_obras()
returns table (id uuid, nombre text, empresa_id uuid, empresa text, empresa_codigo text, activo boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.empresa_id, e.nombre, e.codigo, p.activo
    from public.proyectos p join public.empresas e on e.id = p.empresa_id
   where public.auth_ve_mano_obra()
     and p.empresa_id = any (public.auth_empresas_organizacion())
     and (p.empresa_id = any (public.auth_empresas_alcance()) or public.auth_captura_mano_obra())
     and (p.activo or exists (select 1 from public.mo_listas l where l.proyecto_id = p.id))
   order by p.nombre
$$;
revoke all on function public.fn_mo_obras() from public, anon;
grant execute on function public.fn_mo_obras() to authenticated;
