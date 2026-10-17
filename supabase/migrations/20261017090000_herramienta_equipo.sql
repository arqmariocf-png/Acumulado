-- Herramienta y equipo en el almacén (17-oct-2026, Mario: "generemos dentro
-- del almacén el área de herramienta y equipo; esto puede ser asignado y
-- pedido por los supervisores para las diferentes obras").
--
--   * herramientas: cada pieza con su folio HE-<empresa>-0001 (es la
--     etiqueta con código de barras), categoría, marca, modelo, serie,
--     costo y dónde está HOY: estado (disponible / asignada / reparacion /
--     baja / extraviada), obra, responsable y fecha en que debe regresar.
--     Lo de "dónde está" lo pone la bitácora; nadie lo edita a mano.
--   * herramienta_movimientos: bitácora (alta, asignación, traspaso,
--     devolución con condición, reparación, baja, extravío).
--   * herramienta_solicitudes / _lineas: el supervisor (o quien vea la
--     obra) pide para SU obra lo que necesita, con fecha y cuándo lo
--     regresa; almacén surte asignando piezas a cada renglón (folio
--     SH-<empresa>-0001). `surtido` del renglón y estado de la solicitud se
--     recalculan de la bitácora al surtir.
-- Operan (alta, asignar, recibir, reparación, baja): admin, corporativo,
-- almacén, empresa o permiso por persona 'herramienta'
-- (`auth_opera_herramienta`). Ven: los que operan y dirección/responsable
-- en su alcance; el supervisor ve lo de sus obras y lo que tiene a su cargo.
-- Se escribe por funciones (definer), salvo la solicitud, que se inserta con
-- la RLS de quien pide para validar que ve la obra.
-- Ya aplicado en producción.

create or replace function public.auth_opera_herramienta()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and not p.espectador
       and (p.rol in ('admin', 'corporativo', 'almacen', 'empresa')
            or exists (select 1 from public.permisos_modulo m where m.profile_id = p.id and m.modulo = 'herramienta')))
$$;
grant execute on function public.auth_opera_herramienta() to authenticated;

alter table public.permisos_modulo drop constraint if exists permisos_modulo_modulo_check;
alter table public.permisos_modulo add constraint permisos_modulo_modulo_check check (modulo = any (array[
  'inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva', 'comedor', 'legal',
  'checador', 'contabilidad', 'tesoreria', 'punto_venta', 'compras', 'cotizador', 'herramienta']));

create table if not exists public.herramientas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  folio text,
  nombre text not null check (btrim(nombre) <> ''),
  categoria text not null default 'herramienta' check (categoria in ('herramienta', 'electrica', 'equipo', 'maquinaria', 'medicion', 'seguridad', 'otro')),
  marca text,
  modelo text,
  numero_serie text,
  costo numeric(14, 2) check (costo is null or costo >= 0),
  fecha_compra date,
  estado text not null default 'disponible' check (estado in ('disponible', 'asignada', 'reparacion', 'baja', 'extraviada')),
  condicion text not null default 'buena' check (condicion in ('buena', 'regular', 'mala')),
  proyecto_id uuid references public.proyectos (id) on delete set null,
  responsable_id uuid references public.profiles (id) on delete set null,
  responsable_nombre text,
  asignada_en timestamptz,
  devolver_el date,
  notas text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio)
);
create index if not exists herramientas_proyecto_idx on public.herramientas (proyecto_id);
create index if not exists herramientas_responsable_idx on public.herramientas (responsable_id);
create index if not exists herramientas_created_by_idx on public.herramientas (created_by);

create table if not exists public.herramienta_solicitudes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  proyecto_id uuid not null references public.proyectos (id),
  folio text,
  solicitado_por uuid not null references public.profiles (id) default auth.uid(),
  solicitante_nombre text,
  fecha_requerida date,
  devolver_el date,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'parcial', 'surtida', 'rechazada', 'cancelada')),
  nota text,
  respuesta text,
  atendida_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio)
);
create index if not exists herramienta_solicitudes_proyecto_idx on public.herramienta_solicitudes (proyecto_id);
create index if not exists herramienta_solicitudes_solicitado_idx on public.herramienta_solicitudes (solicitado_por);
create index if not exists herramienta_solicitudes_atendida_idx on public.herramienta_solicitudes (atendida_por);

