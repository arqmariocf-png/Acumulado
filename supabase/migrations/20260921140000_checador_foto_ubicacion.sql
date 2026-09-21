-- Checador con evidencia (pedido 21-sep-2026): cada marca de entrada/salida
-- lleva la ubicación GPS del teléfono y una foto tomada en el momento. La
-- foto se guarda en el bucket privado "cargas" (checador/<profile>/...) vía
-- el edge function checador-marcar, que es el único que inserta desde ahora
-- (la policy de insert directo se cierra para que nadie marque sin evidencia).
alter table public.checador_registros
  add column lat double precision,
  add column lng double precision,
  add column precision_m double precision,
  add column foto_path text,
  add column dispositivo text;

comment on column public.checador_registros.foto_path is 'Ruta en el bucket cargas de la foto tomada al marcar (selfie). Se ve con checador-marcar GET ?registroId=.';
comment on column public.checador_registros.precision_m is 'Precisión reportada por el GPS en metros.';

drop policy checador_registros_insert on public.checador_registros;

-- RH y admin ven las marcas con el nombre de la persona (profiles solo deja
-- leer el propio renglón, por eso va con definer acotado a esos roles).
create view public.v_checador_marcas with (security_invoker = false) as
select r.id, r.profile_id, coalesce(pe.nombre, p.nombre) as nombre, r.tipo, r.created_at, r.lat, r.lng, r.precision_m,
  r.foto_path is not null as tiene_foto, r.dispositivo
from public.checador_registros r
join public.profiles p on p.id = r.profile_id
left join public.personal pe on pe.profile_id = r.profile_id
where public.auth_rol() in ('rh', 'admin') or r.profile_id = auth.uid();

grant select on public.v_checador_marcas to authenticated;
