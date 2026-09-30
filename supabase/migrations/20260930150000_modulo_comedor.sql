-- Módulo Comedor (Mario, 30-sep-2026): "lo manejaría como una empresa aparte
-- sin embargo va vinculado en las aplicaciones de los trabajadores para poder
-- ordenar y llevar su descuento vía nómina".
--
-- Diseño:
--   * El comedor es una EMPRESA de la organización (Grupo Loma: "Comedor",
--     código COM; se renombra en Admin → Empresas). comedor_config dice cuál
--     es y la hora límite para pedir.
--   * Platillos (catálogo con precio) y menú del día (qué platillos hay cada
--     fecha, con cupo opcional).
--   * El trabajador pide desde su app: un pedido por persona por día, con
--     uno o varios platillos, hasta la hora límite (se cancela igual). Tiene
--     que tener expediente activo en RH (personal.profile_id): el descuento es
--     a su nómina, en la empresa donde trabaja (profiles.empresa_id).
--   * La cocina marca "entregado"; SOLO lo entregado se descuenta.
--   * Nómina (RH / dirección / corporativo / admin) ve el descuento por
--     persona y periodo, lo exporta y lo marca "aplicado en nómina".
--   * El precio se congela en cada renglón del pedido; los totales se
--     calculan (v_comedor_pedidos).
-- Todo cambio de pedido pasa por funciones (fn_comedor_*): las tablas de
-- pedidos no tienen policies de escritura.
--
-- Ya aplicado en producción.

-- 1. Módulo -------------------------------------------------------------------
insert into public.modulos (clave, nombre, descripcion, orden)
select 'comedor', 'Comedor', 'Menú del día, pedidos de los trabajadores y descuento vía nómina', 50
where not exists (select 1 from public.modulos where clave = 'comedor');

insert into public.grupo_modulos (grupo_id, modulo_clave, habilitado, habilitado_at)
select g.id, 'comedor', g.codigo = 'LOMA', case when g.codigo = 'LOMA' then now() end
from public.grupos g
where not exists (select 1 from public.grupo_modulos gm where gm.grupo_id = g.id and gm.modulo_clave = 'comedor');

-- "comedor" también se asigna por persona (cocineros con rol básico).
alter table public.permisos_modulo drop constraint if exists permisos_modulo_modulo_check;
alter table public.permisos_modulo add constraint permisos_modulo_modulo_check
  check (modulo in ('inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva', 'comedor'));

-- 2. La empresa del comedor en Grupo Loma --------------------------------------
insert into public.empresas (nombre, codigo, grupo_id)
select 'Comedor', 'COM', g.id from public.grupos g
where g.codigo = 'LOMA' and not exists (select 1 from public.empresas e where e.codigo = 'COM');

-- 3. Tablas --------------------------------------------------------------------
create table if not exists public.comedor_config (
  grupo_id uuid primary key references public.grupos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  hora_limite time not null default '11:00',
  notas text,
  updated_at timestamptz not null default now()
);

insert into public.comedor_config (grupo_id, empresa_id)
select g.id, e.id from public.grupos g join public.empresas e on e.grupo_id = g.id and e.codigo = 'COM'
where g.codigo = 'LOMA'
on conflict (grupo_id) do nothing;

create table if not exists public.comedor_platillos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nombre text not null,
  descripcion text,
  categoria text,
  precio numeric(10,2) not null check (precio >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create table if not exists public.comedor_menu (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  fecha date not null,
  platillo_id uuid not null references public.comedor_platillos(id) on delete cascade,
  cupo integer check (cupo is null or cupo > 0),
  unique (fecha, platillo_id)
);
create index if not exists comedor_menu_fecha_idx on public.comedor_menu (empresa_id, fecha);
create index if not exists comedor_menu_platillo_idx on public.comedor_menu (platillo_id);

create table if not exists public.comedor_pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),          -- el comedor
  fecha date not null,
  profile_id uuid not null references auth.users(id),
  personal_id uuid references public.personal(id),
  empresa_trabajador_id uuid references public.empresas(id),        -- donde se descuenta
  trabajador_nombre text,
  estado text not null default 'pedido' check (estado in ('pedido', 'entregado', 'cancelado')),
  nota text,
  entregado_en timestamptz,
  entregado_por uuid references auth.users(id),
  descuento_aplicado_en timestamptz,
  descuento_aplicado_por uuid references auth.users(id),
  descuento_referencia text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, fecha)
);
create index if not exists comedor_pedidos_fecha_idx on public.comedor_pedidos (empresa_id, fecha);
create index if not exists comedor_pedidos_trabajador_idx on public.comedor_pedidos (empresa_trabajador_id, fecha);
create index if not exists comedor_pedidos_personal_idx on public.comedor_pedidos (personal_id);

