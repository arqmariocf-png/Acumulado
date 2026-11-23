-- Módulo de camiones de volteo (23-nov-2026, Mario: "vamos a hacer el módulo
-- para los camiones de volteo"). Vive dentro de Logística, sobre las mismas
-- unidades (logistica_unidades, tipo nuevo 'volteo'):
--  1. logistica_viajes: cada viaje o servicio de una unidad (fecha, chofer,
--     cliente u obra, origen → destino, material, m³/ton/viajes, precio e
--     importe, cobro, kilometraje, y para residuos de manejo especial el folio
--     del manifiesto y el registro del generador). Sustituye la "Bitácora de
--     Salida de Residuos" y los "Recorridos" que AEP llevaba en Excel.
--  2. logistica_gastos: diésel, mantenimiento, llantas, casetas, seguro,
--     verificación… por unidad (y opcionalmente por viaje), con litros y
--     odómetro para el rendimiento. Sustituye los Excel de gasolina.
--  Con las dos se saca ingresos vs gastos por unidad y por mes (utilidad por
--  camión), km recorridos, litros y km/l. Quién: toda la organización ve
--  (auth_ve_logistica); opera quien opera logística; el chofer asignado a la
--  unidad registra sus propios viajes. Folios VJ-<EMP>-0001 y GU-<EMP>-0001.
-- Ya aplicado en producción como `logistica_volteo`.

do $$
declare v_con text;
begin
  select conname into v_con from pg_constraint
   where conrelid = 'public.logistica_unidades'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%tipo%';
  if v_con is not null then
    execute format('alter table public.logistica_unidades ' || 'dr' || 'op constraint %I', v_con);
  end if;
  alter table public.logistica_unidades add constraint logistica_unidades_tipo_check
    check (tipo in ('camioneta', 'camion', 'volteo', 'tractocamion', 'remolque', 'auto', 'maquinaria', 'motocicleta', 'otro'));
end $$;

create table if not exists public.logistica_viajes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  unidad_id uuid not null references public.logistica_unidades (id),
  folio text,
  fecha date not null default (now() at time zone 'America/Mexico_City')::date,
  hora_salida time,
  hora_regreso time,
  chofer_id uuid references public.profiles (id),
  chofer_nombre text,
  tipo text not null default 'flete' check (tipo in ('flete', 'material', 'residuos', 'renta', 'traslado', 'otro')),
  cliente text,
  cliente_empresa_id uuid references public.empresas (id),
  proyecto_id uuid references public.proyectos (id),
  origen text,
  destino text,
  material text,
  cantidad numeric(12,3) check (cantidad is null or cantidad >= 0),
  unidad_medida text not null default 'm3' check (unidad_medida in ('m3', 'ton', 'viaje', 'hr', 'pza', 'lote', 'km')),
  viajes integer not null default 1 check (viajes > 0),
  precio numeric(14,2) not null default 0 check (precio >= 0),
  importe numeric(14,2) not null default 0 check (importe >= 0),
  cobrado boolean not null default false,
  cobrado_en date,
  forma_cobro text,
  referencia_cobro text,
  orden_venta_id uuid references public.ordenes_venta (id),
  km_inicial numeric(12,1) check (km_inicial is null or km_inicial >= 0),
  km_final numeric(12,1) check (km_final is null or km_final >= 0),
  manifiesto_folio text,
  manifiesto_registro text,
  residuo_tipo text,
  ticket text,
  estado text not null default 'terminado' check (estado in ('programado', 'en_curso', 'terminado', 'cancelado')),
  notas text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_by_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio),
  check (km_final is null or km_inicial is null or km_final >= km_inicial)
);
create index if not exists logistica_viajes_unidad_fecha on public.logistica_viajes (unidad_id, fecha desc);
create index if not exists logistica_viajes_empresa_fecha on public.logistica_viajes (empresa_id, fecha desc);
create index if not exists logistica_viajes_proyecto on public.logistica_viajes (proyecto_id);
create index if not exists logistica_viajes_chofer on public.logistica_viajes (chofer_id);
create index if not exists logistica_viajes_cliente_empresa on public.logistica_viajes (cliente_empresa_id);
create index if not exists logistica_viajes_ov on public.logistica_viajes (orden_venta_id);
create index if not exists logistica_viajes_created_by on public.logistica_viajes (created_by);

