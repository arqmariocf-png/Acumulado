-- Solicitud de EPP desde obra (21-oct-2026, Mario: "da de alta a los
-- supervisores y revisa que Christian tenga habilitada la solicitud de EPP";
-- eligió "que pidan EPP"). Hasta hoy solo RH/admin operaban el EPP
-- (auth_opera_epp) y nadie más podía pedirlo.
--
--   * auth_solicita_epp(): RH/admin, supervisor, responsable (Christian) o
--     quien es jefe directo de alguien (personal.supervisor_profile_id).
--     Nunca pendiente ni espectador.
--   * epp_solicitudes (folio SE-<empresa>-0001; sin empresa conocida
--     SE-0001 por organización) + epp_solicitud_lineas (pieza, talla,
--     cantidad, unidad). La obra es opcional: al 21-oct ningún supervisor
--     tiene obra asignada y 4 de 5 no tienen empresa.
--   * Se escribe solo por funciones: fn_epp_solicitar (quien pide),
--     fn_epp_atender_solicitud (RH: crea la entrega EPP-… con sus piezas por
--     surtir en la obra que elija, igual que si la capturara en RH) y
--     fn_epp_rechazar_solicitud (RH, con motivo).
--   * fn_epp_personas_para_solicitar(): personal activo de la organización
--     (solo id, nombre, puesto y empresa), primero la gente a cargo de quien
--     pide.
-- Quien pidió ve las suyas; RH/admin todas las de su organización.
-- Ya aplicado en producción (epp_solicitudes).

create or replace function public.auth_solicita_epp()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.activo and not p.espectador and p.rol <> 'pendiente'
       and (p.rol in ('rh', 'admin', 'supervisor', 'responsable')
            or exists (select 1 from public.personal pe where pe.supervisor_profile_id = p.id and pe.activo)))
$$;
grant execute on function public.auth_solicita_epp() to authenticated;

create table if not exists public.epp_solicitudes (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  empresa_id uuid references public.empresas (id),
  proyecto_id uuid references public.proyectos (id),
  personal_id uuid not null references public.personal (id),
  folio text not null,
  solicitado_por uuid not null references auth.users (id) default auth.uid(),
  solicitante_nombre text,
  notas text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'atendida', 'rechazada')),
  rechazo_motivo text,
  asignacion_id uuid references public.epp_asignaciones (id) on delete set null,
  atendida_por uuid references auth.users (id),
  atendida_en timestamptz,
  created_at timestamptz not null default now(),
  unique (grupo_id, folio)
);
create index if not exists epp_solicitudes_solicitado_idx on public.epp_solicitudes (solicitado_por);
create index if not exists epp_solicitudes_personal_idx on public.epp_solicitudes (personal_id);
create index if not exists epp_solicitudes_proyecto_idx on public.epp_solicitudes (proyecto_id);
create index if not exists epp_solicitudes_empresa_idx on public.epp_solicitudes (empresa_id);
create index if not exists epp_solicitudes_asignacion_idx on public.epp_solicitudes (asignacion_id);
create index if not exists epp_solicitudes_pendientes_idx on public.epp_solicitudes (grupo_id, created_at) where estado = 'pendiente';

create table if not exists public.epp_solicitud_lineas (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.epp_solicitudes (id) on delete cascade,
  grupo_id uuid not null references public.grupos (id),
  descripcion text not null check (length(trim(descripcion)) > 0),
  talla text,
  cantidad numeric(12,2) not null default 1 check (cantidad > 0),
  unidad text not null default 'pza',
  created_at timestamptz not null default now()
);
create index if not exists epp_solicitud_lineas_solicitud_idx on public.epp_solicitud_lineas (solicitud_id);

alter table public.epp_solicitudes enable row level security;
alter table public.epp_solicitud_lineas enable row level security;

do $$
declare t text;
begin
  foreach t in array array['epp_solicitudes', 'epp_solicitud_lineas'] loop
    execute format('drop policy if exists frontera_organizacion on public.%I', t);
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))$p$, t);
    execute format('drop policy if exists espectador_sin_datos on public.%I', t);
    execute format($p$create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()))$p$, t);
    execute format('drop policy if exists director_general on public.%I', t);
    execute format($p$create policy director_general on public.%I for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()))$p$, t);
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I
      for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists epp_solicitudes_select on public.epp_solicitudes;