create table if not exists public.comedor_pedido_lineas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.comedor_pedidos(id) on delete cascade,
  platillo_id uuid references public.comedor_platillos(id) on delete set null,
  nombre text not null,
  precio_unitario numeric(10,2) not null check (precio_unitario >= 0),
  cantidad integer not null check (cantidad > 0)
);
create index if not exists comedor_pedido_lineas_pedido_idx on public.comedor_pedido_lineas (pedido_id);
create index if not exists comedor_pedido_lineas_platillo_idx on public.comedor_pedido_lineas (platillo_id);

-- 4. Quién opera la cocina y quién ve nómina ------------------------------------
create or replace function public.auth_opera_comedor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.rol in ('admin', 'corporativo')
           or exists (select 1 from public.permisos_modulo pm where pm.profile_id = p.id and pm.modulo = 'comedor')
           or (p.rol = 'empresa' and exists (
                 select 1 from public.comedor_config c
                 where c.grupo_id = p.grupo_id and c.empresa_id = any (public.auth_empresas_alcance()))))
  )
$$;

create or replace function public.auth_ve_nomina_comedor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_rol() in ('admin', 'corporativo', 'direccion', 'rh')
$$;

-- 5. RLS -----------------------------------------------------------------------
alter table public.comedor_config enable row level security;
alter table public.comedor_platillos enable row level security;
alter table public.comedor_menu enable row level security;
alter table public.comedor_pedidos enable row level security;
alter table public.comedor_pedido_lineas enable row level security;

-- Frontera (restrictivas).
create policy frontera_organizacion on public.comedor_config as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
create policy frontera_organizacion on public.comedor_platillos as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
create policy frontera_organizacion on public.comedor_menu as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
create policy frontera_organizacion on public.comedor_pedidos as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
create policy frontera_organizacion on public.comedor_pedido_lineas as restrictive for all
  using (exists (select 1 from public.comedor_pedidos p where p.id = comedor_pedido_lineas.pedido_id))
  with check (exists (select 1 from public.comedor_pedidos p where p.id = comedor_pedido_lineas.pedido_id));

-- Config: la leen todos los de la organización con el módulo; la cambia quien opera.
create policy comedor_config_select on public.comedor_config for select to authenticated
  using ((select public.auth_rol_definer()) <> 'pendiente' and 'comedor' = any ((select public.auth_modulos_habilitados())::text[]));
create policy comedor_config_update on public.comedor_config for update to authenticated
  using ((select public.auth_opera_comedor()) and (select public.auth_suscripcion_permite_escribir_definer()))
  with check ((select public.auth_opera_comedor()) and (select public.auth_suscripcion_permite_escribir_definer()));

-- Platillos y menú: los ve cualquiera de la organización (para pedir); los captura la cocina.
create policy comedor_platillos_select on public.comedor_platillos for select to authenticated
  using ((select public.auth_rol_definer()) <> 'pendiente' and 'comedor' = any ((select public.auth_modulos_habilitados())::text[]));
create policy comedor_platillos_insert on public.comedor_platillos for insert to authenticated
  with check ((select public.auth_opera_comedor()) and (select public.auth_suscripcion_permite_escribir_definer()) and 'comedor' = any ((select public.auth_modulos_habilitados())::text[]));
create policy comedor_platillos_update on public.comedor_platillos for update to authenticated
  using ((select public.auth_opera_comedor()) and (select public.auth_suscripcion_permite_escribir_definer()))
  with check ((select public.auth_opera_comedor()) and (select public.auth_suscripcion_permite_escribir_definer()));
create policy comedor_platillos_delete on public.comedor_platillos for delete to authenticated
  using ((select public.auth_opera_comedor()) and (select public.auth_suscripcion_permite_escribir_definer()));

create policy comedor_menu_select on public.comedor_menu for select to authenticated
  using ((select public.auth_rol_definer()) <> 'pendiente' and 'comedor' = any ((select public.auth_modulos_habilitados())::text[]));
create policy comedor_menu_insert on public.comedor_menu for insert to authenticated
  with check ((select public.auth_opera_comedor()) and (select public.auth_suscripcion_permite_escribir_definer()) and 'comedor' = any ((select public.auth_modulos_habilitados())::text[]));
create policy comedor_menu_update on public.comedor_menu for update to authenticated
  using ((select public.auth_opera_comedor()) and (select public.auth_suscripcion_permite_escribir_definer()))
  with check ((select public.auth_opera_comedor()) and (select public.auth_suscripcion_permite_escribir_definer()));
create policy comedor_menu_delete on public.comedor_menu for delete to authenticated
  using ((select public.auth_opera_comedor()) and (select public.auth_suscripcion_permite_escribir_definer()));

