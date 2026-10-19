-- Firma digital del crédito de nómina e intereses (19-oct-2026, Mario: "cada
-- trabajador que firme su pagaré, consentimiento y afiliación a crédito de
-- manera digital, intégralo aquí mismo; una vez pasando esa parte serán
-- préstamos con intereses ya que será parte del negocio financiero").
--
--   * credito_firmas: cada documento firmado por el trabajador en su app
--     (afiliación, consentimiento de descuento, pagaré de cada préstamo):
--     el texto tal cual se mostró, su huella SHA-256 (texto + firma), la firma
--     dibujada, fecha, IP y navegador. No se edita ni se borra; afiliación y
--     consentimiento solo se revocan (sin saldos pendientes).
--   * Sin afiliación y consentimiento vigentes no se crea ningún cargo; los
--     préstamos, anticipos y "otro" nacen 'por_firmar' y no se descuentan
--     hasta que el trabajador firma su pagaré (las compras del mostrador las
--     cubre el consentimiento y el ticket).
--   * Intereses: art. 111 LFT prohíbe que el PATRÓN cobre intereses. El
--     préstamo con intereses lo otorga la financiera
--     (nomina_financiamiento_config.acreditante_empresa_id), que debe ser una
--     empresa distinta de la que emplea al trabajador; si no, se rechaza.
--     Pagos semanales iguales (sistema francés, tasa anual / 52), IVA sobre
--     intereses, CAT sin IVA = (1 + i)^52 − 1, descuento semanal hasta
--     capacidad_pago_pct del sueldo y plazo hasta plazo_max_semanas_intereses.
--     Anticipos de sueldo y compras del mostrador siguen sin intereses.
--   * El saldo, el atraso y la liquidación ya cuentan sobre el total
--     (capital + interés + IVA).
-- Los textos son borrador para revisión de los abogados
-- (web/src/lib/creditoNomina.ts).
-- Ya aplicado en producción (credito_firma_1 … _5).

-- 1) Configuración: financiera y tasas -------------------------------------------
alter table public.nomina_financiamiento_config
  add column if not exists acreditante_empresa_id uuid references public.empresas (id),
  add column if not exists tasa_anual_prestamos numeric(6,2) not null default 0 check (tasa_anual_prestamos >= 0 and tasa_anual_prestamos <= 200),
  add column if not exists tasa_moratoria_anual numeric(6,2) not null default 0 check (tasa_moratoria_anual >= 0 and tasa_moratoria_anual <= 200),
  add column if not exists iva_intereses numeric(5,2) not null default 16 check (iva_intereses >= 0 and iva_intereses <= 16),
  add column if not exists capacidad_pago_pct numeric(5,2) not null default 30 check (capacidad_pago_pct > 0 and capacidad_pago_pct <= 50),
  add column if not exists plazo_max_semanas_intereses integer not null default 26 check (plazo_max_semanas_intereses between 1 and 52);
create index if not exists nomina_config_acreditante_idx on public.nomina_financiamiento_config (acreditante_empresa_id);

create or replace function public.fn_nomina_config(p_grupo uuid)
returns public.nomina_financiamiento_config language plpgsql stable security definer set search_path = public as $$
declare r public.nomina_financiamiento_config;
begin
  select * into r from public.nomina_financiamiento_config where grupo_id = p_grupo;
  if r.grupo_id is null then
    r.grupo_id := p_grupo;
    r.salario_minimo_diario := 315.04;
    r.pct_excedente := 30;
    r.antiguedad_minima_meses := 3;
    r.updated_at := now();
    r.tasa_anual_prestamos := 0;
    r.tasa_moratoria_anual := 0;
    r.iva_intereses := 16;
    r.capacidad_pago_pct := 30;
    r.plazo_max_semanas_intereses := 26;
  end if;
  return r;
end;
$$;

