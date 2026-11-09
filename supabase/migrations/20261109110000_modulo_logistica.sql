-- Módulo de logística (9-nov-2026, Mario: "agreguemos también el módulo de
-- logística donde cargaremos las unidades consultadas en el calendario de
-- reservas; va a poner el API del sistema actual de reservas, y ahí vamos a
-- reportar averías").
--
--   * logistica_unidades: la flotilla por empresa (folio UN-<emp>-0001,
--     tipo, placas, chofer habitual, estado activa / taller / baja,
--     `externo_id` = id de la unidad en el sistema de reservas).
--   * logistica_reservas: cada reserva de una unidad (desde/hasta, destino,
--     obra, chofer, estado). Hoy se capturan a mano; cuando Mario dé el API
--     del sistema de reservas, la sincronización las insertará con
--     origen 'api' y `externo_id` único (sin duplicar), igual que el CRM.
--     Un trigger impide encimar dos reservas vivas de la misma unidad.
--   * logistica_averias: reporte de avería por unidad (folio AV-<emp>-0001,
--     gravedad, kilometraje, quién reportó, estado abierta → en_taller →
--     resuelta | descartada, costo). Una avería grave abierta pone la unidad
--     en 'taller'; al resolverla regresa a 'activa'. Al reportar, push a
--     quien opera logística y a dirección.
-- Ve: cualquiera de la organización que no sea pendiente ni espectador
-- (`auth_ve_logistica`). Reporta averías: cualquiera que ve. Opera (alta de
-- unidades, reservas, atender averías): admin, corporativo, dirección,
-- empresa, almacén o permiso por persona 'logistica'
-- (`auth_opera_logistica`). Módulo 'logistica' abierto a LOMA.
-- Ya aplicado en producción (modulo_logistica_1_tablas, _2_policies).

insert into public.modulos (clave, nombre, descripcion, orden)
select 'logistica', 'Logística', 'Unidades, calendario de reservas y averías', 60
where not exists (select 1 from public.modulos where clave = 'logistica');

insert into public.grupo_modulos (grupo_id, modulo_clave, habilitado, habilitado_at)
select g.id, 'logistica', g.codigo = 'LOMA', case when g.codigo = 'LOMA' then now() end
from public.grupos g
where not exists (select 1 from public.grupo_modulos gm where gm.grupo_id = g.id and gm.modulo_clave = 'logistica');

alter table public.permisos_modulo drop constraint if exists permisos_modulo_modulo_check;
alter table public.permisos_modulo add constraint permisos_modulo_modulo_check check (modulo = any (array[
  'inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva', 'comedor', 'legal',
  'checador', 'contabilidad', 'tesoreria', 'punto_venta', 'compras', 'cotizador', 'herramienta', 'cumplimiento', 'caja', 'logistica']));

create or replace function public.auth_opera_logistica()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.activo and not coalesce(p.espectador, false)
       and (p.rol in ('admin', 'corporativo', 'direccion', 'empresa', 'almacen')
            or exists (select 1 from public.permisos_modulo m where m.profile_id = p.id and m.modulo = 'logistica')))
$$;
grant execute on function public.auth_opera_logistica() to authenticated;

create or replace function public.auth_ve_logistica()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.activo and p.rol <> 'pendiente' and not coalesce(p.espectador, false))
$$;
grant execute on function public.auth_ve_logistica() to authenticated;

-- A quién avisar de una avería: quien opera logística por permiso y dirección.
create or replace function public.fn_logistica_de(p_grupo uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct p.id), '{}'::uuid[]) from public.profiles p
   where p.grupo_id = p_grupo and p.activo and not coalesce(p.espectador, false)
     and (p.rol = 'direccion'
          or exists (select 1 from public.permisos_modulo m where m.profile_id = p.id and m.modulo = 'logistica'))
$$;
revoke all on function public.fn_logistica_de(uuid) from public, anon, authenticated;

create table if not exists public.logistica_unidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  folio text,
  nombre text not null check (btrim(nombre) <> ''),
  tipo text not null default 'camioneta' check (tipo in ('camioneta', 'camion', 'tractocamion', 'remolque', 'auto', 'maquinaria', 'motocicleta', 'otro')),
  marca text,
  modelo text,
  anio integer check (anio is null or (anio between 1950 and 2100)),
  placas text,
  numero_serie text,
  capacidad text,
  chofer_id uuid references public.profiles (id),
  chofer_nombre text,
  estado text not null default 'activa' check (estado in ('activa', 'taller', 'baja')),
  externo_id text,
  notas text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio)
);
create index if not exists logistica_unidades_empresa_idx on public.logistica_unidades (empresa_id);
create index if not exists logistica_unidades_chofer_idx on public.logistica_unidades (chofer_id);
create index if not exists logistica_unidades_created_by_idx on public.logistica_unidades (created_by);
create unique index if not exists logistica_unidades_externo_idx on public.logistica_unidades (externo_id) where externo_id is not null;