create table if not exists public.herramienta_solicitud_lineas (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.herramienta_solicitudes (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),
  descripcion text not null check (btrim(descripcion) <> ''),
  cantidad integer not null default 1 check (cantidad > 0),
  surtido integer not null default 0,
  nota text,
  created_at timestamptz not null default now()
);
create index if not exists herramienta_solicitud_lineas_solicitud_idx on public.herramienta_solicitud_lineas (solicitud_id);
create index if not exists herramienta_solicitud_lineas_empresa_idx on public.herramienta_solicitud_lineas (empresa_id);

create table if not exists public.herramienta_movimientos (
  id uuid primary key default gen_random_uuid(),
  herramienta_id uuid not null references public.herramientas (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),
  tipo text not null check (tipo in ('alta', 'asignacion', 'traspaso', 'devolucion', 'reparacion', 'fin_reparacion', 'baja', 'extravio')),
  proyecto_id uuid references public.proyectos (id) on delete set null,
  responsable_id uuid references public.profiles (id) on delete set null,
  responsable_nombre text,
  solicitud_linea_id uuid references public.herramienta_solicitud_lineas (id) on delete set null,
  condicion text check (condicion in ('buena', 'regular', 'mala')),
  devolver_el date,
  nota text,
  registrado_por uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists herramienta_movimientos_herramienta_idx on public.herramienta_movimientos (herramienta_id, created_at desc);
create index if not exists herramienta_movimientos_empresa_idx on public.herramienta_movimientos (empresa_id);
create index if not exists herramienta_movimientos_proyecto_idx on public.herramienta_movimientos (proyecto_id);
create index if not exists herramienta_movimientos_responsable_idx on public.herramienta_movimientos (responsable_id);
create index if not exists herramienta_movimientos_linea_idx on public.herramienta_movimientos (solicitud_linea_id);
create index if not exists herramienta_movimientos_registrado_idx on public.herramienta_movimientos (registrado_por);

-- Obras donde la persona es responsable o comprador, más las de
-- auth_proyectos_propios (donde ya pidió requisiciones o su excepción).
create or replace function public.auth_herramienta_obras()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x.id), '{}'::uuid[])
    from (
      select p.id from public.proyectos p
       where p.responsable_id = auth.uid() or p.comprador_id = auth.uid()
      union all
      select unnest(public.auth_proyectos_propios())
      union all
      select s.proyecto_id from public.herramienta_solicitudes s where s.solicitado_por = auth.uid()
    ) x
   where not (select public.auth_es_espectador())
$$;
revoke all on function public.auth_herramienta_obras() from public, anon;
grant execute on function public.auth_herramienta_obras() to authenticated;

-- Folios y datos heredados ----------------------------------------------------
create or replace function public.herramientas_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.nombre := btrim(new.nombre);
  if tg_op = 'INSERT' and nullif(btrim(new.folio), '') is null then
    new.folio := public.fn_siguiente_folio(new.empresa_id, 'HE');
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists herramientas_antes on public.herramientas;
create trigger herramientas_antes before insert or update on public.herramientas
  for each row execute function public.herramientas_antes();

create or replace function public.herramienta_solicitudes_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select p.empresa_id into new.empresa_id from public.proyectos p where p.id = new.proyecto_id;
    if new.empresa_id is null then raise exception 'La obra no existe.'; end if;
    new.folio := public.fn_siguiente_folio(new.empresa_id, 'SH');
    new.solicitado_por := coalesce(auth.uid(), new.solicitado_por);
    select nullif(btrim(pr.nombre), '') into new.solicitante_nombre
      from public.profiles pr where pr.id = new.solicitado_por;
    new.estado := 'pendiente';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists herramienta_solicitudes_antes on public.herramienta_solicitudes;