-- 2) Cargos: por firmar, intereses y total ---------------------------------------
alter table public.nomina_cargos drop constraint if exists nomina_cargos_estatus_check;
alter table public.nomina_cargos add constraint nomina_cargos_estatus_check
  check (estatus in ('por_firmar', 'vigente', 'liquidado', 'cancelado'));
alter table public.nomina_cargos drop constraint if exists nomina_cargos_pagos_check;
alter table public.nomina_cargos add constraint nomina_cargos_pagos_check check (pagos between 1 and 52);
alter table public.nomina_cargos
  add column if not exists acreditante_empresa_id uuid references public.empresas (id),
  add column if not exists tasa_anual numeric(6,2) not null default 0,
  add column if not exists tasa_moratoria_anual numeric(6,2) not null default 0,
  add column if not exists iva_intereses numeric(5,2) not null default 0,
  add column if not exists interes numeric(12,2) not null default 0 check (interes >= 0),
  add column if not exists iva_interes numeric(12,2) not null default 0 check (iva_interes >= 0),
  add column if not exists cat numeric(8,1),
  add column if not exists pagare_id uuid,
  add column if not exists firmado_en timestamptz;
alter table public.nomina_cargos add column if not exists total numeric(12,2) generated always as (monto + interes + iva_interes) stored;
create index if not exists nomina_cargos_acreditante_idx on public.nomina_cargos (acreditante_empresa_id);

-- 3) Documentos firmados ----------------------------------------------------------
create table if not exists public.credito_firmas (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  profile_id uuid not null references public.profiles (id),
  tipo text not null check (tipo in ('afiliacion', 'consentimiento', 'pagare')),
  version text not null check (btrim(version) <> ''),
  titulo text not null check (btrim(titulo) <> ''),
  contenido text not null check (length(contenido) between 50 and 60000),
  firma text not null check (firma like 'data:image/png;base64,%' and length(firma) <= 150000),
  hash text not null,
  cargo_id uuid references public.nomina_cargos (id),
  firmante_nombre text,
  firmado_en timestamptz not null default now(),
  ip text,
  agente text,
  revocada_en timestamptz,
  revocada_motivo text
);
create index if not exists credito_firmas_profile_idx on public.credito_firmas (profile_id, tipo);
create index if not exists credito_firmas_grupo_idx on public.credito_firmas (grupo_id);
create index if not exists credito_firmas_cargo_idx on public.credito_firmas (cargo_id);
create unique index if not exists credito_firmas_pagare_unico on public.credito_firmas (cargo_id) where tipo = 'pagare';
alter table public.nomina_cargos drop constraint if exists nomina_cargos_pagare_fk;
alter table public.nomina_cargos add constraint nomina_cargos_pagare_fk foreign key (pagare_id) references public.credito_firmas (id);
create index if not exists nomina_cargos_pagare_idx on public.nomina_cargos (pagare_id);

-- Nada se reescribe: solo se puede revocar (una vez).
create or replace function public.credito_firmas_inmutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Un documento firmado no se borra.'; end if;
  if (to_jsonb(new) - 'revocada_en' - 'revocada_motivo') is distinct from (to_jsonb(old) - 'revocada_en' - 'revocada_motivo')
     or old.revocada_en is not null then
    raise exception 'Un documento firmado no se modifica (solo se revoca una vez).';
  end if;
  return new;
end;
$$;
drop trigger if exists credito_firmas_inmutable on public.credito_firmas;
create trigger credito_firmas_inmutable before update or delete on public.credito_firmas
  for each row execute function public.credito_firmas_inmutable();

alter table public.credito_firmas enable row level security;
drop policy if exists frontera_organizacion on public.credito_firmas;
create policy frontera_organizacion on public.credito_firmas as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
drop policy if exists espectador_sin_datos on public.credito_firmas;
create policy espectador_sin_datos on public.credito_firmas as restrictive for select to authenticated
  using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.credito_firmas;