create table if not exists public.logistica_reservas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  unidad_id uuid not null references public.logistica_unidades (id),
  desde timestamptz not null,
  hasta timestamptz not null,
  titulo text not null check (btrim(titulo) <> ''),
  destino text,
  proyecto_id uuid references public.proyectos (id),
  cliente text,
  chofer_id uuid references public.profiles (id),
  chofer_nombre text,
  estado text not null default 'programada' check (estado in ('programada', 'en_curso', 'terminada', 'cancelada')),
  origen text not null default 'manual' check (origen in ('manual', 'api')),
  externo_id text,
  notas text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (hasta > desde)
);
create index if not exists logistica_reservas_unidad_idx on public.logistica_reservas (unidad_id, desde);
create index if not exists logistica_reservas_empresa_idx on public.logistica_reservas (empresa_id, desde);
create index if not exists logistica_reservas_proyecto_idx on public.logistica_reservas (proyecto_id);
create index if not exists logistica_reservas_chofer_idx on public.logistica_reservas (chofer_id);
create index if not exists logistica_reservas_created_by_idx on public.logistica_reservas (created_by);
create unique index if not exists logistica_reservas_externo_idx on public.logistica_reservas (externo_id) where externo_id is not null;

create table if not exists public.logistica_averias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  unidad_id uuid not null references public.logistica_unidades (id),
  reserva_id uuid references public.logistica_reservas (id),
  folio text,
  fecha date not null default current_date,
  descripcion text not null check (btrim(descripcion) <> ''),
  gravedad text not null default 'media' check (gravedad in ('leve', 'media', 'grave')),
  kilometraje numeric(12, 1) check (kilometraje is null or kilometraje >= 0),
  reportado_por uuid references public.profiles (id) default auth.uid(),
  reportante_nombre text,
  estado text not null default 'abierta' check (estado in ('abierta', 'en_taller', 'resuelta', 'descartada')),
  resuelto_en timestamptz,
  resuelto_por uuid references public.profiles (id),
  resolucion text,
  costo numeric(14, 2) check (costo is null or costo >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio)
);
create index if not exists logistica_averias_unidad_idx on public.logistica_averias (unidad_id, fecha desc);
create index if not exists logistica_averias_empresa_idx on public.logistica_averias (empresa_id, estado);
create index if not exists logistica_averias_reserva_idx on public.logistica_averias (reserva_id);
create index if not exists logistica_averias_reportado_idx on public.logistica_averias (reportado_por);
create index if not exists logistica_averias_resuelto_idx on public.logistica_averias (resuelto_por);

-- Folios, nombres y candados ---------------------------------------------------
create or replace function public.logistica_unidades_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.nombre := btrim(new.nombre);
  new.placas := nullif(upper(regexp_replace(coalesce(new.placas, ''), '[^A-Za-z0-9]', '', 'g')), '');
  if tg_op = 'INSERT' and nullif(btrim(coalesce(new.folio, '')), '') is null then
    new.folio := public.fn_siguiente_folio(new.empresa_id, 'UN');
  end if;
  if new.chofer_id is not null and (tg_op = 'INSERT' or new.chofer_id is distinct from old.chofer_id) then
    select nombre into new.chofer_nombre from public.profiles where id = new.chofer_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists logistica_unidades_antes on public.logistica_unidades;
create trigger logistica_unidades_antes before insert or update on public.logistica_unidades
  for each row execute function public.logistica_unidades_antes();

create or replace function public.logistica_reservas_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_choque text;
begin
  new.titulo := btrim(new.titulo);
  select empresa_id into new.empresa_id from public.logistica_unidades where id = new.unidad_id;
  if new.empresa_id is null then raise exception 'Unidad no encontrada.'; end if;
  if new.chofer_id is not null and (tg_op = 'INSERT' or new.chofer_id is distinct from old.chofer_id) then
    select nombre into new.chofer_nombre from public.profiles where id = new.chofer_id;
  end if;
  if new.estado <> 'cancelada' then
    select r.titulo || ' (' || to_char(r.desde at time zone 'America/Mexico_City', 'DD/MM HH24:MI') || ' a ' || to_char(r.hasta at time zone 'America/Mexico_City', 'DD/MM HH24:MI') || ')'
      into v_choque
      from public.logistica_reservas r
     where r.unidad_id = new.unidad_id and r.id <> new.id and r.estado <> 'cancelada'
       and r.desde < new.hasta and r.hasta > new.desde
     limit 1;
    if v_choque is not null then
      raise exception 'La unidad ya está reservada en ese horario: %', v_choque;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists logistica_reservas_antes on public.logistica_reservas;
create trigger logistica_reservas_antes before insert or update on public.logistica_reservas
  for each row execute function public.logistica_reservas_antes();