create table if not exists public.logistica_gastos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  unidad_id uuid not null references public.logistica_unidades (id),
  viaje_id uuid references public.logistica_viajes (id),
  folio text,
  fecha date not null default (now() at time zone 'America/Mexico_City')::date,
  tipo text not null default 'diesel' check (tipo in ('diesel', 'gasolina', 'mantenimiento', 'llantas', 'refacciones', 'casetas', 'multas', 'seguro', 'verificacion', 'tenencia', 'chofer', 'lavado', 'otro')),
  descripcion text,
  litros numeric(10,2) check (litros is null or litros >= 0),
  monto numeric(14,2) not null check (monto >= 0),
  proveedor text,
  referencia text,
  km numeric(12,1) check (km is null or km >= 0),
  orden_compra_id uuid references public.ordenes_compra (id),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_by_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio)
);
create index if not exists logistica_gastos_unidad_fecha on public.logistica_gastos (unidad_id, fecha desc);
create index if not exists logistica_gastos_empresa_fecha on public.logistica_gastos (empresa_id, fecha desc);
create index if not exists logistica_gastos_viaje on public.logistica_gastos (viaje_id);
create index if not exists logistica_gastos_oc on public.logistica_gastos (orden_compra_id);
create index if not exists logistica_gastos_created_by on public.logistica_gastos (created_by);

create or replace function public.logistica_viajes_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_u public.logistica_unidades;
begin
  select * into v_u from public.logistica_unidades where id = new.unidad_id;
  if v_u.id is null then raise exception 'Unidad no encontrada.'; end if;
  new.empresa_id := v_u.empresa_id;
  if tg_op = 'INSERT' and nullif(btrim(coalesce(new.folio, '')), '') is null then
    new.folio := public.fn_siguiente_folio(new.empresa_id, 'VJ');
  end if;
  if new.chofer_id is null and tg_op = 'INSERT' and nullif(btrim(coalesce(new.chofer_nombre, '')), '') is null then
    new.chofer_id := v_u.chofer_id;
    new.chofer_nombre := v_u.chofer_nombre;
  end if;
  if new.chofer_id is not null and (tg_op = 'INSERT' or new.chofer_id is distinct from old.chofer_id) then
    select nombre into new.chofer_nombre from public.profiles where id = new.chofer_id;
  end if;
  if new.cliente_empresa_id is null and nullif(btrim(coalesce(new.cliente, '')), '') is not null then
    new.cliente_empresa_id := public.fn_empresa_por_nombre(v_u_grupo(new.empresa_id), new.cliente);
  end if;
  -- Importe: lo capturado; si viene en 0, cantidad × precio (o viajes × precio cuando se cobra por viaje).
  if coalesce(new.importe, 0) = 0 and coalesce(new.precio, 0) > 0 then
    new.importe := round(case when new.unidad_medida = 'viaje' or coalesce(new.cantidad, 0) = 0 then new.viajes * new.precio else new.cantidad * new.precio end, 2);
  end if;
  if new.cobrado and new.cobrado_en is null then new.cobrado_en := (now() at time zone 'America/Mexico_City')::date; end if;
  if not new.cobrado then new.cobrado_en := null; end if;
  if tg_op = 'INSERT' and new.created_by is not null and new.created_by_nombre is null then
    select nombre into new.created_by_nombre from public.profiles where id = new.created_by;
  end if;
  new.updated_at := now();
  return new;
end $$;