create policy director_general on public.credito_firmas for all to authenticated
  using ((select public.auth_admin_global_definer()))
  with check ((select public.auth_admin_global_definer()));
-- Leer: el trabajador lo suyo; RH, dirección y admin los de su organización.
-- Escribir solo por fn_credito_firmar / fn_credito_revocar.
drop policy if exists credito_firmas_ver on public.credito_firmas;
create policy credito_firmas_ver on public.credito_firmas for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.auth_opera_cuentas_nomina()));
drop trigger if exists solo_consulta on public.credito_firmas;
create trigger solo_consulta before insert or update or delete on public.credito_firmas
  for each statement execute function public.bloquear_solo_consulta();
grant select on public.credito_firmas to authenticated;

-- ¿Tiene afiliación y consentimiento vigentes?
create or replace function public.fn_credito_afiliado(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.credito_firmas where profile_id = p_profile and tipo = 'afiliacion' and revocada_en is null)
     and exists (select 1 from public.credito_firmas where profile_id = p_profile and tipo = 'consentimiento' and revocada_en is null)
$$;
-- Solo para las funciones de aquí (la pantalla lo lee de fn_nomina_disponible).
revoke execute on function public.fn_credito_afiliado(uuid) from public, anon, authenticated;

-- Firmar (solo la persona misma, en su sesión).
create or replace function public.fn_credito_firmar(p_tipo text, p_version text, p_titulo text, p_contenido text, p_firma text,
                                                   p_cargo uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := auth.uid();
  p public.profiles;
  c public.nomina_cargos;
  v_id uuid;
  v_headers json;
begin
  select * into p from public.profiles where id = v_yo;
  if p.id is null or not p.activo or p.rol = 'pendiente' or p.espectador then raise exception 'Tu cuenta no puede firmar documentos.'; end if;
  if p_tipo not in ('afiliacion', 'consentimiento', 'pagare') then raise exception 'Documento no reconocido.'; end if;
  if p_tipo = 'pagare' then
    select * into c from public.nomina_cargos where id = p_cargo for update;
    if c.id is null or c.profile_id <> v_yo then raise exception 'Ese préstamo no es tuyo.'; end if;
    if c.estatus <> 'por_firmar' then raise exception 'Ese préstamo ya no espera firma.'; end if;
  elsif p_cargo is not null then
    raise exception 'Solo el pagaré va ligado a un préstamo.';
  elsif exists (select 1 from public.credito_firmas where profile_id = v_yo and tipo = p_tipo and revocada_en is null) then
    raise exception 'Ya firmaste ese documento.';
  end if;
  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then v_headers := null;
  end;
  insert into public.credito_firmas (grupo_id, profile_id, tipo, version, titulo, contenido, firma, hash, cargo_id, firmante_nombre, ip, agente)
  values (p.grupo_id, v_yo, p_tipo, btrim(p_version), btrim(p_titulo), p_contenido, p_firma,
          encode(sha256(convert_to(p_contenido || '|' || p_firma, 'UTF8')), 'hex'), p_cargo, p.nombre,
          nullif(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), ''), left(v_headers ->> 'user-agent', 300))
  returning id into v_id;
  if p_tipo = 'pagare' then
    update public.nomina_cargos set estatus = 'vigente', pagare_id = v_id, firmado_en = now() where id = c.id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.fn_credito_firmar(text, text, text, text, text, uuid) from public, anon;
grant execute on function public.fn_credito_firmar(text, text, text, text, text, uuid) to authenticated;