create trigger herramienta_solicitudes_antes before insert or update on public.herramienta_solicitudes
  for each row execute function public.herramienta_solicitudes_antes();

create or replace function public.herramienta_solicitud_lineas_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select s.empresa_id into new.empresa_id from public.herramienta_solicitudes s where s.id = new.solicitud_id;
  new.descripcion := btrim(new.descripcion);
  if tg_op = 'INSERT' then new.surtido := 0; end if;
  return new;
end;
$$;
drop trigger if exists herramienta_solicitud_lineas_antes on public.herramienta_solicitud_lineas;
create trigger herramienta_solicitud_lineas_antes before insert or update on public.herramienta_solicitud_lineas
  for each row execute function public.herramienta_solicitud_lineas_antes();

-- RLS -------------------------------------------------------------------------
alter table public.herramientas enable row level security;
alter table public.herramienta_movimientos enable row level security;
alter table public.herramienta_solicitudes enable row level security;
alter table public.herramienta_solicitud_lineas enable row level security;

do $$
declare t text;
begin
  foreach t in array array['herramientas', 'herramienta_movimientos', 'herramienta_solicitudes', 'herramienta_solicitud_lineas'] loop
    execute format('drop policy if exists frontera_organizacion on public.%I', t);
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
      with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))$p$, t);
    execute format('drop policy if exists espectador_sin_datos on public.%I', t);
    execute format($p$create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()))$p$, t);
    execute format('drop policy if exists director_general on public.%I', t);
    execute format($p$create policy director_general on public.%I for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()))$p$, t);
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
grant insert on public.herramienta_solicitudes, public.herramienta_solicitud_lineas to authenticated;