create or replace function public.logistica_averias_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.descripcion := btrim(new.descripcion);
  select empresa_id into new.empresa_id from public.logistica_unidades where id = new.unidad_id;
  if new.empresa_id is null then raise exception 'Unidad no encontrada.'; end if;
  if tg_op = 'INSERT' then
    if nullif(btrim(coalesce(new.folio, '')), '') is null then
      new.folio := public.fn_siguiente_folio(new.empresa_id, 'AV');
    end if;
    if new.reportado_por is not null and new.reportante_nombre is null then
      select nombre into new.reportante_nombre from public.profiles where id = new.reportado_por;
    end if;
  end if;
  if new.estado in ('resuelta', 'descartada') and (tg_op = 'INSERT' or old.estado not in ('resuelta', 'descartada')) then
    new.resuelto_en := coalesce(new.resuelto_en, now());
    new.resuelto_por := coalesce(new.resuelto_por, auth.uid());
  end if;
  if new.estado in ('abierta', 'en_taller') then
    new.resuelto_en := null;
    new.resuelto_por := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists logistica_averias_antes on public.logistica_averias;
create trigger logistica_averias_antes before insert or update on public.logistica_averias
  for each row execute function public.logistica_averias_antes();

-- La unidad va al taller con una avería grave viva (o en_taller) y regresa a
-- activa cuando no queda ninguna; al reportar, aviso push.
create or replace function public.logistica_averias_despues()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_u public.logistica_unidades;
  v_grupo uuid;
  v_viva boolean;
begin
  select * into v_u from public.logistica_unidades where id = new.unidad_id;
  if v_u.id is null or v_u.estado = 'baja' then return new; end if;
  select exists (
    select 1 from public.logistica_averias a
     where a.unidad_id = new.unidad_id
       and (a.estado = 'en_taller' or (a.estado = 'abierta' and a.gravedad = 'grave'))) into v_viva;
  if v_viva and v_u.estado <> 'taller' then
    update public.logistica_unidades set estado = 'taller' where id = v_u.id;
  elsif not v_viva and v_u.estado = 'taller' then
    update public.logistica_unidades set estado = 'activa' where id = v_u.id;
  end if;
  if tg_op = 'INSERT' then
    select grupo_id into v_grupo from public.empresas where id = new.empresa_id;
    perform public.fn_push_aviso(
      array(select unnest(public.fn_logistica_de(v_grupo)) except select new.reportado_por),
      'Avería reportada · ' || coalesce(v_u.folio, '') || ' ' || v_u.nombre,
      coalesce(new.reportante_nombre, 'Alguien') || ' reportó (' || new.gravedad || '): ' || left(new.descripcion, 140),
      '/logistica?tab=averias');
  end if;
  return new;
end;
$$;
drop trigger if exists logistica_averias_despues on public.logistica_averias;
create trigger logistica_averias_despues after insert or update of estado, gravedad on public.logistica_averias
  for each row execute function public.logistica_averias_despues();

-- RLS -------------------------------------------------------------------------
alter table public.logistica_unidades enable row level security;
alter table public.logistica_reservas enable row level security;
alter table public.logistica_averias enable row level security;

do $$
declare t text;
begin
  foreach t in array array['logistica_unidades', 'logistica_reservas', 'logistica_averias'] loop
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
    execute format('grant select, insert, update on public.%I to authenticated', t);
    -- Ve toda la organización (no pendiente ni espectador), con el módulo abierto.
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format($p$create policy %I_select on public.%I for select to authenticated
      using ((select public.auth_ve_logistica())
             and ((select public.auth_admin_global_definer()) or 'logistica' = any ((select public.auth_modulos_habilitados())::text[])))$p$, t, t);
    -- Opera quien administra logística, en su alcance y con suscripción.
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format($p$create policy %I_insert on public.%I for insert to authenticated
      with check ((select public.auth_opera_logistica())
                  and (select public.auth_suscripcion_permite_escribir_definer())
                  and ((select public.auth_admin_global_definer()) or 'logistica' = any ((select public.auth_modulos_habilitados())::text[]))
                  and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format($p$create policy %I_update on public.%I for update to authenticated
      using ((select public.auth_opera_logistica())
             and (select public.auth_suscripcion_permite_escribir_definer())
             and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
      with check ((select public.auth_opera_logistica())
                  and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t, t);
  end loop;
end $$;

-- Averías: las reporta cualquiera que ve logística (chofer, supervisor…), a su nombre.
drop policy if exists logistica_averias_reportar on public.logistica_averias;
create policy logistica_averias_reportar on public.logistica_averias for insert to authenticated
  with check ((select public.auth_ve_logistica())
              and (select public.auth_suscripcion_permite_escribir_definer())
              and ((select public.auth_admin_global_definer()) or 'logistica' = any ((select public.auth_modulos_habilitados())::text[]))
              and reportado_por = (select auth.uid())
              and estado = 'abierta');