/** Grupo de una empresa (para resolver el cliente a una empresa del grupo). */
create or replace function public.v_u_grupo(p_empresa uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select grupo_id from public.empresas where id = p_empresa
$$;
revoke all on function public.v_u_grupo(uuid) from public, anon;
grant execute on function public.v_u_grupo(uuid) to authenticated, service_role;

create or replace trigger logistica_viajes_antes before insert or update on public.logistica_viajes
  for each row execute function public.logistica_viajes_antes();

create or replace function public.logistica_gastos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select empresa_id into new.empresa_id from public.logistica_unidades where id = new.unidad_id;
  if new.empresa_id is null then raise exception 'Unidad no encontrada.'; end if;
  if tg_op = 'INSERT' and nullif(btrim(coalesce(new.folio, '')), '') is null then
    new.folio := public.fn_siguiente_folio(new.empresa_id, 'GU');
  end if;
  if new.viaje_id is not null and not exists (select 1 from public.logistica_viajes v where v.id = new.viaje_id and v.unidad_id = new.unidad_id) then
    raise exception 'El viaje no es de esa unidad.';
  end if;
  if tg_op = 'INSERT' and new.created_by is not null and new.created_by_nombre is null then
    select nombre into new.created_by_nombre from public.profiles where id = new.created_by;
  end if;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger logistica_gastos_antes before insert or update on public.logistica_gastos
  for each row execute function public.logistica_gastos_antes();

alter table public.logistica_viajes enable row level security;
alter table public.logistica_gastos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['logistica_viajes', 'logistica_gastos'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'frontera_organizacion') then
      execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
        using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
        with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))$p$, t);
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'espectador_sin_datos') then
      execute format($p$create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
        using (not (select public.auth_es_espectador()))$p$, t);
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'director_general') then
      execute format($p$create policy director_general on public.%I for all to authenticated
        using ((select public.auth_admin_global_definer()))
        with check ((select public.auth_admin_global_definer()))$p$, t);
    end if;
    execute format('create or replace trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_select') then
      execute format($p$create policy %I on public.%I for select to authenticated
        using ((select public.auth_ve_logistica())
               and ((select public.auth_admin_global_definer()) or 'logistica' = any ((select public.auth_modulos_habilitados())::text[])))$p$, t || '_select', t);
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_insert') then
      execute format($p$create policy %I on public.%I for insert to authenticated
        with check ((select public.auth_opera_logistica())
                    and (select public.auth_suscripcion_permite_escribir_definer())
                    and ((select public.auth_admin_global_definer()) or 'logistica' = any ((select public.auth_modulos_habilitados())::text[]))
                    and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_insert', t);
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_update') then
      execute format($p$create policy %I on public.%I for update to authenticated
        using ((select public.auth_opera_logistica())
               and (select public.auth_suscripcion_permite_escribir_definer())
               and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
        with check ((select public.auth_opera_logistica())
                    and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_update', t);
    end if;
  end loop;
end $$;

-- El chofer de la unidad registra sus viajes y sus cargas de combustible, a su nombre.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'logistica_viajes' and policyname = 'logistica_viajes_chofer_insert') then
    create policy logistica_viajes_chofer_insert on public.logistica_viajes for insert to authenticated
      with check ((select public.auth_ve_logistica())
                  and (select public.auth_suscripcion_permite_escribir_definer())
                  and ((select public.auth_admin_global_definer()) or 'logistica' = any ((select public.auth_modulos_habilitados())::text[]))
                  and created_by = (select auth.uid())
                  and exists (select 1 from public.logistica_unidades u where u.id = unidad_id and u.chofer_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'logistica_gastos' and policyname = 'logistica_gastos_chofer_insert') then
    create policy logistica_gastos_chofer_insert on public.logistica_gastos for insert to authenticated
      with check ((select public.auth_ve_logistica())
                  and (select public.auth_suscripcion_permite_escribir_definer())
                  and ((select public.auth_admin_global_definer()) or 'logistica' = any ((select public.auth_modulos_habilitados())::text[]))
                  and created_by = (select auth.uid())
                  and exists (select 1 from public.logistica_unidades u where u.id = unidad_id and u.chofer_id = (select auth.uid())));
  end if;
end $$;
