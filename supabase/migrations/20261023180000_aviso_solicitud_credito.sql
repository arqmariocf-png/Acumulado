-- Aviso a dirección cuando hay una solicitud de crédito por autorizar
-- (23-oct-2026, Mario: "notifica a Laura cuando exista una solicitud de
-- crédito para que ella pueda autorizarla").
--
-- `fn_push_aviso(profiles, titulo, cuerpo, url)`: push libre a personas
-- concretas por la edge push-enviar-recordatorios (v6, body {aviso: …}) con
-- el `cron_secret` de config_sistema; nunca falla la transacción que lo llama
-- (pg_net encola la llamada; si no hay secreto, no hace nada). Revocada de
-- authenticated: solo la llaman triggers y funciones definer.
--
-- Dos disparadores, a todo rol `direccion` activo de la organización (Laura):
-- 1. `clientes_credito`: alguien que NO autoriza (legal: Belén, Eréndira) da
--    de alta o cambia una línea de crédito a cliente sin autorizar →
--    "Solicitud de crédito por autorizar" → /legal?tab=credito.
-- 2. `cuentas_nomina`: RH fija o cambia el sueldo de una persona que todavía
--    no tiene línea → "Cuenta de nómina lista para autorizar" → /financiamiento.
--
-- Ya aplicado en producción (aviso_solicitud_credito).

create or replace function public.fn_push_aviso(p_profiles uuid[], p_titulo text, p_cuerpo text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare v_secreto text;
begin
  if p_profiles is null or array_length(p_profiles, 1) is null then return; end if;
  select valor into v_secreto from public.config_sistema where clave = 'cron_secret';
  if v_secreto is null then return; end if;
  begin
    perform net.http_post(
      url := 'https://zdqahpzijkkcnfehbggs.supabase.co/functions/v1/push-enviar-recordatorios',
      headers := jsonb_build_object('x-cron-secret', v_secreto, 'Content-Type', 'application/json'),
      body := jsonb_build_object('aviso', jsonb_build_object('profiles', to_jsonb(p_profiles), 'titulo', p_titulo, 'cuerpo', p_cuerpo, 'url', p_url)),
      timeout_milliseconds := 30000
    );
  exception when others then
    raise warning 'fn_push_aviso: %', sqlerrm;
  end;
end;
$$;
revoke all on function public.fn_push_aviso(uuid[], text, text, text) from public, anon, authenticated;

-- Dirección activa (con cuenta) de una organización.
create or replace function public.fn_direccion_de(p_grupo uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}'::uuid[]) from public.profiles p
   where p.grupo_id = p_grupo and p.rol = 'direccion' and p.activo and not coalesce(p.espectador, false)
$$;
revoke all on function public.fn_direccion_de(uuid) from public, anon, authenticated;

create or replace function public.clientes_credito_aviso()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_grupo uuid; v_cliente text; v_empresa text; v_quien text; v_dir uuid[];
begin
  if new.autorizado then return null; end if;
  if tg_op = 'UPDATE' and not old.autorizado
     and new.linea_credito is not distinct from old.linea_credito
     and new.dias_credito is not distinct from old.dias_credito then
    return null; -- cambio de datos del contrato, no de la solicitud
  end if;
  -- Si quien captura puede autorizar (dirección/admin), no se avisa a sí mismo.
  if auth.uid() is not null and public.auth_autoriza_credito() then return null; end if;
  select e.grupo_id, e.codigo into v_grupo, v_empresa from public.empresas e where e.id = new.empresa_id;
  select c.razon_social into v_cliente from public.clientes c where c.id = new.cliente_id;
  select nullif(btrim(p.nombre), '') into v_quien from public.profiles p where p.id = auth.uid();
  v_dir := public.fn_direccion_de(v_grupo);
  perform public.fn_push_aviso(
    v_dir,
    'Solicitud de crédito por autorizar',
    concat_ws(' · ', coalesce(v_cliente, 'Cliente'),
              case when new.linea_credito is not null then 'línea $' || to_char(new.linea_credito, 'FM999,999,999,990.00') end,
              case when new.dias_credito is not null then new.dias_credito || ' días' end,
              v_empresa, case when v_quien is not null then 'capturó ' || v_quien end),
    '/legal?tab=credito');
  return null;
end;
$$;
create or replace trigger clientes_credito_aviso after insert or update on public.clientes_credito
  for each row execute function public.clientes_credito_aviso();

create or replace function public.cuentas_nomina_aviso()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nombre text; v_quien text; v_rol text;
begin
  if coalesce(new.linea, 0) > 0 then return null; end if; -- ya tiene línea autorizada
  if new.sueldo_semanal is null then return null; end if;
  if tg_op = 'UPDATE' and new.sueldo_semanal is not distinct from old.sueldo_semanal then return null; end if;
  select rol into v_rol from public.profiles where id = auth.uid();
  if v_rol is distinct from 'rh' then return null; end if; -- lo fijó RH: dirección autoriza
  select nullif(btrim(nombre), '') into v_nombre from public.profiles where id = new.profile_id;
  select nullif(btrim(nombre), '') into v_quien from public.profiles where id = auth.uid();
  perform public.fn_push_aviso(
    public.fn_direccion_de(new.grupo_id),
    'Cuenta de nómina lista para autorizar',
    concat_ws(' · ', coalesce(v_nombre, 'Persona'), 'sueldo $' || to_char(new.sueldo_semanal, 'FM999,999,990.00') || '/semana',
              case when v_quien is not null then 'lo fijó ' || v_quien end),
    '/financiamiento');
  return null;
end;
$$;
create or replace trigger cuentas_nomina_aviso after insert or update on public.cuentas_nomina
  for each row execute function public.cuentas_nomina_aviso();
