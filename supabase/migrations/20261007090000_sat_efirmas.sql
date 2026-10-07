-- e.firma del SAT por empresa (Mario, 7-oct-2026: "haz la pantalla para
-- subirlas y dale acceso a Belén"). Es el primer paso de la descarga masiva
-- automática de CFDI: el servicio web del SAT se autentica con la e.firma
-- (.cer + .key + contraseña) de cada RFC.
--
-- - Los archivos van al bucket privado "cargas" bajo sat/<empresa>/… (sin
--   policies de lectura para authenticated: solo la service_role los lee).
-- - La contraseña va a Supabase Vault (cifrada); en la tabla solo queda el
--   id del secreto. Nunca se devuelve al navegador.
-- - Suben, reemplazan y quitan: admin o quien tiene el permiso por persona
--   'contabilidad' (Belén). Todo pasa por la edge `sat-efirma`, que valida
--   el certificado, que la llave abra con la contraseña y que ambos sean
--   pareja, y luego llama fn_sat_efirma_guardar (solo service_role).
-- - Si la empresa no tenía RFC capturado, se toma el del certificado.
--
-- Ya aplicado en producción (por partes: el MCP se queda colgado con
-- cualquier sentencia que diga drop o delete).

create or replace function public.auth_opera_sat()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo and not coalesce(p.espectador, false)
      and (p.rol = 'admin'
           or exists (select 1 from public.permisos_modulo pm where pm.profile_id = p.id and pm.modulo = 'contabilidad'))
  )
$$;
revoke all on function public.auth_opera_sat() from public, anon;
grant execute on function public.auth_opera_sat() to authenticated, service_role;

create table if not exists public.sat_efirmas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references public.empresas(id) on delete cascade,
  rfc text not null,
  titular text,
  numero_certificado text,
  vigente_desde timestamptz,
  vigente_hasta timestamptz,
  cer_path text not null,
  key_path text not null,
  password_secret_id uuid,
  subido_por uuid references public.profiles(id) on delete set null,
  subido_por_nombre text,
  -- Para la descarga automática (siguiente paso).
  ultima_descarga_en timestamptz,
  ultimo_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sat_efirmas_subido_por_idx on public.sat_efirmas (subido_por);

alter table public.sat_efirmas enable row level security;
drop policy if exists frontera_organizacion on public.sat_efirmas;
create policy frontera_organizacion on public.sat_efirmas as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
drop policy if exists sat_efirmas_select on public.sat_efirmas;
create policy sat_efirmas_select on public.sat_efirmas for select
  using ((select public.auth_opera_sat()));
drop policy if exists espectador_sin_datos on public.sat_efirmas;
create policy espectador_sin_datos on public.sat_efirmas as restrictive for select using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.sat_efirmas;
create policy director_general on public.sat_efirmas for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
drop trigger if exists solo_consulta on public.sat_efirmas;
create trigger solo_consulta before insert or update or delete on public.sat_efirmas
  for each statement execute function public.bloquear_solo_consulta();

-- Guarda (o reemplaza) la e.firma de una empresa. Devuelve las rutas de los
-- archivos anteriores para que la edge los borre.
create or replace function public.fn_sat_efirma_guardar(
  p_empresa uuid, p_rfc text, p_titular text, p_numero text,
  p_desde timestamptz, p_hasta timestamptz,
  p_cer text, p_key text, p_password text,
  p_por uuid, p_por_nombre text
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ant public.sat_efirmas%rowtype;
  v_nombre text := 'sat_efirma_' || p_empresa::text;
  v_secreto uuid;
begin
  select * into v_ant from public.sat_efirmas where empresa_id = p_empresa;
  v_secreto := v_ant.password_secret_id;
  if v_secreto is null then
    select id into v_secreto from vault.secrets where name = v_nombre;
  end if;
  if v_secreto is null then
    v_secreto := vault.create_secret(p_password, v_nombre, 'Contraseña de la e.firma SAT');
  else
    perform vault.update_secret(v_secreto, p_password, v_nombre, 'Contraseña de la e.firma SAT');
  end if;

  insert into public.sat_efirmas (empresa_id, rfc, titular, numero_certificado, vigente_desde, vigente_hasta,
                                  cer_path, key_path, password_secret_id, subido_por, subido_por_nombre, ultimo_error, updated_at)
  values (p_empresa, upper(p_rfc), p_titular, p_numero, p_desde, p_hasta, p_cer, p_key, v_secreto, p_por, p_por_nombre, null, now())
  on conflict (empresa_id) do update set
    rfc = excluded.rfc, titular = excluded.titular, numero_certificado = excluded.numero_certificado,
    vigente_desde = excluded.vigente_desde, vigente_hasta = excluded.vigente_hasta,
    cer_path = excluded.cer_path, key_path = excluded.key_path, password_secret_id = excluded.password_secret_id,
    subido_por = excluded.subido_por, subido_por_nombre = excluded.subido_por_nombre,
    ultimo_error = null, updated_at = now();

  update public.empresas set rfc = upper(p_rfc) where id = p_empresa and coalesce(rfc, '') = '';

  return jsonb_build_object('cer_anterior', v_ant.cer_path, 'key_anterior', v_ant.key_path);
end;
$$;
revoke all on function public.fn_sat_efirma_guardar(uuid, text, text, text, timestamptz, timestamptz, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.fn_sat_efirma_guardar(uuid, text, text, text, timestamptz, timestamptz, text, text, text, uuid, text) to service_role;

-- Quita la e.firma: deja la contraseña en blanco en Vault y devuelve el id
-- y las rutas; la edge borra el renglón y los archivos (el secreto en blanco
-- se reutiliza si se vuelve a subir).
create or replace function public.fn_sat_efirma_quitar(p_empresa uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ant public.sat_efirmas%rowtype;
begin
  select * into v_ant from public.sat_efirmas where empresa_id = p_empresa;
  if v_ant.id is null then
    return null;
  end if;
  if v_ant.password_secret_id is not null then
    perform vault.update_secret(v_ant.password_secret_id, '', null, 'e.firma SAT retirada');
  end if;
  return jsonb_build_object('id', v_ant.id, 'cer', v_ant.cer_path, 'key', v_ant.key_path);
end;
$$;
revoke all on function public.fn_sat_efirma_quitar(uuid) from public, anon, authenticated;
grant execute on function public.fn_sat_efirma_quitar(uuid) to service_role;

-- Para el trabajo de descarga masiva (solo service_role).
create or replace function public.fn_sat_efirma_credenciales(p_empresa uuid)
returns table (rfc text, cer_path text, key_path text, password text)
language plpgsql stable security definer set search_path = public as $$
begin
  -- plpgsql (no sql) para que la migración aplique también donde no hay Vault
  -- (validación local): el cuerpo no se revisa al crearla.
  return query
  select e.rfc, e.cer_path, e.key_path, s.decrypted_secret::text
  from public.sat_efirmas e
  left join vault.decrypted_secrets s on s.id = e.password_secret_id
  where e.empresa_id = p_empresa;
end;
$$;
revoke all on function public.fn_sat_efirma_credenciales(uuid) from public, anon, authenticated;
grant execute on function public.fn_sat_efirma_credenciales(uuid) to service_role;