create policy epp_solicitudes_select on public.epp_solicitudes for select to authenticated
  using (solicitado_por = (select auth.uid()) or (select public.auth_opera_epp()));
drop policy if exists epp_solicitud_lineas_select on public.epp_solicitud_lineas;
create policy epp_solicitud_lineas_select on public.epp_solicitud_lineas for select to authenticated
  using (exists (select 1 from public.epp_solicitudes s where s.id = solicitud_id));

-- Personas a las que se les puede pedir EPP: solo lo necesario para elegir.
create or replace function public.fn_epp_personas_para_solicitar()
returns table (id uuid, nombre text, puesto text, empresa text, a_mi_cargo boolean)
language sql stable security definer set search_path = public as $$
  select pe.id, pe.nombre, pe.puesto, e.codigo, coalesce(pe.supervisor_profile_id = auth.uid(), false)
    from public.personal pe
    left join public.profiles pr on pr.id = pe.profile_id
    left join public.empresas e on e.id = pr.empresa_id
   where public.auth_solicita_epp()
     and pe.activo and pe.fecha_baja is null
     and pe.grupo_id = (select p.grupo_id from public.profiles p where p.id = auth.uid())
   order by coalesce(pe.supervisor_profile_id = auth.uid(), false) desc, pe.nombre;
$$;
revoke all on function public.fn_epp_personas_para_solicitar() from public, anon;
grant execute on function public.fn_epp_personas_para_solicitar() to authenticated;