-- Pedidos: el propio, la cocina y nómina. Sin policies de escritura: todo por fn_comedor_*.
create policy comedor_pedidos_select on public.comedor_pedidos for select to authenticated
  using ('comedor' = any ((select public.auth_modulos_habilitados())::text[])
         and (profile_id = (select auth.uid()) or (select public.auth_opera_comedor()) or (select public.auth_ve_nomina_comedor())));
create policy comedor_pedido_lineas_select on public.comedor_pedido_lineas for select to authenticated
  using (exists (select 1 from public.comedor_pedidos p where p.id = comedor_pedido_lineas.pedido_id));

grant select on public.comedor_config, public.comedor_platillos, public.comedor_menu, public.comedor_pedidos, public.comedor_pedido_lineas to authenticated;
grant insert, update, delete on public.comedor_platillos, public.comedor_menu to authenticated;
grant update on public.comedor_config to authenticated;

-- Solo consulta (espectadores y organizaciones sin pago).
do $$
declare t text;
begin
  foreach t in array array['comedor_config', 'comedor_platillos', 'comedor_menu', 'comedor_pedidos', 'comedor_pedido_lineas'] loop
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
  end loop;
end $$;

-- 6. Vista con totales calculados ------------------------------------------------
create or replace view public.v_comedor_pedidos with (security_invoker = true) as
select p.id, p.empresa_id, p.fecha, p.profile_id, p.personal_id, p.empresa_trabajador_id, e.nombre as empresa_trabajador,
       p.trabajador_nombre, p.estado, p.nota, p.entregado_en, p.descuento_aplicado_en, p.descuento_referencia, p.created_at,
       coalesce(l.total, 0) as total, coalesce(l.piezas, 0) as piezas, coalesce(l.detalle, '') as detalle
from public.comedor_pedidos p
left join public.empresas e on e.id = p.empresa_trabajador_id
left join lateral (
  select sum(x.precio_unitario * x.cantidad) as total, sum(x.cantidad) as piezas,
         string_agg(x.cantidad || ' ' || x.nombre, ', ' order by x.nombre) as detalle
  from public.comedor_pedido_lineas x where x.pedido_id = p.id
) l on true;
grant select on public.v_comedor_pedidos to authenticated;

-- 7. Funciones -----------------------------------------------------------------
-- Pedir (o cambiar el pedido del día): reemplaza los renglones.
create or replace function public.fn_comedor_pedir(p_fecha date, p_lineas jsonb, p_nota text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_perfil public.profiles%rowtype;
  v_personal uuid;
  v_cfg public.comedor_config%rowtype;
  v_pedido uuid;
  v_estado text;
  v_limite timestamptz;
  r record;
  v_n int := 0;
begin
  select * into v_perfil from public.profiles where id = v_uid;
  if v_perfil.id is null or v_perfil.rol = 'pendiente' then raise exception 'Tu cuenta no tiene acceso todavía' using errcode = '42501'; end if;
  if not ('comedor' = any (public.auth_modulos_habilitados())) then raise exception 'El comedor no está disponible para tu organización' using errcode = '42501'; end if;
  select * into v_cfg from public.comedor_config where grupo_id = v_perfil.grupo_id;
  if v_cfg.grupo_id is null then raise exception 'Tu organización no tiene comedor configurado'; end if;
  select id into v_personal from public.personal where profile_id = v_uid and activo order by created_at desc limit 1;
  if v_personal is null then raise exception 'Para pedir a descuento de nómina necesitas tu expediente activo en RH. Pídele a RH que lo ligue a tu cuenta.'; end if;

  v_limite := (p_fecha + v_cfg.hora_limite) at time zone 'America/Mexico_City';
  if now() > v_limite then raise exception 'Ya pasó la hora límite para pedir del %', to_char(p_fecha, 'DD/MM/YYYY'); end if;

  select id, estado into v_pedido, v_estado from public.comedor_pedidos where profile_id = v_uid and fecha = p_fecha;
  if v_estado = 'entregado' then raise exception 'Tu pedido de ese día ya se entregó'; end if;

  if v_pedido is null then
    insert into public.comedor_pedidos (empresa_id, fecha, profile_id, personal_id, empresa_trabajador_id, trabajador_nombre, nota)
    values (v_cfg.empresa_id, p_fecha, v_uid, v_personal, v_perfil.empresa_id, v_perfil.nombre, nullif(btrim(coalesce(p_nota, '')), ''))
    returning id into v_pedido;
  else
    update public.comedor_pedidos set estado = 'pedido', nota = nullif(btrim(coalesce(p_nota, '')), ''), updated_at = now() where id = v_pedido;
    delete from public.comedor_pedido_lineas where pedido_id = v_pedido;
  end if;

  for r in
    select (x ->> 'platillo_id')::uuid as platillo_id, coalesce((x ->> 'cantidad')::int, 1) as cantidad
    from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) x
  loop
    if r.cantidad is null or r.cantidad <= 0 then continue; end if;
    insert into public.comedor_pedido_lineas (pedido_id, platillo_id, nombre, precio_unitario, cantidad)
    select v_pedido, pl.id, pl.nombre, pl.precio, r.cantidad
    from public.comedor_platillos pl
    join public.comedor_menu m on m.platillo_id = pl.id and m.fecha = p_fecha
    where pl.id = r.platillo_id and pl.activo and pl.empresa_id = v_cfg.empresa_id;
    if not found then raise exception 'Un platillo ya no está en el menú de ese día'; end if;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Elige al menos un platillo'; end if;

  -- Cupo por platillo (si la cocina lo puso).
  if exists (
    select 1 from public.comedor_menu m
    where m.fecha = p_fecha and m.cupo is not null and m.empresa_id = v_cfg.empresa_id
      and (select coalesce(sum(l.cantidad), 0) from public.comedor_pedido_lineas l join public.comedor_pedidos p on p.id = l.pedido_id
           where l.platillo_id = m.platillo_id and p.fecha = p_fecha and p.estado <> 'cancelado') > m.cupo
  ) then
    raise exception 'Se acabó el cupo de un platillo; elige otro';
  end if;
  return v_pedido;
