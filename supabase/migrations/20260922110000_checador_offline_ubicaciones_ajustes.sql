-- Checador (pedido de Mario, 22-sep-2026):
-- 1. Ubicaciones clasificadas: catálogo de sitios (oficina, obra, planta...)
--    con radio; cada marca se clasifica automáticamente por cercanía y RH
--    puede reclasificarla a mano. Panel de administración para RH.
-- 2. Corrección de horas: RH/admin ajustan la hora de una marca, agregan
--    una marca manual o anulan una equivocada, siempre con nota y rastro
--    (hora original, quién y cuándo). created_at sigue siendo "la hora de
--    la marca" para todo lo que ya existe (horas, nómina, vistas).
-- 3. Offline: la app guarda la marca en el teléfono sin señal y la envía
--    después con la hora real en que se marcó (marcada_en); queda señalada
--    como sincronizada offline.

create table public.checador_ubicaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null default 'obra' check (tipo in ('oficina', 'obra', 'planta', 'almacen', 'cliente', 'otro')),
  lat double precision not null,
  lng double precision not null,
  radio_m integer not null default 150 check (radio_m between 20 and 5000),
  notas text,
  activo boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.checador_ubicaciones enable row level security;

-- Todos los que marcan ven el catálogo (para que el checador diga en qué
-- sitio quedó la marca); solo RH/admin lo administran.
create policy checador_ubicaciones_select on public.checador_ubicaciones
  for select using (public.auth_rol() <> 'pendiente');
create policy checador_ubicaciones_write on public.checador_ubicaciones
  for all using (public.auth_rol() in ('rh', 'admin')) with check (public.auth_rol() in ('rh', 'admin'));

alter table public.checador_registros
  add column ubicacion_id uuid references public.checador_ubicaciones (id),
  add column marcada_en timestamptz,
  add column sincronizada_offline boolean not null default false,
  add column manual boolean not null default false,
  add column hora_original timestamptz,
  add column ajustada_por uuid references public.profiles (id),
  add column ajustada_en timestamptz,
  add column ajuste_nota text,
  add column anulada_en timestamptz,
  add column anulada_por uuid references public.profiles (id),
  add column anulada_nota text;

create index checador_registros_ubicacion_idx on public.checador_registros (ubicacion_id) where ubicacion_id is not null;

-- Distancia en metros entre dos coordenadas (haversine).
create or replace function public.distancia_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- Sitio activo más cercano dentro de su radio; null si ninguno.
create or replace function public.checador_clasificar_ubicacion(p_lat double precision, p_lng double precision)
returns uuid language sql stable as $$
  select u.id from public.checador_ubicaciones u
  where u.activo and public.distancia_m(p_lat, p_lng, u.lat, u.lng) <= u.radio_m
  order by public.distancia_m(p_lat, p_lng, u.lat, u.lng)
  limit 1
$$;

create or replace function public.checador_registros_clasificar()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.ubicacion_id is null and new.lat is not null and new.lng is not null then
    new.ubicacion_id := public.checador_clasificar_ubicacion(new.lat, new.lng);
  end if;
  return new;
end;
$$;

create trigger checador_registros_clasificar
  before insert on public.checador_registros
  for each row execute function public.checador_registros_clasificar();