create or replace function public.fn_epp_solicitar(p_personal uuid, p_proyecto uuid, p_lineas jsonb, p_notas text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_yo public.profiles%rowtype;
  v_persona public.personal%rowtype;
  v_empresa uuid;
  v_folio text;
  v_id uuid;
  v_n int;
  l jsonb;
begin
  if not public.auth_solicita_epp() then
    raise exception 'Solo supervisores, responsables de obra o RH piden equipo de protección.' using errcode = '42501';
  end if;
  select * into v_yo from public.profiles where id = auth.uid();
  select * into v_persona from public.personal where id = p_personal;
  if v_persona.id is null or v_persona.grupo_id is distinct from v_yo.grupo_id or not v_persona.activo then
    raise exception 'Elige a una persona activa de tu organización.';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos una pieza.';
  end if;
  if jsonb_array_length(p_lineas) > 30 then raise exception 'Máximo 30 piezas por solicitud.'; end if;

  if p_proyecto is not null then
    select pr.empresa_id into v_empresa from public.proyectos pr
     where pr.id = p_proyecto and pr.empresa_id = any (public.auth_empresas_organizacion());
    if v_empresa is null then raise exception 'La obra no existe o es de otra organización.'; end if;
  end if;
  if v_empresa is null then
    select pr.empresa_id into v_empresa from public.profiles pr where pr.id = v_persona.profile_id;
  end if;
  v_empresa := coalesce(v_empresa, v_yo.empresa_id);

  perform pg_advisory_xact_lock(hashtext('epp_solicitudes:' || v_yo.grupo_id::text));
  if v_empresa is not null then
    v_folio := public.fn_siguiente_folio(v_empresa, 'SE');
  else
    select count(*) + 1 into v_n from public.epp_solicitudes where grupo_id = v_yo.grupo_id and folio ~ '^SE-[0-9]+$';
    v_folio := 'SE-' || lpad(v_n::text, 4, '0');
  end if;

  insert into public.epp_solicitudes (grupo_id, empresa_id, proyecto_id, personal_id, folio, solicitado_por, solicitante_nombre, notas)
  values (v_yo.grupo_id, v_empresa, p_proyecto, p_personal, v_folio, auth.uid(), v_yo.nombre, nullif(btrim(p_notas), ''))
  returning id into v_id;

  for l in select * from jsonb_array_elements(p_lineas) loop
    if nullif(btrim(l->>'descripcion'), '') is null then raise exception 'Cada pieza lleva descripción.'; end if;
    if coalesce((l->>'cantidad')::numeric, 0) <= 0 then raise exception 'La cantidad de "%" debe ser mayor a cero.', l->>'descripcion'; end if;
    insert into public.epp_solicitud_lineas (solicitud_id, grupo_id, descripcion, talla, cantidad, unidad)
    values (v_id, v_yo.grupo_id, btrim(l->>'descripcion'), nullif(btrim(l->>'talla'), ''), (l->>'cantidad')::numeric,
            coalesce(nullif(btrim(l->>'unidad'), ''), 'pza'));
  end loop;

  return jsonb_build_object('id', v_id, 'folio', v_folio);
end;
$$;
revoke all on function public.fn_epp_solicitar(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.fn_epp_solicitar(uuid, uuid, jsonb, text) to authenticated;

-- RH atiende: la solicitud se vuelve una entrega EPP-… con sus piezas por surtir.
create or replace function public.fn_epp_atender_solicitud(p_solicitud uuid, p_proyecto uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_s public.epp_solicitudes%rowtype;
  v_proyecto uuid;
  v_asignacion uuid;
begin
  if not public.auth_opera_epp() then raise exception 'Solo RH atiende solicitudes de EPP.' using errcode = '42501'; end if;
  select * into v_s from public.epp_solicitudes where id = p_solicitud for update;
  if v_s.id is null or not (v_s.grupo_id = any (public.auth_grupos_alcance())) then raise exception 'Solicitud no encontrada.'; end if;
  if v_s.estado <> 'pendiente' then raise exception 'Esa solicitud ya fue %.', v_s.estado; end if;
  v_proyecto := coalesce(p_proyecto, v_s.proyecto_id);
  if v_proyecto is null then raise exception 'Elige la obra a la que se carga el equipo.'; end if;
  if not exists (select 1 from public.proyectos pr where pr.id = v_proyecto and pr.empresa_id = any (public.auth_empresas_organizacion())) then
    raise exception 'La obra no existe o es de otra organización.';
  end if;

  insert into public.epp_asignaciones (proyecto_id, empresa_id, personal_id, notas, created_by)
  select v_proyecto, pr.empresa_id, v_s.personal_id,
         'Solicitud ' || v_s.folio || coalesce(' de ' || v_s.solicitante_nombre, '') || coalesce(': ' || v_s.notas, ''), auth.uid()
    from public.proyectos pr where pr.id = v_proyecto
  returning id into v_asignacion;

  insert into public.epp_asignacion_lineas (asignacion_id, empresa_id, descripcion, talla, cantidad, unidad)
  select v_asignacion, a.empresa_id, l.descripcion, l.talla, l.cantidad, l.unidad
    from public.epp_solicitud_lineas l, public.epp_asignaciones a
   where l.solicitud_id = p_solicitud and a.id = v_asignacion
   order by l.created_at;

  update public.epp_solicitudes
     set estado = 'atendida', asignacion_id = v_asignacion, proyecto_id = v_proyecto,
         atendida_por = auth.uid(), atendida_en = now()
   where id = p_solicitud;
  return v_asignacion;
end;
$$;
revoke all on function public.fn_epp_atender_solicitud(uuid, uuid) from public, anon;
grant execute on function public.fn_epp_atender_solicitud(uuid, uuid) to authenticated;

create or replace function public.fn_epp_rechazar_solicitud(p_solicitud uuid, p_motivo text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_s public.epp_solicitudes%rowtype;
begin
  if not public.auth_opera_epp() then raise exception 'Solo RH rechaza solicitudes de EPP.' using errcode = '42501'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'Escribe el motivo para que quien pidió sepa qué pasó.'; end if;
  select * into v_s from public.epp_solicitudes where id = p_solicitud for update;
  if v_s.id is null or not (v_s.grupo_id = any (public.auth_grupos_alcance())) then raise exception 'Solicitud no encontrada.'; end if;
  if v_s.estado <> 'pendiente' then raise exception 'Esa solicitud ya fue %.', v_s.estado; end if;
  update public.epp_solicitudes
     set estado = 'rechazada', rechazo_motivo = btrim(p_motivo), atendida_por = auth.uid(), atendida_en = now()
   where id = p_solicitud;
end;
$$;
revoke all on function public.fn_epp_rechazar_solicitud(uuid, text) from public, anon;
grant execute on function public.fn_epp_rechazar_solicitud(uuid, text) to authenticated;
