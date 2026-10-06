-- Equipo de protección personal (EPP) desde RH (Mario con Raúl, 5-oct-2026:
-- "RH lo solicita, no necesariamente es para una obra aunque el gasto sí se
-- impacta a la obra que corresponde; carta a la persona porque es equipo que
-- se regresa o se sustituye por vigencia"). Decisiones de Mario: el equipo
-- sale de bodega o, si no hay, se compra (requisición normal); RH elige la
-- obra a la que se carga; lo que no se regresa se descuenta vía nómina.
--
--   * epp_asignaciones: una entrega a UNA persona (personal_id), folio
--     EPP-<empresa>-0001, obra a la que se carga (proyecto_id; para lo que no
--     es de obra existen proyectos "Corporativo …"), empresa = la de la obra,
--     requisición de compra ligada si se pidió.
--   * epp_asignacion_lineas: cada pieza (descripción, talla, cantidad, costo,
--     vigencia en meses, origen bodega/compra). Estados: por_surtir →
--     entregado → devuelto | sustituido | perdido. vence_el = entrega +
--     vigencia (trigger). Perdido / no regresado → descuento_monto, y RH marca
--     descuento_aplicado_en cuando se aplica en nómina.
--   * fn_epp_pedir_compra(asignacion): crea la requisición en la obra elegida
--     con las piezas "compra" pendientes (RH no tiene permiso directo de
--     requisiciones); Alma la resuelve como cualquier otra.
-- Operan RH y admin (auth_opera_epp); almacén ve las de su alcance.
--
-- Ya aplicado en producción.

create or replace function public.auth_opera_epp()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol in ('rh', 'admin') and not p.espectador)
$$;
grant execute on function public.auth_opera_epp() to authenticated;

create table if not exists public.epp_asignaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  proyecto_id uuid not null references public.proyectos(id),
  personal_id uuid not null references public.personal(id),
  folio text,
  requisicion_id uuid references public.requisiciones(id) on delete set null,
  estatus text not null default 'abierta' check (estatus in ('abierta', 'cerrada', 'cancelada')),
  notas text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio)
);
create index if not exists epp_asignaciones_personal_idx on public.epp_asignaciones (personal_id);
create index if not exists epp_asignaciones_proyecto_idx on public.epp_asignaciones (proyecto_id);
create index if not exists epp_asignaciones_requisicion_idx on public.epp_asignaciones (requisicion_id);

create table if not exists public.epp_asignacion_lineas (
  id uuid primary key default gen_random_uuid(),
  asignacion_id uuid not null references public.epp_asignaciones(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id),
  descripcion text not null check (length(trim(descripcion)) > 0),
  talla text,
  cantidad numeric(12,2) not null default 1 check (cantidad > 0),
  unidad text not null default 'pza',
  costo_unitario numeric(14,2) not null default 0 check (costo_unitario >= 0),
  vigencia_meses integer check (vigencia_meses is null or vigencia_meses > 0),
  origen text not null default 'bodega' check (origen in ('bodega', 'compra')),
  estado text not null default 'por_surtir' check (estado in ('por_surtir', 'entregado', 'devuelto', 'sustituido', 'perdido')),
  entregado_en date,
  vence_el date,
  devuelto_en date,
  devolucion_condicion text check (devolucion_condicion in ('buena', 'danada')),
  descuento_monto numeric(14,2) check (descuento_monto is null or descuento_monto >= 0),
  descuento_aplicado_en date,
  sustituye_a uuid references public.epp_asignacion_lineas(id) on delete set null,
  nota text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists epp_lineas_asignacion_idx on public.epp_asignacion_lineas (asignacion_id);
create index if not exists epp_lineas_empresa_idx on public.epp_asignacion_lineas (empresa_id);
create index if not exists epp_lineas_sustituye_idx on public.epp_asignacion_lineas (sustituye_a);
create index if not exists epp_lineas_vence_idx on public.epp_asignacion_lineas (vence_el) where estado = 'entregado';

create or replace function public.epp_asignaciones_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.empresa_id into new.empresa_id from public.proyectos p where p.id = new.proyecto_id;
  if new.empresa_id is null then raise exception 'La obra no existe.'; end if;
  if tg_op = 'INSERT' and nullif(trim(new.folio), '') is null then
    new.folio := public.fn_siguiente_folio(new.empresa_id, 'EPP');
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists epp_asignaciones_antes on public.epp_asignaciones;
create trigger epp_asignaciones_antes before insert or update on public.epp_asignaciones
  for each row execute function public.epp_asignaciones_antes();

-- La línea hereda la empresa de su asignación; al entregar se calcula la
-- vigencia; al perderse se propone el descuento (cantidad × costo).
create or replace function public.epp_lineas_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select a.empresa_id into new.empresa_id from public.epp_asignaciones a where a.id = new.asignacion_id;
  if new.estado in ('entregado', 'devuelto', 'sustituido', 'perdido') and new.entregado_en is null then
    new.entregado_en := current_date;
  end if;
  if new.entregado_en is not null and new.vigencia_meses is not null then
    new.vence_el := (new.entregado_en + make_interval(months => new.vigencia_meses))::date;
  else
    new.vence_el := null;
  end if;
  if new.estado in ('devuelto', 'sustituido') and new.devuelto_en is null then new.devuelto_en := current_date; end if;
  if new.estado = 'perdido' and new.descuento_monto is null then new.descuento_monto := round(new.cantidad * new.costo_unitario, 2); end if;
  if new.estado <> 'perdido' then new.descuento_monto := null; new.descuento_aplicado_en := null; end if;
  if tg_op = 'UPDATE' and old.descuento_aplicado_en is not null
     and (new.descuento_monto is distinct from old.descuento_monto or new.estado <> 'perdido') then
    raise exception 'El descuento ya se aplicó en nómina; no se cambia.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists epp_lineas_antes on public.epp_asignacion_lineas;
create trigger epp_lineas_antes before insert or update on public.epp_asignacion_lineas
  for each row execute function public.epp_lineas_antes();

-- RLS ------------------------------------------------------------------------
alter table public.epp_asignaciones enable row level security;
alter table public.epp_asignacion_lineas enable row level security;

do $$
declare t text;
begin
  foreach t in array array['epp_asignaciones', 'epp_asignacion_lineas'] loop
    execute format('drop policy if exists frontera_organizacion on public.%I', t);
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
      with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))$p$, t);
    execute format('drop policy if exists espectador_sin_datos on public.%I', t);
    execute format($p$create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()))$p$, t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using ((select public.auth_opera_epp())
             or ((select public.auth_rol_definer()) = 'almacen'
                 and empresa_id = any ((select public.auth_empresas_alcance())::uuid[])))$p$, t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check ((select public.auth_opera_epp()) and (select public.auth_suscripcion_permite_escribir_definer()))$p$, t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using ((select public.auth_opera_epp()) and (select public.auth_suscripcion_permite_escribir_definer()))
      with check ((select public.auth_opera_epp()) and (select public.auth_suscripcion_permite_escribir_definer()))$p$, t || '_update', t);
    execute format('drop policy if exists director_general on public.%I', t);
    execute format($p$create policy director_general on public.%I for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()))$p$, t);
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Borrar: solo lo que sigue por surtir y sin requisición de compra.
drop policy if exists epp_asignaciones_delete on public.epp_asignaciones;
create policy epp_asignaciones_delete on public.epp_asignaciones for delete to authenticated
  using ((select public.auth_opera_epp()) and (select public.auth_suscripcion_permite_escribir_definer())
         and requisicion_id is null
         and not exists (select 1 from public.epp_asignacion_lineas l where l.asignacion_id = epp_asignaciones.id and l.estado <> 'por_surtir'));