-- Reclasifica las marcas sin sitio (después de dar de alta una ubicación).
create or replace function public.checador_reclasificar_marcas(p_desde date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if public.auth_rol() not in ('rh', 'admin') then
    raise exception 'Solo RH o admin pueden reclasificar marcas';
  end if;
  update public.checador_registros r
    set ubicacion_id = public.checador_clasificar_ubicacion(r.lat, r.lng)
    where r.ubicacion_id is null and r.lat is not null and r.lng is not null
      and (p_desde is null or r.created_at >= p_desde);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.checador_reclasificar_marcas(date) from public;
grant execute on function public.checador_reclasificar_marcas(date) to authenticated;

-- RH asigna a mano el sitio de una marca (o lo quita).
create or replace function public.checador_asignar_ubicacion(p_registro_id uuid, p_ubicacion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.auth_rol() not in ('rh', 'admin') then
    raise exception 'Solo RH o admin pueden clasificar marcas';
  end if;
  update public.checador_registros set ubicacion_id = p_ubicacion_id where id = p_registro_id;
end;
$$;
revoke all on function public.checador_asignar_ubicacion(uuid, uuid) from public;
grant execute on function public.checador_asignar_ubicacion(uuid, uuid) to authenticated;

-- Corrección de hora con rastro.
create or replace function public.checador_ajustar_marca(p_registro_id uuid, p_nueva_hora timestamptz, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actual timestamptz;
begin
  if public.auth_rol() not in ('rh', 'admin') then
    raise exception 'Solo RH o admin pueden corregir marcas';
  end if;
  if coalesce(trim(p_nota), '') = '' then
    raise exception 'Escribe el motivo de la corrección';
  end if;
  if p_nueva_hora > now() + interval '5 minutes' then
    raise exception 'La hora corregida no puede estar en el futuro';
  end if;
  select created_at into v_actual from public.checador_registros where id = p_registro_id and anulada_en is null;
  if v_actual is null then
    raise exception 'Marca no encontrada o anulada';
  end if;
  update public.checador_registros
    set hora_original = coalesce(hora_original, v_actual),
        created_at = p_nueva_hora,
        ajustada_por = auth.uid(),
        ajustada_en = now(),
        ajuste_nota = trim(p_nota)
    where id = p_registro_id;
end;
$$;
revoke all on function public.checador_ajustar_marca(uuid, timestamptz, text) from public;
grant execute on function public.checador_ajustar_marca(uuid, timestamptz, text) to authenticated;

-- Marca manual (la persona no pudo marcar: sin teléfono, sin señal y sin
-- app, etc.). Sin foto ni GPS, señalada como manual.
create or replace function public.checador_marca_manual(p_profile_id uuid, p_tipo text, p_hora timestamptz, p_nota text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if public.auth_rol() not in ('rh', 'admin') then
    raise exception 'Solo RH o admin pueden agregar marcas manuales';
  end if;
  if coalesce(trim(p_nota), '') = '' then
    raise exception 'Escribe el motivo de la marca manual';
  end if;
  if p_tipo not in ('entrada', 'salida', 'comida_inicio', 'comida_fin') then
    raise exception 'Tipo de marca inválido';
  end if;
  if p_hora > now() + interval '5 minutes' then
    raise exception 'La hora no puede estar en el futuro';
  end if;
  insert into public.checador_registros (profile_id, tipo, created_at, manual, ajustada_por, ajustada_en, ajuste_nota)
    values (p_profile_id, p_tipo, p_hora, true, auth.uid(), now(), trim(p_nota))
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.checador_marca_manual(uuid, text, timestamptz, text) from public;
grant execute on function public.checador_marca_manual(uuid, text, timestamptz, text) to authenticated;

-- Anular (no se borra: queda el rastro, pero deja de contar).
create or replace function public.checador_anular_marca(p_registro_id uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.auth_rol() not in ('rh', 'admin') then
    raise exception 'Solo RH o admin pueden anular marcas';
  end if;
  if coalesce(trim(p_nota), '') = '' then
    raise exception 'Escribe el motivo de la anulación';
  end if;
  update public.checador_registros
    set anulada_en = now(), anulada_por = auth.uid(), anulada_nota = trim(p_nota)
    where id = p_registro_id and anulada_en is null;
end;
$$;
revoke all on function public.checador_anular_marca(uuid, text) from public;
grant execute on function public.checador_anular_marca(uuid, text) to authenticated;

-- Vista de RH / encargado con todo el rastro. Las anuladas se incluyen
-- marcadas (anulada = true) para que RH las vea; la app las filtra donde
-- toca.
drop view public.v_checador_marcas;
create view public.v_checador_marcas with (security_invoker = false) as
select r.id, r.profile_id, coalesce(pe.nombre, p.nombre) as nombre, r.tipo, r.created_at, r.lat, r.lng, r.precision_m,
  r.foto_path is not null as tiene_foto, r.dispositivo,
  r.ubicacion_id, u.nombre as ubicacion_nombre, u.tipo as ubicacion_tipo,
  r.marcada_en, r.sincronizada_offline, r.manual,
  r.hora_original, r.ajustada_en, r.ajuste_nota, pa.nombre as ajustada_por_nombre,
  r.anulada_en is not null as anulada, r.anulada_nota
from public.checador_registros r
join public.profiles p on p.id = r.profile_id
left join public.personal pe on pe.profile_id = r.profile_id
left join public.checador_ubicaciones u on u.id = r.ubicacion_id
left join public.profiles pa on pa.id = r.ajustada_por
where public.auth_ve_checador_de(r.profile_id);
grant select on public.v_checador_marcas to authenticated;

-- Nómina: las anuladas no cuentan como día checado.
create or replace view public.v_asistencia_semanal_personal with (security_invoker = true) as
select
  p.id as personal_id,
  p.nombre as personal_nombre,
  c.id as contratacion_id,
  c.empresa_id,
  date_trunc('week', cr.created_at)::date as semana_inicio,
  count(distinct cr.created_at::date) filter (where cr.tipo = 'entrada') as dias_checados,
  c.sueldo_semanal
from public.personal p
join public.contrataciones c on c.personal_id = p.id
join public.checador_registros cr
  on cr.profile_id = p.profile_id
  and cr.created_at::date between c.fecha_inicio and c.fecha_fin
  and cr.anulada_en is null
where p.profile_id is not null
group by p.id, p.nombre, c.id, c.empresa_id, date_trunc('week', cr.created_at)::date, c.sueldo_semanal;

-- Personas con cuenta (para la marca manual de RH).
create view public.v_personal_con_cuenta with (security_invoker = true) as
select pe.id as personal_id, pe.nombre, pe.profile_id, pe.puesto, pe.area
from public.personal pe
where pe.profile_id is not null and pe.activo;
grant select on public.v_personal_con_cuenta to authenticated;