end;
$$;

create or replace function public.fn_comedor_cancelar(p_pedido uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_p public.comedor_pedidos%rowtype;
  v_limite timestamptz;
begin
  select * into v_p from public.comedor_pedidos where id = p_pedido;
  if v_p.id is null then raise exception 'Pedido no encontrado'; end if;
  if v_p.estado = 'entregado' then raise exception 'Ese pedido ya se entregó'; end if;
  if v_p.profile_id = (select auth.uid()) then
    select (v_p.fecha + c.hora_limite) at time zone 'America/Mexico_City' into v_limite
    from public.comedor_config c where c.empresa_id = v_p.empresa_id;
    if now() > v_limite then raise exception 'Ya pasó la hora límite; pide a la cocina que lo cancele'; end if;
  elsif not public.auth_opera_comedor() then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update public.comedor_pedidos set estado = 'cancelado', updated_at = now() where id = p_pedido;
end;
$$;

-- Cocina: entregado (o regresar a pedido si se equivocó).
create or replace function public.fn_comedor_entregar(p_pedido uuid, p_entregado boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_p public.comedor_pedidos%rowtype;
begin
  if not public.auth_opera_comedor() then raise exception 'Solo la cocina marca entregas' using errcode = '42501'; end if;
  select * into v_p from public.comedor_pedidos where id = p_pedido;
  if v_p.id is null or not (v_p.empresa_id = any (public.auth_empresas_organizacion())) then raise exception 'Pedido no encontrado'; end if;
  if v_p.estado = 'cancelado' then raise exception 'Ese pedido está cancelado'; end if;
  if v_p.descuento_aplicado_en is not null then raise exception 'Ese pedido ya se descontó en nómina'; end if;
  update public.comedor_pedidos
     set estado = case when p_entregado then 'entregado' else 'pedido' end,
         entregado_en = case when p_entregado then now() end,
         entregado_por = case when p_entregado then (select auth.uid()) end,
         updated_at = now()
   where id = p_pedido;
end;
$$;

-- Nómina: marca como aplicados los entregados de un periodo (por empresa del trabajador).
create or replace function public.fn_comedor_aplicar_descuento(p_desde date, p_hasta date, p_empresa_trabajador uuid, p_referencia text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.auth_ve_nomina_comedor() then raise exception 'Solo RH o finanzas aplican descuentos de nómina' using errcode = '42501'; end if;
  if not (p_empresa_trabajador = any (public.auth_empresas_organizacion())) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  update public.comedor_pedidos
     set descuento_aplicado_en = now(), descuento_aplicado_por = (select auth.uid()),
         descuento_referencia = nullif(btrim(coalesce(p_referencia, '')), ''), updated_at = now()
   where estado = 'entregado' and descuento_aplicado_en is null
     and empresa_trabajador_id = p_empresa_trabajador and fecha between p_desde and p_hasta;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.fn_comedor_pedir(date, jsonb, text) from public, anon;
revoke all on function public.fn_comedor_cancelar(uuid) from public, anon;
revoke all on function public.fn_comedor_entregar(uuid, boolean) from public, anon;
revoke all on function public.fn_comedor_aplicar_descuento(date, date, uuid, text) from public, anon;
grant execute on function public.fn_comedor_pedir(date, jsonb, text), public.fn_comedor_cancelar(uuid),
  public.fn_comedor_entregar(uuid, boolean), public.fn_comedor_aplicar_descuento(date, date, uuid, text),
  public.auth_opera_comedor(), public.auth_ve_nomina_comedor() to authenticated;