-- Revocar afiliación o consentimiento (la persona o RH), sin saldos.
create or replace function public.fn_credito_revocar(p_firma uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare f public.credito_firmas;
begin
  select * into f from public.credito_firmas where id = p_firma for update;
  if f.id is null or not (f.grupo_id = any (public.auth_grupos_alcance())) then raise exception 'Documento no encontrado.'; end if;
  if not (f.profile_id = auth.uid() or public.auth_opera_cuentas_nomina()) then raise exception 'Sin permiso.'; end if;
  if f.tipo = 'pagare' then raise exception 'Un pagaré no se revoca: se liquida.'; end if;
  if f.revocada_en is not null then raise exception 'Ya estaba revocado.'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Escribe el motivo.'; end if;
  if exists (select 1 from public.nomina_cargos where profile_id = f.profile_id and estatus in ('vigente', 'por_firmar')) then
    raise exception 'Tiene saldos pendientes: primero se liquidan.';
  end if;
  update public.credito_firmas set revocada_en = now(), revocada_motivo = btrim(p_motivo) where id = f.id;
end;
$$;
revoke execute on function public.fn_credito_revocar(uuid, text) from public, anon;
grant execute on function public.fn_credito_revocar(uuid, text) to authenticated;

-- 4) Saldos sobre el total -----------------------------------------------------------
create or replace function public.nomina_descuentos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.nomina_cargos; v_pagado numeric;
begin
  select * into c from public.nomina_cargos where id = new.cargo_id for update;
  if c.id is null then raise exception 'Cargo no encontrado.'; end if;
  if c.estatus <> 'vigente' then raise exception 'Ese cargo no está vigente (¿falta firmar el pagaré?).'; end if;
  select coalesce(sum(monto), 0) into v_pagado from public.nomina_descuentos where cargo_id = c.id;
  if v_pagado + new.monto > c.total + 0.005 then
    raise exception 'El descuento pasa del saldo (%).', c.total - v_pagado;
  end if;
  new.grupo_id := c.grupo_id;
  new.profile_id := c.profile_id;
  select nullif(btrim(nombre), '') into new.aplicado_por_nombre from public.profiles where id = new.aplicado_por;
  return new;
end;
$$;

create or replace function public.nomina_descuentos_despues()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.nomina_cargos c
     set estatus = 'liquidado'
   where c.id = new.cargo_id and c.estatus = 'vigente'
     and (select coalesce(sum(monto), 0) from public.nomina_descuentos d where d.cargo_id = c.id) >= c.total - 0.005;
  return null;
end;
$$;

create or replace function public.pv_ventas_cancela_nomina()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'cancelada' and old.estado <> 'cancelada' then
    if exists (select 1 from public.nomina_descuentos d join public.nomina_cargos c on c.id = d.cargo_id where c.pv_venta_id = new.id) then
      raise exception 'Esta venta ya se empezó a descontar vía nómina: registra una devolución en lugar de cancelarla.';
    end if;
    update public.nomina_cargos set estatus = 'cancelado' where pv_venta_id = new.id and estatus in ('vigente', 'por_firmar');
  end if;
  return new;
end;
$$;

drop view if exists public.v_nomina_cargos;
create view public.v_nomina_cargos with (security_invoker = true) as
select c.*, e.nombre as empresa, a.nombre as acreditante,
       coalesce(d.pagado, 0) as pagado,
       round(c.total - coalesce(d.pagado, 0), 2) as saldo,
       case when c.estatus <> 'vigente' then 0
            else round(greatest(least(c.total,
                   c.descuento_por_pago * greatest(0, least(c.pagos, floor(((now() at time zone 'America/Mexico_City')::date - c.primer_descuento) / 7.0)::int + 1)))
                 - coalesce(d.pagado, 0), 0), 2) end as atraso,
       case when c.estatus <> 'vigente' then 0
            else least(c.descuento_por_pago, round(c.total - coalesce(d.pagado, 0), 2)) end as siguiente_descuento,
       d.ultimo as ultimo_descuento
  from public.nomina_cargos c
  left join public.empresas e on e.id = c.empresa_id
  left join public.empresas a on a.id = c.acreditante_empresa_id
  left join lateral (select sum(x.monto) as pagado, max(x.fecha) as ultimo from public.nomina_descuentos x where x.cargo_id = c.id) d on true;
