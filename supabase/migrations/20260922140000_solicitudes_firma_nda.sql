-- Firma de convenios de confidencialidad (NDA) desde la app (pedido de
-- Mario, 22-sep-2026): RH solicita el NDA a una persona dada de alta; la
-- persona lo lee en "Mis documentos", dibuja su firma y acepta; queda el
-- rastro (fecha, nombre, dispositivo, imagen de la firma) y RH imprime la
-- versión firmada. Preparado para otros documentos (tipo) más adelante.

create table public.solicitudes_firma (
  id uuid primary key default gen_random_uuid(),
  personal_id uuid not null references public.personal (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),
  tipo text not null default 'nda' check (tipo in ('nda')),
  -- Puesto y fecha con los que se redacta el convenio (foto al solicitar).
  puesto text,
  fecha_convenio date not null default current_date,
  mensaje text,
  estatus text not null default 'pendiente' check (estatus in ('pendiente', 'firmado', 'cancelado')),
  solicitado_por uuid references public.profiles (id),
  solicitado_en timestamptz not null default now(),
  firmado_en timestamptz,
  firma_nombre text,
  -- PNG en data URL de la firma dibujada (pequeña: ~10-30 KB).
  firma_imagen text,
  firma_dispositivo text,
  cancelado_en timestamptz,
  created_at timestamptz not null default now()
);

create index solicitudes_firma_personal_idx on public.solicitudes_firma (personal_id, created_at desc);

alter table public.solicitudes_firma enable row level security;

create policy solicitudes_firma_rh on public.solicitudes_firma
  for all using (public.auth_rol() in ('rh', 'admin')) with check (public.auth_rol() in ('rh', 'admin'));

-- La persona ve sus propias solicitudes (firma vía la función de abajo).
create policy solicitudes_firma_select_propio on public.solicitudes_firma
  for select using (personal_id in (select p.id from public.personal p where p.profile_id = auth.uid()));

-- El perfil legal de la empresa que pide la firma también debe poder
-- leerse para redactar el convenio.
drop policy empresas_perfil_legal_select_propio on public.empresas_perfil_legal;
create policy empresas_perfil_legal_select_propio on public.empresas_perfil_legal
  for select using (
    empresa_id in (
      select c.empresa_id from public.contrataciones c join public.personal p on p.id = c.personal_id where p.profile_id = auth.uid()
      union
      select s.empresa_id from public.solicitudes_firma s join public.personal p on p.id = s.personal_id where p.profile_id = auth.uid()
    )
  );

create or replace function public.firmar_solicitud(p_id uuid, p_nombre text, p_firma_imagen text, p_dispositivo text)
returns public.solicitudes_firma
language plpgsql security definer set search_path = public as $$
declare
  v_sol public.solicitudes_firma;
begin
  select s.* into v_sol from public.solicitudes_firma s
    join public.personal p on p.id = s.personal_id
    where s.id = p_id and p.profile_id = auth.uid();
  if not found then
    raise exception 'Solicitud no encontrada o no te corresponde';
  end if;
  if v_sol.estatus <> 'pendiente' then
    raise exception 'Esta solicitud ya no está pendiente';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Escribe tu nombre completo para firmar';
  end if;
  if p_firma_imagen is null or p_firma_imagen not like 'data:image/png;base64,%' or length(p_firma_imagen) > 200000 then
    raise exception 'La firma no es válida';
  end if;
  update public.solicitudes_firma
    set estatus = 'firmado', firmado_en = now(), firma_nombre = trim(p_nombre), firma_imagen = p_firma_imagen, firma_dispositivo = left(p_dispositivo, 200)
    where id = p_id
    returning * into v_sol;
  return v_sol;
end;
$$;
revoke all on function public.firmar_solicitud(uuid, text, text, text) from public;
grant execute on function public.firmar_solicitud(uuid, text, text, text) to authenticated;
