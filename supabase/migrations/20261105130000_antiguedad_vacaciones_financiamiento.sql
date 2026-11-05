-- Antigüedad mínima (5-nov-2026, Mario: "el botón de las vacaciones se
-- activa después del año trabajando de antigüedad y el botón de
-- financiamiento después de dos").
--
-- 1) Vacaciones: antes `fn_vacaciones_saldo` daba los 12 días del primer año
--    desde el día uno. Ahora los días de ley se ganan al CUMPLIR cada año
--    (art. 76 LFT): con menos de un año no hay saldo ni botón; al cumplir el
--    año 1 hay 12 días para gozar en el año 2, al cumplir el 2, 14, etc. RH,
--    dirección y admin pueden registrar vacaciones aunque no cumpla (como ya
--    podían exceder el saldo); permisos e incapacidades no cambian.
-- 2) Financiamiento (cuentas de nómina): la antigüedad mínima pasa de 3 a 24
--    meses (configurable por organización en Reglas) y ahora la exige la base,
--    no solo la pantalla: no se autoriza línea (`cuentas_nomina_antes`) ni se
--    firma la afiliación/consentimiento (`fn_credito_firmar`) antes de
--    cumplirla. `fn_credito_datos_documentos` dice desde cuándo se habilita
--    para que la app del trabajador lo muestre en vez del botón.

-- ── Antigüedad en meses de una cuenta (su expediente activo más antiguo) ──
create or replace function public.fn_antiguedad_meses(p_profile uuid)
returns int language sql stable security definer set search_path = public as $$
  select (extract(year from age(current_date, min(pe.fecha_ingreso))) * 12
          + extract(month from age(current_date, min(pe.fecha_ingreso))))::int
    from public.personal pe
   where pe.profile_id = p_profile and pe.activo and pe.fecha_baja is null and pe.fecha_ingreso is not null
$$;
revoke all on function public.fn_antiguedad_meses(uuid) from public, anon, authenticated;

create or replace function public.fn_antiguedad_desde(p_profile uuid, p_meses int)
returns date language sql stable security definer set search_path = public as $$
  select min(pe.fecha_ingreso) + make_interval(months => p_meses)
    from public.personal pe
   where pe.profile_id = p_profile and pe.activo and pe.fecha_baja is null and pe.fecha_ingreso is not null
$$;
revoke all on function public.fn_antiguedad_desde(uuid, int) from public, anon, authenticated;