grant select on public.v_nomina_cargos to authenticated;

-- 5) Disponible y alta de cargos con firma e intereses -----------------------------
create or replace function public.fn_nomina_disponible(p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.cuentas_nomina;
  cfg public.nomina_financiamiento_config;
  v_saldo numeric;
  v_atraso numeric;
  v_por_firmar integer;
  t record;
begin
  if not (p_profile = auth.uid() or public.auth_opera_cuentas_nomina() or public.auth_opera_pv()) then
    raise exception 'Sin permiso para ver la cuenta de nómina.';
  end if;
  select * into c from public.cuentas_nomina where profile_id = p_profile;
  if c.profile_id is null or not (c.grupo_id = any (public.auth_grupos_alcance())) then
    return jsonb_build_object('tiene', false, 'afiliado', public.fn_credito_afiliado(p_profile));
  end if;
  cfg := public.fn_nomina_config(c.grupo_id);
  select coalesce(sum(saldo), 0), coalesce(sum(atraso), 0), count(*) filter (where estatus = 'por_firmar')
    into v_saldo, v_atraso, v_por_firmar
    from public.v_nomina_cargos where profile_id = p_profile and estatus in ('vigente', 'por_firmar');
  select * into t from public.fn_nomina_topes(c.grupo_id, c.sueldo_semanal);
  return jsonb_build_object(
    'tiene', true, 'nivel', c.nivel, 'estatus', c.estatus, 'linea', c.linea, 'saldo', v_saldo,
    'disponible', case when c.estatus = 'activa' and v_atraso = 0 then greatest(c.linea - v_saldo, 0) else 0 end,
    'atraso', v_atraso, 'plazo_max_semanas', c.plazo_max_semanas,
    'descuento_maximo', t.descuento_maximo, 'deuda_maxima', t.deuda_maxima,
    'afiliado', public.fn_credito_afiliado(p_profile), 'por_firmar', v_por_firmar,
    'tasa_anual_prestamos', case when cfg.acreditante_empresa_id is not null then cfg.tasa_anual_prestamos else 0 end,
    'plazo_max_semanas_intereses', cfg.plazo_max_semanas_intereses,
    'capacidad_pago', round(coalesce(c.sueldo_semanal, 0) * cfg.capacidad_pago_pct / 100, 2));
end;
$$;

create or replace function public.fn_nomina_crear_cargo(p_profile uuid, p_origen text, p_concepto text, p_monto numeric,
                                                        p_pagos integer, p_venta uuid default null, p_primer_descuento date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.cuentas_nomina;
  cfg public.nomina_financiamiento_config;
  v_disp jsonb;
  v_empresa uuid;
  v_tasa numeric := 0;
  v_i numeric;
  v_pago_base numeric;
  v_interes numeric := 0;
  v_iva numeric := 0;
  v_tope numeric;
  v_plazo integer;
  v_por_pago numeric;
  v_id uuid;
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
begin
  if p_origen = 'punto_venta' then
    if not public.auth_opera_pv() then raise exception 'Sin permiso.'; end if;
  elsif not public.auth_opera_cuentas_nomina() then
    raise exception 'Los préstamos y anticipos los registra RH, dirección o admin.';
  end if;
  select * into c from public.cuentas_nomina where profile_id = p_profile for update;
  if c.profile_id is null or c.linea <= 0 then raise exception 'Esta persona no tiene línea de crédito de nómina autorizada.'; end if;
  if c.estatus <> 'activa' then raise exception 'La cuenta de nómina está suspendida.'; end if;
  if not public.fn_credito_afiliado(p_profile) then
    raise exception 'Falta que el trabajador firme su afiliación y su consentimiento de descuento en su app (Mi personaje → Mi QR).';
  end if;
  cfg := public.fn_nomina_config(c.grupo_id);
  select empresa_id into v_empresa from public.profiles where id = p_profile;
  v_disp := public.fn_nomina_disponible(p_profile);
  if (v_disp ->> 'atraso')::numeric > 0 then raise exception 'Tiene descuentos atrasados: primero hay que ponerse al corriente.'; end if;
  if p_monto > (v_disp ->> 'disponible')::numeric + 0.005 then
    raise exception 'Rebasa su disponible: %.', v_disp ->> 'disponible';
  end if;

  -- Préstamo con intereses: solo de la financiera, nunca del patrón (art. 111 LFT).
  if p_origen = 'prestamo' and cfg.tasa_anual_prestamos > 0 then
    if cfg.acreditante_empresa_id is null then
      raise exception 'Hay tasa de interés pero no hay financiera configurada (Reglas).';
    end if;
    if cfg.acreditante_empresa_id = v_empresa then
      raise exception 'La empresa que emplea al trabajador no puede cobrarle intereses (art. 111 LFT): el préstamo con intereses lo otorga la financiera.';
    end if;
    v_tasa := cfg.tasa_anual_prestamos;
  end if;

  v_plazo := case when v_tasa > 0 then cfg.plazo_max_semanas_intereses else c.plazo_max_semanas end;
  if p_pagos is null or p_pagos < 1 or p_pagos > v_plazo then
    raise exception 'El plazo va de 1 a % pagos semanales.', v_plazo;
  end if;
  if v_tasa > 0 then
    v_i := v_tasa / 100 / 52;
    v_pago_base := p_monto * v_i / (1 - power(1 + v_i, -p_pagos));
    v_interes := round(v_pago_base * p_pagos - p_monto, 2);
    v_iva := round(v_interes * cfg.iva_intereses / 100, 2);
    v_tope := round(coalesce(c.sueldo_semanal, 0) * cfg.capacidad_pago_pct / 100, 2);
  else
    v_tope := (v_disp ->> 'descuento_maximo')::numeric;
  end if;
  if p_monto + v_interes + v_iva > (v_disp ->> 'disponible')::numeric + 0.005 then
    raise exception 'Con intereses e IVA suma % y su disponible es %.', round(p_monto + v_interes + v_iva, 2), v_disp ->> 'disponible';
  end if;
  v_por_pago := round(ceil((p_monto + v_interes + v_iva) / p_pagos * 100) / 100, 2);
  if v_por_pago > v_tope + 0.005 then
    if v_tasa > 0 then
      raise exception 'Cada descuento sería de % y su capacidad de pago es % por semana (% %% del sueldo). Usa más pagos.',
        v_por_pago, v_tope, cfg.capacidad_pago_pct;
    end if;
    raise exception 'Cada descuento sería de % y la ley permite máximo % por semana (30 %% del excedente del mínimo). Usa más pagos.',
      v_por_pago, v_tope;
  end if;
  insert into public.nomina_cargos (grupo_id, profile_id, trabajador_nombre, empresa_id, origen, pv_venta_id, concepto, monto, pagos, descuento_por_pago,
                                    primer_descuento, created_by_nombre, estatus, acreditante_empresa_id, tasa_anual, tasa_moratoria_anual,
                                    iva_intereses, interes, iva_interes, cat)
  values (c.grupo_id, p_profile, (select nombre from public.profiles where id = p_profile), v_empresa, p_origen, p_venta,
          btrim(p_concepto), round(p_monto, 2), p_pagos, v_por_pago,
          coalesce(p_primer_descuento, v_hoy + ((5 - extract(isodow from v_hoy)::int + 7) % 7)),  -- el viernes siguiente
          (select nullif(btrim(nombre), '') from public.profiles where id = auth.uid()),
          case when p_origen = 'punto_venta' then 'vigente' else 'por_firmar' end,
          case when v_tasa > 0 then cfg.acreditante_empresa_id else v_empresa end,
          v_tasa, case when v_tasa > 0 then cfg.tasa_moratoria_anual else 0 end,
          case when v_tasa > 0 then cfg.iva_intereses else 0 end, v_interes, v_iva,
          case when v_tasa > 0 then round(((power(1 + v_i, 52) - 1) * 100)::numeric, 1) else 0 end)
  returning id into v_id;
  return v_id;
end;
$$;

-- Cancelar un préstamo que nunca se firmó (RH).
create or replace function public.fn_nomina_cancelar_por_firmar(p_cargo uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.auth_opera_cuentas_nomina() then raise exception 'Sin permiso.'; end if;
  update public.nomina_cargos set estatus = 'cancelado',
         concepto = concepto || ' · cancelado: ' || coalesce(nullif(btrim(p_motivo), ''), 'sin firma')
   where id = p_cargo and estatus = 'por_firmar' and grupo_id = any (public.auth_grupos_alcance());
  if not found then raise exception 'Solo se cancelan préstamos que aún esperan firma.'; end if;
end;
$$;
revoke execute on function public.fn_nomina_cancelar_por_firmar(uuid, text) from public, anon;
grant execute on function public.fn_nomina_cancelar_por_firmar(uuid, text) to authenticated;

-- 6) Datos para armar los documentos (el trabajador no lee empresas ajenas) ---
create or replace function public.fn_credito_parte(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when e.id is null then null else jsonb_build_object(
           'razon_social', coalesce(nullif(btrim(e.razon_social), ''), nullif(btrim(pl.razon_social), ''), e.nombre),
           'rfc', coalesce(nullif(btrim(e.rfc), ''), nullif(btrim(pl.rfc), '')),
           'domicilio', coalesce(nullif(btrim(e.domicilio_fiscal), ''), nullif(btrim(pl.domicilio_legal), '')),
           'ciudad', nullif(btrim(pl.ciudad_firma), '')) end
    from (select p_empresa as id) x
    left join public.empresas e on e.id = x.id
    left join public.empresas_perfil_legal pl on pl.empresa_id = x.id
$$;
revoke execute on function public.fn_credito_parte(uuid) from public, anon, authenticated;

create or replace function public.fn_credito_datos_documentos(p_cargo uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
  cfg public.nomina_financiamiento_config;
  c public.nomina_cargos;
  v_patron jsonb;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'Sin sesión.'; end if;
  cfg := public.fn_nomina_config(p.grupo_id);
  v_patron := public.fn_credito_parte(p.empresa_id);
  if p_cargo is not null then
    select * into c from public.nomina_cargos where id = p_cargo and profile_id = p.id;
    if c.id is null then raise exception 'Ese préstamo no es tuyo.'; end if;
  end if;
  return jsonb_build_object(
    'trabajador', p.nombre,
    'puesto', (select pe.puesto from public.personal pe where pe.profile_id = p.id and pe.activo limit 1),
    'patron', v_patron,
    'financiera', case when cfg.acreditante_empresa_id is not null and cfg.tasa_anual_prestamos > 0
                       then public.fn_credito_parte(cfg.acreditante_empresa_id) end,
    'ciudad', coalesce(v_patron ->> 'ciudad', 'Puebla, Puebla'),
    'cargo', case when c.id is null then null else jsonb_build_object(
      'id', c.id, 'concepto', c.concepto, 'monto', c.monto, 'pagos', c.pagos, 'tasa_anual', c.tasa_anual,
      'iva_intereses', c.iva_intereses, 'tasa_moratoria_anual', c.tasa_moratoria_anual, 'primer_descuento', c.primer_descuento,
      'total', c.total, 'descuento_por_pago', c.descuento_por_pago, 'estatus', c.estatus,
      'acreedor', public.fn_credito_parte(c.acreditante_empresa_id)) end);
end;
$$;
revoke execute on function public.fn_credito_datos_documentos(uuid) from public, anon;
grant execute on function public.fn_credito_datos_documentos(uuid) to authenticated;