drop policy if exists herramientas_select on public.herramientas;
create policy herramientas_select on public.herramientas for select to authenticated
  using (
    (((select public.auth_opera_herramienta())
      or (select public.auth_rol_definer()) = any ('{direccion,responsable}'::public.app_rol[]))
     and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
    or responsable_id = (select auth.uid())
    or proyecto_id = any ((select public.auth_herramienta_obras())::uuid[])
  );

drop policy if exists herramienta_movimientos_select on public.herramienta_movimientos;
create policy herramienta_movimientos_select on public.herramienta_movimientos for select to authenticated
  using (
    (((select public.auth_opera_herramienta())
      or (select public.auth_rol_definer()) = any ('{direccion,responsable}'::public.app_rol[]))
     and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
    or responsable_id = (select auth.uid())
    or proyecto_id = any ((select public.auth_herramienta_obras())::uuid[])
  );

drop policy if exists herramienta_solicitudes_select on public.herramienta_solicitudes;
create policy herramienta_solicitudes_select on public.herramienta_solicitudes for select to authenticated
  using (
    solicitado_por = (select auth.uid())
    or (((select public.auth_opera_herramienta())
         or (select public.auth_rol_definer()) = any ('{direccion,responsable}'::public.app_rol[]))
        and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
    or proyecto_id = any ((select public.auth_herramienta_obras())::uuid[])
  );
-- Pide quien VE la obra (la subconsulta corre con su RLS de proyectos).
drop policy if exists herramienta_solicitudes_insert on public.herramienta_solicitudes;
create policy herramienta_solicitudes_insert on public.herramienta_solicitudes for insert to authenticated
  with check (
    solicitado_por = (select auth.uid())
    and (select public.auth_rol_definer()) <> 'pendiente'
    and not (select public.auth_es_espectador())
    and exists (select 1 from public.proyectos p where p.id = proyecto_id)
  );

drop policy if exists herramienta_solicitud_lineas_select on public.herramienta_solicitud_lineas;
create policy herramienta_solicitud_lineas_select on public.herramienta_solicitud_lineas for select to authenticated
  using (exists (select 1 from public.herramienta_solicitudes s where s.id = solicitud_id));
drop policy if exists herramienta_solicitud_lineas_insert on public.herramienta_solicitud_lineas;
create policy herramienta_solicitud_lineas_insert on public.herramienta_solicitud_lineas for insert to authenticated
  with check (exists (select 1 from public.herramienta_solicitudes s
                       where s.id = solicitud_id and s.solicitado_por = (select auth.uid()) and s.estado = 'pendiente'));

-- Funciones -------------------------------------------------------------------
create or replace function public.fn_herramienta_validar_opera(p_empresa uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.auth_opera_herramienta() then
    raise exception 'Solo almacén administra herramienta y equipo.' using errcode = '42501';
  end if;
  if p_empresa is null or not (p_empresa = any (public.auth_empresas_alcance())) then
    raise exception 'La empresa no está en tu alcance.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.fn_herramienta_validar_opera(uuid) from public, anon, authenticated;

-- Alta de una o varias piezas iguales (p_cantidad), cada una con su folio.
create or replace function public.fn_herramienta_alta(p_empresa uuid, p_datos jsonb, p_cantidad integer default 1)
returns setof uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  i integer;
begin
  perform public.fn_herramienta_validar_opera(p_empresa);
  if nullif(btrim(p_datos->>'nombre'), '') is null then raise exception 'Falta el nombre de la herramienta.'; end if;
  if coalesce(p_cantidad, 1) < 1 or p_cantidad > 200 then raise exception 'Cantidad entre 1 y 200.'; end if;
  for i in 1 .. coalesce(p_cantidad, 1) loop
    insert into public.herramientas (empresa_id, nombre, categoria, marca, modelo, numero_serie, costo, fecha_compra, condicion, notas)
    values (p_empresa, p_datos->>'nombre', coalesce(nullif(p_datos->>'categoria', ''), 'herramienta'),
            nullif(btrim(p_datos->>'marca'), ''), nullif(btrim(p_datos->>'modelo'), ''),
            case when p_cantidad = 1 then nullif(btrim(p_datos->>'numero_serie'), '') end,
            nullif(p_datos->>'costo', '')::numeric, nullif(p_datos->>'fecha_compra', '')::date,
            coalesce(nullif(p_datos->>'condicion', ''), 'buena'), nullif(btrim(p_datos->>'notas'), ''))
    returning id into v_id;
    insert into public.herramienta_movimientos (herramienta_id, empresa_id, tipo, condicion, nota)
    values (v_id, p_empresa, 'alta', coalesce(nullif(p_datos->>'condicion', ''), 'buena'), nullif(btrim(p_datos->>'notas'), ''));
    return next v_id;
  end loop;
end;
$$;
revoke all on function public.fn_herramienta_alta(uuid, jsonb, integer) from public, anon;
grant execute on function public.fn_herramienta_alta(uuid, jsonb, integer) to authenticated;

-- Corregir la ficha (no el estado: eso va por la bitácora).
create or replace function public.fn_herramienta_editar(p_id uuid, p_datos jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  select empresa_id into v_empresa from public.herramientas where id = p_id;
  perform public.fn_herramienta_validar_opera(v_empresa);
  if nullif(btrim(p_datos->>'nombre'), '') is null then raise exception 'Falta el nombre de la herramienta.'; end if;
  update public.herramientas set
    nombre = p_datos->>'nombre',
    categoria = coalesce(nullif(p_datos->>'categoria', ''), categoria),
    marca = nullif(btrim(p_datos->>'marca'), ''),
    modelo = nullif(btrim(p_datos->>'modelo'), ''),
    numero_serie = nullif(btrim(p_datos->>'numero_serie'), ''),
    costo = nullif(p_datos->>'costo', '')::numeric,
    fecha_compra = nullif(p_datos->>'fecha_compra', '')::date,
    notas = nullif(btrim(p_datos->>'notas'), '')
  where id = p_id;
end;
$$;
revoke all on function public.fn_herramienta_editar(uuid, jsonb) from public, anon;
grant execute on function public.fn_herramienta_editar(uuid, jsonb) to authenticated;

-- Recalcula lo surtido de los renglones y el estado de la solicitud.
create or replace function public.fn_herramienta_solicitud_recalcular(p_solicitud uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_falta integer; v_surtido integer;
begin
  update public.herramienta_solicitud_lineas l
     set surtido = (select count(*) from public.herramienta_movimientos m
                     where m.solicitud_linea_id = l.id and m.tipo in ('asignacion', 'traspaso'))
   where l.solicitud_id = p_solicitud;
  select coalesce(sum(greatest(cantidad - surtido, 0)), 0), coalesce(sum(surtido), 0) into v_falta, v_surtido
    from public.herramienta_solicitud_lineas where solicitud_id = p_solicitud;
  update public.herramienta_solicitudes
     set estado = case when v_falta = 0 then 'surtida' when v_surtido > 0 then 'parcial' else 'pendiente' end,
         atendida_por = case when v_surtido > 0 then auth.uid() else atendida_por end
   where id = p_solicitud and estado in ('pendiente', 'parcial', 'surtida');
end;
$$;
revoke all on function public.fn_herramienta_solicitud_recalcular(uuid) from public, anon, authenticated;

-- Asignar (o pasar a otra obra) una o varias piezas. Con p_linea se surte el
-- renglón de una solicitud: la obra y el responsable salen de ella.
create or replace function public.fn_herramienta_asignar(
  p_herramientas uuid[], p_proyecto uuid, p_responsable uuid, p_responsable_nombre text,
  p_devolver_el date, p_nota text, p_linea uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  h record;
  v_sol public.herramienta_solicitudes;
  v_proy public.proyectos;
  v_nombre text := nullif(btrim(p_responsable_nombre), '');
  v_resp uuid := p_responsable;
  v_devolver date := p_devolver_el;
  v_n integer := 0;
begin
  if coalesce(array_length(p_herramientas, 1), 0) = 0 then raise exception 'Elige al menos una herramienta.'; end if;
  if p_linea is not null then
    select s.* into v_sol from public.herramienta_solicitudes s
      join public.herramienta_solicitud_lineas l on l.solicitud_id = s.id where l.id = p_linea;
    if v_sol.id is null then raise exception 'Renglón de solicitud no encontrado.'; end if;
    if v_sol.estado not in ('pendiente', 'parcial') then raise exception 'La solicitud % ya no está por surtir.', v_sol.folio; end if;
    p_proyecto := v_sol.proyecto_id;
    v_resp := coalesce(v_resp, v_sol.solicitado_por);
    v_devolver := coalesce(v_devolver, v_sol.devolver_el);
  end if;
  select * into v_proy from public.proyectos where id = p_proyecto;
  if v_proy.id is null then raise exception 'Elige la obra.'; end if;
  if v_resp is not null and v_nombre is null then
    select nullif(btrim(nombre), '') into v_nombre from public.profiles where id = v_resp;
  end if;
  if v_nombre is null then raise exception 'Indica quién recibe la herramienta.'; end if;
  if not (v_proy.empresa_id = any (public.auth_empresas_organizacion())) then raise exception 'La obra no es de tu organización.'; end if;

  for h in select * from public.herramientas where id = any (p_herramientas) for update loop
    perform public.fn_herramienta_validar_opera(h.empresa_id);
    if h.estado not in ('disponible', 'asignada') then
      raise exception '% (%) está en %: no se puede asignar.', h.folio, h.nombre, h.estado;
    end if;
    update public.herramientas
       set estado = 'asignada', proyecto_id = p_proyecto, responsable_id = v_resp, responsable_nombre = v_nombre,
           asignada_en = now(), devolver_el = v_devolver
     where id = h.id;
    insert into public.herramienta_movimientos (herramienta_id, empresa_id, tipo, proyecto_id, responsable_id, responsable_nombre,
                                                solicitud_linea_id, condicion, devolver_el, nota)
    values (h.id, h.empresa_id, case when h.estado = 'asignada' then 'traspaso' else 'asignacion' end, p_proyecto, v_resp, v_nombre,
            p_linea, h.condicion, v_devolver, nullif(btrim(p_nota), ''));
    v_n := v_n + 1;
  end loop;
  if v_n <> array_length(p_herramientas, 1) then raise exception 'Alguna herramienta no existe.'; end if;
  if v_sol.id is not null then perform public.fn_herramienta_solicitud_recalcular(v_sol.id); end if;
  return v_n;
end;
$$;
revoke all on function public.fn_herramienta_asignar(uuid[], uuid, uuid, text, date, text, uuid) from public, anon;
grant execute on function public.fn_herramienta_asignar(uuid[], uuid, uuid, text, date, text, uuid) to authenticated;

-- Regresa al almacén. Condición mala con p_a_reparacion → queda en reparación.
create or replace function public.fn_herramienta_devolver(p_herramientas uuid[], p_condicion text, p_nota text, p_a_reparacion boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare h record; v_n integer := 0;
begin
  if p_condicion not in ('buena', 'regular', 'mala') then raise exception 'Condición: buena, regular o mala.'; end if;
  for h in select * from public.herramientas where id = any (p_herramientas) for update loop
    perform public.fn_herramienta_validar_opera(h.empresa_id);
    if h.estado <> 'asignada' then raise exception '% no está asignada.', h.folio; end if;
    insert into public.herramienta_movimientos (herramienta_id, empresa_id, tipo, proyecto_id, responsable_id, responsable_nombre, condicion, nota)
    values (h.id, h.empresa_id, 'devolucion', h.proyecto_id, h.responsable_id, h.responsable_nombre, p_condicion, nullif(btrim(p_nota), ''));
    if coalesce(p_a_reparacion, false) then
      insert into public.herramienta_movimientos (herramienta_id, empresa_id, tipo, condicion, nota)
      values (h.id, h.empresa_id, 'reparacion', p_condicion, nullif(btrim(p_nota), ''));
    end if;
    update public.herramientas
       set estado = case when coalesce(p_a_reparacion, false) then 'reparacion' else 'disponible' end,
           condicion = p_condicion, proyecto_id = null, responsable_id = null, responsable_nombre = null,
           asignada_en = null, devolver_el = null
     where id = h.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.fn_herramienta_devolver(uuid[], text, text, boolean) from public, anon;
grant execute on function public.fn_herramienta_devolver(uuid[], text, text, boolean) to authenticated;

-- Reparación, regreso de reparación, baja o extravío (con motivo).
create or replace function public.fn_herramienta_estado(p_herramienta uuid, p_tipo text, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare h public.herramientas; v_estado text;
begin
  select * into h from public.herramientas where id = p_herramienta for update;
  perform public.fn_herramienta_validar_opera(h.empresa_id);
  if p_tipo not in ('reparacion', 'fin_reparacion', 'baja', 'extravio') then raise exception 'Movimiento no válido.'; end if;
  if p_tipo in ('baja', 'extravio') and nullif(btrim(p_nota), '') is null then raise exception 'Escribe el motivo.'; end if;
  if p_tipo = 'fin_reparacion' and h.estado <> 'reparacion' then raise exception '% no está en reparación.', h.folio; end if;
  if p_tipo = 'reparacion' and h.estado not in ('disponible', 'asignada') then raise exception '% está en %.', h.folio, h.estado; end if;
  if h.estado = 'baja' then raise exception '% ya está dada de baja.', h.folio; end if;
  v_estado := case p_tipo when 'reparacion' then 'reparacion' when 'fin_reparacion' then 'disponible' when 'baja' then 'baja' else 'extraviada' end;
  insert into public.herramienta_movimientos (herramienta_id, empresa_id, tipo, proyecto_id, responsable_id, responsable_nombre, condicion, nota)
  values (h.id, h.empresa_id, p_tipo, h.proyecto_id, h.responsable_id, h.responsable_nombre,
          case when p_tipo = 'fin_reparacion' then 'buena' else h.condicion end, nullif(btrim(p_nota), ''));
  update public.herramientas
     set estado = v_estado,
         condicion = case when p_tipo = 'fin_reparacion' then 'buena' else condicion end,
         proyecto_id = case when p_tipo = 'extravio' then proyecto_id else null end,
         responsable_id = case when p_tipo = 'extravio' then responsable_id else null end,
         responsable_nombre = case when p_tipo = 'extravio' then responsable_nombre else null end,
         asignada_en = case when p_tipo = 'extravio' then asignada_en else null end,
         devolver_el = null
   where id = h.id;
end;
$$;
revoke all on function public.fn_herramienta_estado(uuid, text, text) from public, anon;
grant execute on function public.fn_herramienta_estado(uuid, text, text) to authenticated;

-- Pedir herramienta para una obra (corre con la RLS de quien pide).
create or replace function public.fn_herramienta_solicitar(p_proyecto uuid, p_lineas jsonb, p_fecha_requerida date, p_devolver_el date, p_nota text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; l jsonb; v_n integer := 0;
begin
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'Agrega al menos un renglón.'; end if;
  insert into public.herramienta_solicitudes (empresa_id, proyecto_id, solicitado_por, fecha_requerida, devolver_el, nota)
  values ((select p.empresa_id from public.proyectos p where p.id = p_proyecto), p_proyecto, auth.uid(),
          p_fecha_requerida, p_devolver_el, nullif(btrim(p_nota), ''))
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    if nullif(btrim(l->>'descripcion'), '') is null then continue; end if;
    insert into public.herramienta_solicitud_lineas (solicitud_id, empresa_id, descripcion, cantidad, nota)
    values (v_id, (select s.empresa_id from public.herramienta_solicitudes s where s.id = v_id),
            l->>'descripcion', greatest(coalesce(nullif(l->>'cantidad', '')::integer, 1), 1), nullif(btrim(l->>'nota'), ''));
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Agrega al menos un renglón.'; end if;
  return v_id;
end;
$$;
revoke all on function public.fn_herramienta_solicitar(uuid, jsonb, date, date, text) from public, anon;
grant execute on function public.fn_herramienta_solicitar(uuid, jsonb, date, date, text) to authenticated;

-- Cancelar (quien pidió, mientras nada esté surtido) o rechazar (almacén).
create or replace function public.fn_herramienta_solicitud_cerrar(p_solicitud uuid, p_estado text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.herramienta_solicitudes; v_surtido integer;
begin
  select * into s from public.herramienta_solicitudes where id = p_solicitud for update;
  if s.id is null or not (s.empresa_id = any (public.auth_empresas_organizacion())) then raise exception 'Solicitud no encontrada.'; end if;
  if s.estado not in ('pendiente', 'parcial') then raise exception 'La solicitud % ya está %.', s.folio, s.estado; end if;
  select coalesce(sum(surtido), 0) into v_surtido from public.herramienta_solicitud_lineas where solicitud_id = p_solicitud;
  if p_estado = 'cancelada' then
    if s.solicitado_por <> auth.uid() and not public.auth_opera_herramienta() then
      raise exception 'Solo quien pidió la cancela.' using errcode = '42501';
    end if;
    if v_surtido > 0 and not public.auth_opera_herramienta() then
      raise exception 'Ya se surtió una parte; pide a almacén que la cierre.';
    end if;
  elsif p_estado = 'rechazada' then
    perform public.fn_herramienta_validar_opera(s.empresa_id);
    if nullif(btrim(p_motivo), '') is null then raise exception 'Escribe el motivo.'; end if;
  else
    raise exception 'Estado no válido.';
  end if;
  update public.herramienta_solicitudes
     set estado = p_estado, respuesta = nullif(btrim(p_motivo), ''), atendida_por = auth.uid()
   where id = p_solicitud;
end;
$$;
revoke all on function public.fn_herramienta_solicitud_cerrar(uuid, text, text) from public, anon;
grant execute on function public.fn_herramienta_solicitud_cerrar(uuid, text, text) to authenticated;