-- ── 1) Vacaciones ────────────────────────────────────────────────────────
create or replace function public.fn_vacaciones_saldo(p_personal uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v public.personal%rowtype;
  v_anios int; v_periodo_desde date; v_periodo_hasta date; v_ley int; v_tomados int; v_pendientes int;
  v_dias_semana int;
begin
  select * into v from public.personal where id = p_personal;
  if v.id is null then return null; end if;
  if not (v.profile_id = auth.uid() or public.auth_opera_vacaciones()
          or (v.profile_id is not null and public.auth_ve_checador_de(v.profile_id))
          or v.supervisor_profile_id = auth.uid()) then
    return null;
  end if;
  v_anios := greatest(extract(year from age(current_date, v.fecha_ingreso))::int, 0);
  v_periodo_desde := v.fecha_ingreso + make_interval(years => v_anios);
  v_periodo_hasta := v_periodo_desde + interval '1 year' - interval '1 day';
  -- Días ganados al cumplir el último aniversario; con menos de un año, nada.
  v_ley := case when v_anios < 1 then 0 else public.fn_vacaciones_dias_ley(v_anios) end;
  select coalesce(sum(dias), 0) into v_tomados from public.vacaciones
   where personal_id = v.id and tipo = 'vacaciones' and estado = 'autorizada' and desde between v_periodo_desde and v_periodo_hasta;
  select coalesce(sum(dias), 0) into v_pendientes from public.vacaciones
   where personal_id = v.id and tipo = 'vacaciones' and estado = 'solicitada' and desde between v_periodo_desde and v_periodo_hasta;
  select coalesce(pj.dias_semana, 6) into v_dias_semana from public.perfiles_jornada pj where pj.id = v.perfil_jornada_id;
  return jsonb_build_object(
    'personal_id', v.id, 'nombre', v.nombre, 'fecha_ingreso', v.fecha_ingreso,
    'anios_cumplidos', v_anios, 'anio_servicio', v_anios + 1,
    'periodo_desde', v_periodo_desde, 'periodo_hasta', v_periodo_hasta,
    'dias_ley', v_ley, 'tomados', v_tomados, 'pendientes', v_pendientes,
    'disponibles', v_ley - v_tomados - v_pendientes,
    'habilitado', v_anios >= 1,
    'habilitado_desde', v.fecha_ingreso + interval '1 year',
    'dias_semana', coalesce(v_dias_semana, 6));
end;
$$;

create or replace function public.fn_vacaciones_solicitar(p_personal uuid, p_tipo text, p_desde date, p_hasta date, p_notas text default null, p_cubre uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_yo public.profiles%rowtype;
  v public.personal%rowtype;
  v_opera boolean;
  v_dias_semana int;
  v_dias int;
  v_saldo jsonb;
  v_id uuid;
  v_estado text;
  v_cubre_nombre text;
  v_avisar uuid[];
  v_regresa date;
begin
  select * into v_yo from public.profiles where id = auth.uid();
  if v_yo.id is null or v_yo.rol = 'pendiente' or coalesce(v_yo.espectador, false) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select * into v from public.personal where id = p_personal;
  if v.id is null or v.grupo_id is distinct from v_yo.grupo_id or not v.activo or v.fecha_baja is not null then
    raise exception 'Elige a una persona activa de tu organización.';
  end if;
  v_opera := public.auth_opera_vacaciones();
  if not (v_opera or v.profile_id = v_yo.id or v.supervisor_profile_id = v_yo.id) then
    raise exception 'Solo la persona, su jefe directo o RH piden vacaciones.' using errcode = '42501';
  end if;
  if p_tipo not in ('vacaciones', 'permiso_con_goce', 'permiso_sin_goce', 'incapacidad') then
    raise exception 'Tipo no válido';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then raise exception 'Revisa las fechas: el regreso no puede ser antes de la salida.'; end if;
  if p_hasta - p_desde > 120 then raise exception 'Máximo 120 días por registro.'; end if;
  if p_desde < current_date - 60 and not v_opera then raise exception 'Solo RH registra ausencias de hace más de 60 días.'; end if;
  if exists (select 1 from public.vacaciones x where x.personal_id = v.id and x.estado in ('solicitada', 'autorizada')
               and x.desde <= p_hasta and x.hasta >= p_desde) then
    raise exception 'Ya hay una ausencia registrada que se encima con esas fechas.';
  end if;
  select coalesce(pj.dias_semana, 6) into v_dias_semana from public.perfiles_jornada pj where pj.id = v.perfil_jornada_id;
  v_dias_semana := coalesce(v_dias_semana, 6);
  v_dias := public.fn_dias_habiles_lft(p_desde, p_hasta, v_dias_semana);
  if v_dias = 0 then raise exception 'Esas fechas no tienen días hábiles.'; end if;
  if p_tipo = 'vacaciones' then
    v_saldo := public.fn_vacaciones_saldo(v.id);
    -- Las vacaciones se habilitan al cumplir un año (5-nov-2026, Mario).
    if not coalesce((v_saldo->>'habilitado')::boolean, false) and not v_opera then
      raise exception 'Las vacaciones se habilitan al cumplir un año de antigüedad: a partir del %. Mientras, pide un permiso o habla con RH.',
        to_char((v_saldo->>'habilitado_desde')::date, 'DD/MM/YYYY');
    end if;
    if (v_saldo->>'disponibles')::int < v_dias and not v_opera then
      raise exception 'Pides % días y tienes % disponibles en tu periodo (% de ley, % ya tomados o pendientes). Habla con RH.',
        v_dias, (v_saldo->>'disponibles')::int, v_saldo->>'dias_ley', (v_saldo->>'tomados')::int + (v_saldo->>'pendientes')::int;
    end if;
  end if;
  if p_cubre is not null then
    select p.nombre into v_cubre_nombre from public.profiles p where p.id = p_cubre and p.grupo_id = v_yo.grupo_id and p.activo;
    if v_cubre_nombre is null then raise exception 'Quien cubre debe tener cuenta activa en tu organización.'; end if;
  end if;
  v_regresa := public.fn_siguiente_habil_lft(p_hasta, v_dias_semana);
  v_estado := case when v_opera then 'autorizada' else 'solicitada' end;
  insert into public.vacaciones (grupo_id, personal_id, profile_id, personal_nombre, empresa_id, tipo, desde, hasta, dias, regresa_el,
                                 cubre_profile_id, cubre_nombre, notas, estado, solicitado_por, solicitante_nombre, resuelta_por, resuelta_en)
  values (v.grupo_id, v.id, v.profile_id, v.nombre, (select pr.empresa_id from public.profiles pr where pr.id = v.profile_id),
          p_tipo, p_desde, p_hasta, v_dias, v_regresa, p_cubre, v_cubre_nombre, nullif(btrim(coalesce(p_notas, '')), ''),
          v_estado, v_yo.id, v_yo.nombre,
          case when v_opera then v_yo.id end, case when v_opera then now() end)
  returning id into v_id;

  if v_estado = 'solicitada' then
    v_avisar := public.fn_rh_de(v.grupo_id);
    if v.supervisor_profile_id is not null then v_avisar := v_avisar || v.supervisor_profile_id; end if;
    v_avisar := array(select distinct u from unnest(v_avisar) u where u <> v_yo.id);
    perform public.fn_push_aviso(v_avisar, 'Solicitud de ' || public.fn_vacaciones_etiqueta(p_tipo) || ' por autorizar',
      v.nombre || ' · del ' || to_char(p_desde, 'DD/MM') || ' al ' || to_char(p_hasta, 'DD/MM') || ' · ' || v_dias || ' días · regresa el ' || to_char(v_regresa, 'DD/MM'),
      '/vacaciones?tab=equipo');
  else
    v_avisar := '{}';
    if v.profile_id is not null and v.profile_id <> v_yo.id then v_avisar := v_avisar || v.profile_id; end if;
    if v.supervisor_profile_id is not null and v.supervisor_profile_id <> v_yo.id then v_avisar := v_avisar || v.supervisor_profile_id; end if;
    if p_cubre is not null and p_cubre <> v_yo.id then v_avisar := v_avisar || p_cubre; end if;
    if array_length(v_avisar, 1) > 0 then
      perform public.fn_push_aviso(v_avisar, public.fn_vacaciones_etiqueta(p_tipo) || ' registradas: ' || v.nombre,
        'Del ' || to_char(p_desde, 'DD/MM') || ' al ' || to_char(p_hasta, 'DD/MM') || ' · regresa el ' || to_char(v_regresa, 'DD/MM')
        || case when v_cubre_nombre is not null then ' · cubre ' || v_cubre_nombre else '' end,
        '/vacaciones');
    end if;
  end if;
  return jsonb_build_object('id', v_id, 'estado', v_estado, 'dias', v_dias, 'regresa_el', v_regresa);
end;
$$;

-- ── 2) Financiamiento: 24 meses y lo exige la base ───────────────────────
alter table public.nomina_financiamiento_config alter column antiguedad_minima_meses set default 24;
update public.nomina_financiamiento_config set antiguedad_minima_meses = 24 where antiguedad_minima_meses < 24;

create or replace function public.fn_nomina_config(p_grupo uuid)
returns public.nomina_financiamiento_config language plpgsql stable security definer set search_path = public as $$
declare r public.nomina_financiamiento_config;
begin
  select * into r from public.nomina_financiamiento_config where grupo_id = p_grupo;
  if r.grupo_id is null then
    r.grupo_id := p_grupo;
    r.salario_minimo_diario := 315.04;
    r.pct_excedente := 30;
    r.antiguedad_minima_meses := 24;
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

create or replace function public.cuentas_nomina_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_deuda numeric; v_min int; v_meses int;
begin
  select grupo_id into new.grupo_id from public.profiles where id = new.profile_id;
  if new.grupo_id is null then raise exception 'La persona no tiene organización.'; end if;
  if new.linea > 0 then
    if new.sueldo_semanal is null then raise exception 'Captura el sueldo semanal antes de autorizar una línea.'; end if;
    select deuda_maxima into v_deuda from public.fn_nomina_topes(new.grupo_id, new.sueldo_semanal);
    if new.linea > v_deuda + 0.005 then
      raise exception 'La línea (%) pasa del salario de un mes (%): art. 110-I LFT.', new.linea, v_deuda;
    end if;
    -- Antigüedad mínima (5-nov-2026, Mario: financiamiento después de dos años).
    if tg_op = 'INSERT' or coalesce(old.linea, 0) <= 0 or new.linea > old.linea then
      v_min := (public.fn_nomina_config(new.grupo_id)).antiguedad_minima_meses;
      v_meses := public.fn_antiguedad_meses(new.profile_id);
      if v_meses is null then
        raise exception 'La persona no tiene expediente activo con fecha de ingreso: RH lo captura antes de autorizar financiamiento.';
      end if;
      if v_meses < v_min then
        raise exception 'Financiamiento solo con % meses de antigüedad; lleva % (se habilita el %).',
          v_min, v_meses, to_char(public.fn_antiguedad_desde(new.profile_id, v_min), 'DD/MM/YYYY');
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' or new.linea is distinct from old.linea or new.nivel is distinct from old.nivel or new.plazo_max_semanas is distinct from old.plazo_max_semanas then
    new.autorizada_por := auth.uid();
    new.autorizada_en := now();
    select nullif(btrim(nombre), '') into new.autorizada_por_nombre from public.profiles where id = auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.fn_credito_firmar(p_tipo text, p_version text, p_titulo text, p_contenido text, p_firma text,
                                                   p_cargo uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := auth.uid();
  p public.profiles;
  c public.nomina_cargos;
  v_id uuid;
  v_headers json;
  v_min int; v_meses int;
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
  else
    -- Afiliación y consentimiento solo con la antigüedad mínima (5-nov-2026).
    v_min := (public.fn_nomina_config(p.grupo_id)).antiguedad_minima_meses;
    v_meses := public.fn_antiguedad_meses(v_yo);
    if v_meses is null or v_meses < v_min then
      raise exception 'El financiamiento se habilita con % meses de antigüedad%.', v_min,
        case when v_meses is null then ' (tu expediente de RH no tiene fecha de ingreso)'
             else ': a partir del ' || to_char(public.fn_antiguedad_desde(v_yo, v_min), 'DD/MM/YYYY') end;
    end if;
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

create or replace function public.fn_credito_datos_documentos(p_cargo uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
  cfg public.nomina_financiamiento_config;
  c public.nomina_cargos;
  v_patron jsonb;
  v_meses int;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'Sin sesión.'; end if;
  cfg := public.fn_nomina_config(p.grupo_id);
  v_patron := public.fn_credito_parte(p.empresa_id);
  v_meses := public.fn_antiguedad_meses(p.id);
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
    'antiguedad_minima_meses', cfg.antiguedad_minima_meses,
    'meses_antiguedad', v_meses,
    'financiamiento_habilitado', coalesce(v_meses >= cfg.antiguedad_minima_meses, false),
    'financiamiento_desde', public.fn_antiguedad_desde(p.id, cfg.antiguedad_minima_meses),
    'cargo', case when c.id is null then null else jsonb_build_object(
      'id', c.id, 'concepto', c.concepto, 'monto', c.monto, 'pagos', c.pagos, 'tasa_anual', c.tasa_anual,
      'iva_intereses', c.iva_intereses, 'tasa_moratoria_anual', c.tasa_moratoria_anual, 'primer_descuento', c.primer_descuento,
      'total', c.total, 'descuento_por_pago', c.descuento_por_pago, 'estatus', c.estatus,
      'acreedor', public.fn_credito_parte(c.acreditante_empresa_id)) end);
end;
$$;