drop policy if exists epp_asignacion_lineas_delete on public.epp_asignacion_lineas;
create policy epp_asignacion_lineas_delete on public.epp_asignacion_lineas for delete to authenticated
  using ((select public.auth_opera_epp()) and (select public.auth_suscripcion_permite_escribir_definer())
         and estado = 'por_surtir');

-- Pedir a compras ------------------------------------------------------------
create or replace function public.fn_epp_pedir_compra(p_asignacion uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_a public.epp_asignaciones;
  v_persona text;
  v_req uuid;
  v_n int;
begin
  if not public.auth_opera_epp() then raise exception 'Solo RH pide equipo de protección.' using errcode = '42501'; end if;
  select * into v_a from public.epp_asignaciones where id = p_asignacion for update;
  if v_a.id is null or not (v_a.empresa_id = any (public.auth_empresas_organizacion())) then
    raise exception 'Asignación no encontrada.';
  end if;
  if v_a.requisicion_id is not null then raise exception 'Esta entrega ya tiene requisición de compra.'; end if;
  select count(*) into v_n from public.epp_asignacion_lineas where asignacion_id = p_asignacion and origen = 'compra' and estado = 'por_surtir';
  if v_n = 0 then raise exception 'No hay piezas marcadas para comprar.'; end if;
  select nombre into v_persona from public.personal where id = v_a.personal_id;

  insert into public.requisiciones (proyecto_id, empresa_id, solicitado_por, comentario)
  values (v_a.proyecto_id, v_a.empresa_id, auth.uid(),
          'EPP ' || coalesce(v_a.folio, '') || ' para ' || coalesce(v_persona, '') || ' (RH)')
  returning id into v_req;
  insert into public.requisicion_lineas (requisicion_id, descripcion, cantidad_solicitada, unidad_medida)
  select v_req, 'EPP: ' || l.descripcion || coalesce(' talla ' || nullif(trim(l.talla), ''), ''), l.cantidad, l.unidad
  from public.epp_asignacion_lineas l
  where l.asignacion_id = p_asignacion and l.origen = 'compra' and l.estado = 'por_surtir'
  order by l.created_at;
  update public.epp_asignaciones set requisicion_id = v_req where id = p_asignacion;
  return v_req;
end;
$$;
revoke all on function public.fn_epp_pedir_compra(uuid) from public, anon;
grant execute on function public.fn_epp_pedir_compra(uuid) to authenticated;
