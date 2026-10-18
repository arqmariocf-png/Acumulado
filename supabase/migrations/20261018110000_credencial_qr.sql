-- Credencial QR del personaje (18-oct-2026, Mario: "una vez abran su NPC
-- puedan ver su QR para tener acceso a servicios de la empresa como comedor o
-- compra de materiales y herramienta").
--
-- El QR no es fijo: lleva un código al azar que dura 10 minutos y la pantalla
-- lo renueva cada minuto, así una captura de pantalla vieja no sirve. Lo lee
-- quien atiende un servicio (cocina del comedor, almacén/herramienta, punto
-- de venta) y el sistema responde quién es, su pedido del comedor de hoy y
-- la herramienta que tiene a su cargo.
--
--   * credenciales_qr: el código vigente de cada persona. Nadie la lee
--     directo: solo las dos funciones.
--   * fn_mi_credencial(): da (o renueva) el código de quien la pide.
--   * fn_credencial_leer(codigo): para quien opera comedor, herramienta o
--     punto de venta (o admin), dentro de su organización.
-- Ya aplicado en producción.

create table if not exists public.credenciales_qr (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  grupo_id uuid not null references public.grupos (id),
  codigo text not null unique,
  expira timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists credenciales_qr_grupo_idx on public.credenciales_qr (grupo_id);

alter table public.credenciales_qr enable row level security;
drop policy if exists frontera_organizacion on public.credenciales_qr;
create policy frontera_organizacion on public.credenciales_qr as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
drop policy if exists espectador_sin_datos on public.credenciales_qr;
create policy espectador_sin_datos on public.credenciales_qr as restrictive for select to authenticated
  using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.credenciales_qr;
create policy director_general on public.credenciales_qr for all to authenticated
  using ((select public.auth_admin_global_definer()))
  with check ((select public.auth_admin_global_definer()));
drop trigger if exists solo_consulta on public.credenciales_qr;
create trigger solo_consulta before insert or update or delete on public.credenciales_qr
  for each statement execute function public.bloquear_solo_consulta();

create or replace function public.fn_mi_credencial()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_yo public.profiles;
  c public.credenciales_qr;
begin
  select * into v_yo from public.profiles where id = auth.uid();
  if v_yo.id is null or not v_yo.activo or v_yo.espectador or v_yo.rol = 'pendiente' or v_yo.grupo_id is null then
    raise exception 'Tu cuenta no tiene credencial.';
  end if;
  select * into c from public.credenciales_qr where profile_id = v_yo.id;
  if c.profile_id is null or c.expira < now() + interval '8 minutes' then
    insert into public.credenciales_qr (profile_id, grupo_id, codigo, expira)
    values (v_yo.id, v_yo.grupo_id,
            replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
            now() + interval '10 minutes')
    on conflict (profile_id) do update
      set codigo = excluded.codigo, expira = excluded.expira, grupo_id = excluded.grupo_id, created_at = now()
    returning * into c;
  end if;
  return jsonb_build_object('codigo', 'ACU1:' || c.codigo, 'expira', c.expira);
end;
$$;
grant execute on function public.fn_mi_credencial() to authenticated;

create or replace function public.fn_credencial_leer(p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.credenciales_qr;
  p public.profiles;
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_codigo text := regexp_replace(btrim(coalesce(p_codigo, '')), '^ACU1:', '');
begin
  if not (public.auth_rol() = 'admin' or public.auth_opera_comedor() or public.auth_opera_herramienta() or public.auth_opera_pv()) then
    raise exception 'Solo quien atiende el comedor, el almacén o el mostrador lee credenciales.';
  end if;
  select * into c from public.credenciales_qr where codigo = v_codigo;
  if c.profile_id is null then raise exception 'Credencial no reconocida. Pide que abra su QR otra vez.'; end if;
  if c.expira < now() then raise exception 'La credencial ya venció. Pide que abra su QR otra vez.'; end if;
  if not (c.grupo_id = any (public.auth_grupos_alcance())) then raise exception 'Credencial de otra organización.'; end if;
  select * into p from public.profiles where id = c.profile_id;
  if not p.activo then raise exception 'La cuenta de esta persona está dada de baja.'; end if;

  return jsonb_build_object(
    'profile_id', p.id,
    'nombre', p.nombre,
    'rol', p.rol,
    'empresa_id', p.empresa_id,
    'empresa', (select nombre from public.empresas where id = p.empresa_id),
    'avatar', (select avatar from public.personajes where profile_id = p.id),
    'titulo', (select titulo from public.personajes where profile_id = p.id),
    'expediente', exists (select 1 from public.personal pe where pe.profile_id = p.id and pe.activo),
    'comedor', (select jsonb_build_object('id', v.id, 'estado', v.estado, 'total', v.total, 'detalle', v.detalle)
                  from public.v_comedor_pedidos v where v.profile_id = p.id and v.fecha = v_hoy limit 1),
    'herramientas', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'folio', h.folio, 'nombre', h.nombre,
                                                                  'obra', pr.nombre, 'devolver_el', h.devolver_el) order by h.devolver_el nulls last)
                                from public.herramientas h left join public.proyectos pr on pr.id = h.proyecto_id
                               where h.responsable_id = p.id and h.estado = 'asignada'), '[]'));
end;
$$;
grant execute on function public.fn_credencial_leer(text) to authenticated;
