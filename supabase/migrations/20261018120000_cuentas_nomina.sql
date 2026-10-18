-- Cuenta de nómina y financiamiento a trabajadores (18-oct-2026, Mario:
-- "llevaría una cuenta para descontarse vía nómina; vamos a hacer un estudio,
-- ya que por antigüedad y por buen comportamiento y pago daremos
-- financiamiento estilo Mercado Pago").
--
-- Lo que manda la ley (LFT) y aquí se respeta:
--   * Art. 111: las deudas del trabajador con el patrón NO generan intereses.
--     Todo plazo es sin intereses.
--   * Art. 110-I: la deuda no puede pasar del salario de un mes, y cada
--     descuento no puede ser mayor al 30 % del excedente del salario mínimo.
--
-- Piezas:
--   * nomina_financiamiento_config: salario mínimo diario (2026 zona general:
--     $315.04), % del excedente (30) y antigüedad mínima (meses).
--   * cuentas_nomina: la línea autorizada de cada persona (nivel, plazo
--     máximo en semanas, sueldo semanal con el que se calculó). Un trigger no
--     deja autorizar más de un mes de sueldo.
--   * nomina_cargos: lo que se le carga (compra en el mostrador, préstamo o
--     anticipo), en N pagos semanales; nomina_descuentos: lo que RH ya
--     descontó. Saldo y atraso se calculan (v_nomina_cargos).
--   * fn_estudio_financiamiento(): los datos del estudio por persona
--     (antigüedad, sueldo, constancia, cumplimiento, cuidado de activos,
--     historial de pagos); el puntaje y el nivel se calculan en
--     web/src/lib/cuentaNomina.ts.
--   * fn_pv_cobrar acepta la forma de pago 'nomina' (empleado leído con su
--     credencial QR): valida línea, plazo y tope legal, y crea el cargo.
-- Operan admin, dirección y RH (auth_opera_cuentas_nomina); cada quien ve su
-- propia cuenta. Ya aplicado en producción.

create or replace function public.auth_opera_cuentas_nomina()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo and not p.espectador
                  and p.rol in ('admin', 'direccion', 'rh'))
$$;

create table if not exists public.nomina_financiamiento_config (
  grupo_id uuid primary key references public.grupos (id),
  salario_minimo_diario numeric(10,2) not null default 315.04 check (salario_minimo_diario > 0),
  pct_excedente numeric(5,2) not null default 30 check (pct_excedente > 0 and pct_excedente <= 30),
  antiguedad_minima_meses integer not null default 3 check (antiguedad_minima_meses >= 0),
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cuentas_nomina (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  grupo_id uuid not null references public.grupos (id),
  sueldo_semanal numeric(12,2) check (sueldo_semanal is null or sueldo_semanal > 0),
  linea numeric(12,2) not null default 0 check (linea >= 0),
  plazo_max_semanas integer not null default 2 check (plazo_max_semanas between 1 and 12),
  nivel text not null default 'sin_acceso' check (nivel in ('sin_acceso', 'bronce', 'plata', 'oro', 'diamante')),
  puntaje integer,
  estatus text not null default 'activa' check (estatus in ('activa', 'suspendida')),
  notas text,
  autorizada_por uuid references public.profiles (id),
  autorizada_por_nombre text,
  autorizada_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cuentas_nomina_grupo_idx on public.cuentas_nomina (grupo_id);
create index if not exists cuentas_nomina_autorizada_por_idx on public.cuentas_nomina (autorizada_por);

create table if not exists public.nomina_cargos (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  profile_id uuid not null references public.profiles (id),
  trabajador_nombre text,
  empresa_id uuid references public.empresas (id),
  origen text not null check (origen in ('punto_venta', 'prestamo', 'anticipo', 'otro')),
  pv_venta_id uuid references public.pv_ventas (id),
  concepto text not null check (btrim(concepto) <> ''),
  monto numeric(12,2) not null check (monto > 0),
  pagos integer not null check (pagos between 1 and 12),
  descuento_por_pago numeric(12,2) not null check (descuento_por_pago > 0),
  primer_descuento date not null,
  estatus text not null default 'vigente' check (estatus in ('vigente', 'liquidado', 'cancelado')),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_by_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists nomina_cargos_profile_idx on public.nomina_cargos (profile_id, estatus);
create index if not exists nomina_cargos_grupo_idx on public.nomina_cargos (grupo_id);
create index if not exists nomina_cargos_empresa_idx on public.nomina_cargos (empresa_id);
create index if not exists nomina_cargos_venta_idx on public.nomina_cargos (pv_venta_id);
create index if not exists nomina_cargos_created_by_idx on public.nomina_cargos (created_by);

create table if not exists public.nomina_descuentos (
  id uuid primary key default gen_random_uuid(),
  cargo_id uuid not null references public.nomina_cargos (id) on delete cascade,
  grupo_id uuid not null references public.grupos (id),
  profile_id uuid not null references public.profiles (id),
  fecha date not null,
  monto numeric(12,2) not null check (monto > 0),
  referencia text,
  aplicado_por uuid references public.profiles (id) default auth.uid(),
  aplicado_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists nomina_descuentos_cargo_idx on public.nomina_descuentos (cargo_id);
create index if not exists nomina_descuentos_profile_idx on public.nomina_descuentos (profile_id);
create index if not exists nomina_descuentos_grupo_idx on public.nomina_descuentos (grupo_id);
create index if not exists nomina_descuentos_aplicado_por_idx on public.nomina_descuentos (aplicado_por);

-- Configuración de la organización (con valores de ley si no hay renglón).
create or replace function public.fn_nomina_config(p_grupo uuid)
returns public.nomina_financiamiento_config language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c from public.nomina_financiamiento_config c where c.grupo_id = p_grupo),
    row(p_grupo, 315.04, 30, 3, null, now())::public.nomina_financiamiento_config)
$$;

-- Topes de ley con el sueldo semanal: deuda máxima = un mes de sueldo;
-- descuento máximo por semana = % del excedente del mínimo.
create or replace function public.fn_nomina_topes(p_grupo uuid, p_sueldo_semanal numeric)
returns table (deuda_maxima numeric, descuento_maximo numeric) language sql stable security definer set search_path = public as $$
  select round(coalesce(p_sueldo_semanal, 0) * 30 / 7, 2),
         round(greatest(coalesce(p_sueldo_semanal, 0) - c.salario_minimo_diario * 7, 0) * c.pct_excedente / 100, 2)
    from public.fn_nomina_config(p_grupo) c
$$;

-- Triggers: organización, nombres, tope de la línea, liquidación.
create or replace function public.cuentas_nomina_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_deuda numeric;
begin
  select grupo_id into new.grupo_id from public.profiles where id = new.profile_id;
  if new.grupo_id is null then raise exception 'La persona no tiene organización.'; end if;
  if new.linea > 0 then
    if new.sueldo_semanal is null then raise exception 'Captura el sueldo semanal antes de autorizar una línea.'; end if;
    select deuda_maxima into v_deuda from public.fn_nomina_topes(new.grupo_id, new.sueldo_semanal);
    if new.linea > v_deuda + 0.005 then
      raise exception 'La línea (%) pasa del salario de un mes (%): art. 110-I LFT.', new.linea, v_deuda;
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
drop trigger if exists cuentas_nomina_antes on public.cuentas_nomina;
create trigger cuentas_nomina_antes before insert or update on public.cuentas_nomina
  for each row execute function public.cuentas_nomina_antes();

create or replace function public.nomina_config_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.grupo_id is null then new.grupo_id := public.auth_grupo_id(); end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists nomina_config_antes on public.nomina_financiamiento_config;
create trigger nomina_config_antes before insert or update on public.nomina_financiamiento_config
  for each row execute function public.nomina_config_antes();

create or replace function public.nomina_descuentos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.nomina_cargos; v_pagado numeric;
begin
  select * into c from public.nomina_cargos where id = new.cargo_id for update;
  if c.id is null then raise exception 'Cargo no encontrado.'; end if;
  if c.estatus <> 'vigente' then raise exception 'Ese cargo ya no está vigente.'; end if;
  select coalesce(sum(monto), 0) into v_pagado from public.nomina_descuentos where cargo_id = c.id;
  if v_pagado + new.monto > c.monto + 0.005 then
    raise exception 'El descuento pasa del saldo (%).', c.monto - v_pagado;
  end if;
  new.grupo_id := c.grupo_id;
  new.profile_id := c.profile_id;
  select nullif(btrim(nombre), '') into new.aplicado_por_nombre from public.profiles where id = new.aplicado_por;
  return new;
end;
$$;
drop trigger if exists nomina_descuentos_antes on public.nomina_descuentos;
create trigger nomina_descuentos_antes before insert on public.nomina_descuentos
  for each row execute function public.nomina_descuentos_antes();

create or replace function public.nomina_descuentos_despues()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.nomina_cargos c
     set estatus = 'liquidado'
   where c.id = new.cargo_id and c.estatus = 'vigente'
     and (select coalesce(sum(monto), 0) from public.nomina_descuentos d where d.cargo_id = c.id) >= c.monto - 0.005;
  return null;
end;
$$;
drop trigger if exists nomina_descuentos_despues on public.nomina_descuentos;
create trigger nomina_descuentos_despues after insert on public.nomina_descuentos
  for each row execute function public.nomina_descuentos_despues();

-- Venta cancelada en el mostrador → su cargo de nómina se cancela (si aún no
-- se descontó nada; si ya, hay que hacer devolución).
create or replace function public.pv_ventas_cancela_nomina()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'cancelada' and old.estado <> 'cancelada' then
    if exists (select 1 from public.nomina_descuentos d join public.nomina_cargos c on c.id = d.cargo_id where c.pv_venta_id = new.id) then
      raise exception 'Esta venta ya se empezó a descontar vía nómina: registra una devolución en lugar de cancelarla.';
    end if;
    update public.nomina_cargos set estatus = 'cancelado' where pv_venta_id = new.id and estatus = 'vigente';
  end if;
  return new;
end;
$$;
drop trigger if exists pv_ventas_cancela_nomina on public.pv_ventas;
create trigger pv_ventas_cancela_nomina after update of estado on public.pv_ventas
  for each row execute function public.pv_ventas_cancela_nomina();

-- Saldo, lo esperado a hoy y el atraso de cada cargo.
create or replace view public.v_nomina_cargos with (security_invoker = true) as
select c.*, e.nombre as empresa,
       coalesce(d.pagado, 0) as pagado,
       round(c.monto - coalesce(d.pagado, 0), 2) as saldo,
       case when c.estatus <> 'vigente' then 0
            else round(greatest(least(c.monto,
                   c.descuento_por_pago * greatest(0, least(c.pagos, floor(((now() at time zone 'America/Mexico_City')::date - c.primer_descuento) / 7.0)::int + 1)))
                 - coalesce(d.pagado, 0), 0), 2) end as atraso,
       case when c.estatus <> 'vigente' then 0
            else least(c.descuento_por_pago, round(c.monto - coalesce(d.pagado, 0), 2)) end as siguiente_descuento,
       d.ultimo as ultimo_descuento
  from public.nomina_cargos c
  left join public.empresas e on e.id = c.empresa_id
  left join lateral (select sum(x.monto) as pagado, max(x.fecha) as ultimo from public.nomina_descuentos x where x.cargo_id = c.id) d on true;
grant select on public.v_nomina_cargos to authenticated;

-- RLS ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['nomina_financiamiento_config', 'cuentas_nomina', 'nomina_cargos', 'nomina_descuentos'] loop
    execute format('alter table public.%I enable row level security', t);
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
    execute format('drop policy if exists %I on public.%I', t || '_opera', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using ((select public.auth_opera_cuentas_nomina()))
      with check ((select public.auth_opera_cuentas_nomina()))$p$, t || '_opera', t);
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- Cada quien ve su cuenta, sus cargos y sus descuentos.
drop policy if exists cuentas_nomina_propia on public.cuentas_nomina;
create policy cuentas_nomina_propia on public.cuentas_nomina for select to authenticated using (profile_id = (select auth.uid()));
drop policy if exists nomina_cargos_propios on public.nomina_cargos;
create policy nomina_cargos_propios on public.nomina_cargos for select to authenticated using (profile_id = (select auth.uid()));
drop policy if exists nomina_descuentos_propios on public.nomina_descuentos;
create policy nomina_descuentos_propios on public.nomina_descuentos for select to authenticated using (profile_id = (select auth.uid()));
drop policy if exists nomina_config_ver on public.nomina_financiamiento_config;
create policy nomina_config_ver on public.nomina_financiamiento_config for select to authenticated using (true);

-- Disponible de una persona (para el mostrador, RH o ella misma).
create or replace function public.fn_nomina_disponible(p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.cuentas_nomina;
  v_saldo numeric;
  v_atraso numeric;
  t record;
begin
  if not (p_profile = auth.uid() or public.auth_opera_cuentas_nomina() or public.auth_opera_pv()) then
    raise exception 'Sin permiso para ver la cuenta de nómina.';
  end if;
  select * into c from public.cuentas_nomina where profile_id = p_profile;
  if c.profile_id is null or not (c.grupo_id = any (public.auth_grupos_alcance())) then
    return jsonb_build_object('tiene', false);
  end if;
  select coalesce(sum(saldo), 0), coalesce(sum(atraso), 0) into v_saldo, v_atraso
    from public.v_nomina_cargos where profile_id = p_profile and estatus = 'vigente';
  select * into t from public.fn_nomina_topes(c.grupo_id, c.sueldo_semanal);
  return jsonb_build_object(
    'tiene', true, 'nivel', c.nivel, 'estatus', c.estatus, 'linea', c.linea, 'saldo', v_saldo,
    'disponible', case when c.estatus = 'activa' and v_atraso = 0 then greatest(c.linea - v_saldo, 0) else 0 end,
    'atraso', v_atraso, 'plazo_max_semanas', c.plazo_max_semanas,
    'descuento_maximo', t.descuento_maximo, 'deuda_maxima', t.deuda_maxima);
end;
$$;
grant execute on function public.fn_nomina_disponible(uuid) to authenticated;

-- Valida y crea un cargo (lo usan el mostrador y RH).
create or replace function public.fn_nomina_crear_cargo(p_profile uuid, p_origen text, p_concepto text, p_monto numeric,
                                                        p_pagos integer, p_venta uuid default null, p_primer_descuento date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.cuentas_nomina;
  v_disp jsonb;
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
  v_disp := public.fn_nomina_disponible(p_profile);
  if (v_disp ->> 'atraso')::numeric > 0 then raise exception 'Tiene descuentos atrasados: primero hay que ponerse al corriente.'; end if;
  if p_monto > (v_disp ->> 'disponible')::numeric + 0.005 then
    raise exception 'Rebasa su disponible: %.', v_disp ->> 'disponible';
  end if;
  if p_pagos is null or p_pagos < 1 or p_pagos > c.plazo_max_semanas then
    raise exception 'El plazo va de 1 a % pagos semanales.', c.plazo_max_semanas;
  end if;
  v_por_pago := round(ceil(p_monto / p_pagos * 100) / 100, 2);
  if v_por_pago > (v_disp ->> 'descuento_maximo')::numeric + 0.005 then
    raise exception 'Cada descuento sería de % y la ley permite máximo % por semana (30 %% del excedente del mínimo). Usa más pagos.',
      v_por_pago, v_disp ->> 'descuento_maximo';
  end if;
  insert into public.nomina_cargos (grupo_id, profile_id, trabajador_nombre, empresa_id, origen, pv_venta_id, concepto, monto, pagos, descuento_por_pago,
                                    primer_descuento, created_by_nombre)
  values (c.grupo_id, p_profile, (select nombre from public.profiles where id = p_profile),
          (select empresa_id from public.profiles where id = p_profile), p_origen, p_venta,
          btrim(p_concepto), round(p_monto, 2), p_pagos, v_por_pago,
          coalesce(p_primer_descuento, v_hoy + ((5 - extract(isodow from v_hoy)::int + 7) % 7)),  -- el viernes siguiente
          (select nullif(btrim(nombre), '') from public.profiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.fn_nomina_crear_cargo(uuid, text, text, numeric, integer, uuid, date) to authenticated;

-- Aplicar los descuentos de una semana (todos los vigentes con algo por
-- descontar, o los que se indiquen).
create or replace function public.fn_nomina_aplicar_descuentos(p_fecha date, p_cargos uuid[] default null, p_referencia text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not public.auth_opera_cuentas_nomina() then raise exception 'Solo RH, dirección o admin aplican descuentos.'; end if;
  for r in
    select v.id, v.siguiente_descuento from public.v_nomina_cargos v
     where v.estatus = 'vigente' and v.siguiente_descuento > 0 and v.primer_descuento <= p_fecha
       and v.grupo_id = any (public.auth_grupos_alcance())
       and (p_cargos is null or v.id = any (p_cargos))
       and not exists (select 1 from public.nomina_descuentos d where d.cargo_id = v.id and d.fecha = p_fecha)
  loop
    insert into public.nomina_descuentos (cargo_id, grupo_id, profile_id, fecha, monto, referencia)
    values (r.id, (select grupo_id from public.nomina_cargos where id = r.id), (select profile_id from public.nomina_cargos where id = r.id),
            p_fecha, r.siguiente_descuento, nullif(btrim(coalesce(p_referencia, '')), ''));
    n := n + 1;
  end loop;
  return n;
end;
$$;
grant execute on function public.fn_nomina_aplicar_descuentos(date, uuid[], text) to authenticated;

-- Los datos del estudio de cada persona activa de la organización.
create or replace function public.fn_estudio_financiamiento()
returns table (
  profile_id uuid, personal_id uuid, nombre text, puesto text, empresa text, fecha_ingreso date, meses_antiguedad integer,
  sueldo_semanal numeric, sueldo_origen text, checa boolean, constancia_30 integer, cumplimiento_30 integer,
  activos_perdidos integer, herramienta_vencida integer, cargos_liquidados integer, cargos_liquidados_tarde integer,
  saldo numeric, atraso numeric, linea numeric, plazo_max_semanas integer, nivel text, estatus text, autorizada_en timestamptz,
  deuda_maxima numeric, descuento_maximo numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_grupo uuid;
begin
  if not public.auth_opera_cuentas_nomina() then raise exception 'El estudio lo ven RH, dirección y admin.'; end if;
  v_grupo := public.auth_grupo_id();
  return query
  with hoy as (select (now() at time zone 'America/Mexico_City')::date as d),
  st as (select * from public.fn_personajes_stats(v_grupo)),
  base as (
    select pe.id as personal_id, pe.profile_id, pe.nombre, pe.puesto, pe.fecha_ingreso,
           (select e.nombre from public.empresas e join public.profiles pr on pr.empresa_id = e.id where pr.id = pe.profile_id) as empresa,
           cn.sueldo_semanal as sueldo_cuenta,
           (select ct.sueldo_semanal from public.contrataciones ct where ct.personal_id = pe.id and ct.estatus = 'vigente'
             order by ct.fecha_inicio desc nulls last limit 1) as sueldo_contrato,
           cn.linea, cn.plazo_max_semanas, cn.nivel, cn.estatus, cn.autorizada_en
      from public.personal pe
      left join public.cuentas_nomina cn on cn.profile_id = pe.profile_id
     where pe.grupo_id = v_grupo and pe.activo and pe.profile_id is not null
  )
  select b.profile_id, b.personal_id, b.nombre, b.puesto, b.empresa, b.fecha_ingreso,
         case when b.fecha_ingreso is null then 0
              else (extract(year from age((select d from hoy), b.fecha_ingreso)) * 12 + extract(month from age((select d from hoy), b.fecha_ingreso)))::int end,
         coalesce(b.sueldo_cuenta, b.sueldo_contrato),
         case when b.sueldo_cuenta is not null then 'captura' when b.sueldo_contrato is not null then 'contrato' else null end,
         coalesce(s.checa, false), s.constancia_30, s.cumplimiento_30,
         ((select count(*) from public.herramientas h where h.responsable_id = b.profile_id and h.estado = 'extraviada')
          + (select count(*) from public.epp_asignacion_lineas l join public.epp_asignaciones a on a.id = l.asignacion_id
              where a.personal_id = b.personal_id and l.estado = 'perdido' and l.updated_at > now() - interval '12 months'))::int,
         (select count(*) from public.herramientas h where h.responsable_id = b.profile_id and h.estado = 'asignada' and h.devolver_el < (select d from hoy))::int,
         (select count(*) from public.nomina_cargos c where c.profile_id = b.profile_id and c.estatus = 'liquidado')::int,
         (select count(*) from public.nomina_cargos c
           where c.profile_id = b.profile_id and c.estatus = 'liquidado'
             and (select max(d.fecha) from public.nomina_descuentos d where d.cargo_id = c.id) > c.primer_descuento + (c.pagos - 1) * 7 + 7)::int,
         coalesce((select sum(v.saldo) from public.v_nomina_cargos v where v.profile_id = b.profile_id and v.estatus = 'vigente'), 0),
         coalesce((select sum(v.atraso) from public.v_nomina_cargos v where v.profile_id = b.profile_id and v.estatus = 'vigente'), 0),
         coalesce(b.linea, 0), b.plazo_max_semanas, coalesce(b.nivel, 'sin_acceso'), b.estatus, b.autorizada_en,
         t.deuda_maxima, t.descuento_maximo
    from base b
    left join st s on s.profile_id = b.profile_id
    left join lateral public.fn_nomina_topes(v_grupo, coalesce(b.sueldo_cuenta, b.sueldo_contrato)) t on true
   order by b.nombre;
end;
$$;
grant execute on function public.fn_estudio_financiamiento() to authenticated;

-- Punto de venta: forma de pago 'nomina' ------------------------------------------
do $$ begin
  alter table public.pv_pagos drop constraint if exists pv_pagos_metodo_check;
  alter table public.pv_pagos add constraint pv_pagos_metodo_check check (metodo in ('efectivo', 'tarjeta', 'transferencia', 'credito', 'nomina'));
exception when undefined_table then null;
end $$;

create or replace function public.fn_pv_cobrar(
  p_empresa uuid, p_turno uuid, p_cliente uuid, p_cliente_nombre text,
  p_lineas jsonb, p_pagos jsonb, p_requiere_factura boolean default false, p_notas text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_turno public.pv_turnos;
  v_almacen uuid;
  v_venta uuid;
  v_folio text;
  v_total numeric := 0;
  v_no_efectivo numeric := 0;
  v_efectivo numeric := 0;
  v_credito numeric := 0;
  v_nomina numeric := 0;
  v_empleado uuid;
  v_pagos_nomina integer;
  v_cambio numeric := 0;
  v_saldo numeric;
  v_cc public.clientes_credito;
  r jsonb;
  v_p public.productos;
  v_cant numeric;
  v_precio numeric;
  v_desc numeric;
  v_costo numeric;
  v_mov uuid;
  v_orden int := 0;
begin
  perform public.fn_pv_guarda(p_empresa);
  select * into v_turno from public.pv_turnos where id = p_turno;
  if v_turno.id is null or v_turno.cerrado_en is not null or v_turno.empresa_id <> p_empresa then
    raise exception 'Abre la caja de esta empresa antes de cobrar.';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'La venta no tiene productos.'; end if;
  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then raise exception 'Falta la forma de pago.'; end if;
  if p_cliente is not null and not exists (select 1 from public.clientes where id = p_cliente and empresa_id = p_empresa) then
    raise exception 'El cliente no es de esta empresa.';
  end if;
  select id into v_almacen from public.almacenes where empresa_id = p_empresa and activo order by created_at limit 1;
  if v_almacen is null then raise exception 'La empresa no tiene almacén.'; end if;

  -- Existencias reales: no se vende lo que no hay en el almacén del punto de venta.
  declare
    s record;
  begin
    for s in
      select p.nombre, p.unidad_medida, l.cant,
             coalesce((select sum(x.existencia) from public.existencias x where x.producto_id = p.id and x.almacen_id = v_almacen), 0) as hay
        from (select (e ->> 'producto_id')::uuid pid, sum((e ->> 'cantidad')::numeric) cant
                from jsonb_array_elements(p_lineas) e group by 1) l
        join public.productos p on p.id = l.pid and p.empresa_id = p_empresa
    loop
      if s.cant > s.hay then
        raise exception 'Sin existencia suficiente de %: hay % %, se piden %.', s.nombre, s.hay, coalesce(s.unidad_medida, ''), s.cant;
      end if;
    end loop;
  end;

  -- Total de los productos.
  for r in select * from jsonb_array_elements(p_lineas) loop
    select * into v_p from public.productos where id = (r ->> 'producto_id')::uuid and empresa_id = p_empresa and activo;
    if v_p.id is null then raise exception 'Producto no encontrado en esta empresa.'; end if;
    v_cant := (r ->> 'cantidad')::numeric;
    v_precio := coalesce((r ->> 'precio')::numeric, v_p.precio_venta);
    v_desc := coalesce((r ->> 'descuento_pct')::numeric, 0);
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en %.', v_p.nombre; end if;
    if v_precio is null then raise exception '% no tiene precio de venta.', v_p.nombre; end if;
    v_total := v_total + round(v_cant * v_precio * (1 - v_desc / 100), 2);
  end loop;

  -- Pagos.
  for r in select * from jsonb_array_elements(p_pagos) loop
    if (r ->> 'monto')::numeric is null or (r ->> 'monto')::numeric <= 0 then continue; end if;
    case r ->> 'metodo'
      when 'efectivo' then v_efectivo := v_efectivo + (r ->> 'monto')::numeric;
      when 'credito' then v_credito := v_credito + (r ->> 'monto')::numeric;
      when 'tarjeta', 'transferencia' then v_no_efectivo := v_no_efectivo + (r ->> 'monto')::numeric;
      when 'nomina' then
        if v_nomina > 0 then raise exception 'Solo un cargo a nómina por venta.'; end if;
        v_nomina := (r ->> 'monto')::numeric;
        v_empleado := nullif(r ->> 'empleado', '')::uuid;
        v_pagos_nomina := coalesce((r ->> 'pagos')::int, 1);
        if v_empleado is null then raise exception 'Para cargar a nómina lee la credencial del trabajador.'; end if;
      else raise exception 'Forma de pago desconocida: %', r ->> 'metodo';
    end case;
  end loop;
  if v_no_efectivo + v_credito + v_nomina > v_total + 0.005 then
    raise exception 'Tarjeta, transferencia, crédito y nómina no pueden pasar del total (%).', v_total;
  end if;
  if v_efectivo + v_no_efectivo + v_credito + v_nomina < v_total - 0.005 then
    raise exception 'Falta por pagar %.', round(v_total - (v_efectivo + v_no_efectivo + v_credito + v_nomina), 2);
  end if;
  v_cambio := round(greatest(v_efectivo + v_no_efectivo + v_credito + v_nomina - v_total, 0), 2);

  if v_credito > 0 then
    if p_cliente is null then raise exception 'La venta a crédito necesita cliente.'; end if;
    select * into v_cc from public.clientes_credito where cliente_id = p_cliente;
    if v_cc.cliente_id is null or not v_cc.autorizado then raise exception 'El cliente no tiene crédito autorizado.'; end if;
    select coalesce(saldo, 0) into v_saldo from public.v_pv_saldos_clientes where cliente_id = p_cliente;
    if coalesce(v_saldo, 0) + v_credito > coalesce(v_cc.linea_credito, 0) + 0.005 then
      raise exception 'Rebasa la línea de crédito: saldo %, línea %.', coalesce(v_saldo, 0), v_cc.linea_credito;
    end if;
  end if;

  v_folio := public.fn_siguiente_folio(p_empresa, 'PV');
  insert into public.pv_ventas (empresa_id, folio, turno_id, cliente_id, cliente_nombre, vendedor_id, vendedor_nombre,
                                estado, requiere_factura, notas)
  values (p_empresa, v_folio, p_turno, p_cliente,
          coalesce(nullif(trim(coalesce(p_cliente_nombre, '')), ''), (select razon_social from public.clientes where id = p_cliente),
                   case when v_empleado is not null then 'Empleado: ' || (select nombre from public.profiles where id = v_empleado) end,
                   'Público en general'),
          auth.uid(), public.fn_pv_nombre_usuario(),
          case when v_credito > 0 then 'credito' else 'pagada' end, coalesce(p_requiere_factura, false),
          nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_venta;

  -- Cargo a la cuenta de nómina (valida línea, plazo y tope de ley).
  if v_nomina > 0 then
    perform public.fn_nomina_crear_cargo(v_empleado, 'punto_venta', 'Compra ' || v_folio, v_nomina, v_pagos_nomina, v_venta);
  end if;

  for r in select * from jsonb_array_elements(p_lineas) loop
    select * into v_p from public.productos where id = (r ->> 'producto_id')::uuid;
    v_cant := (r ->> 'cantidad')::numeric;
    v_precio := coalesce((r ->> 'precio')::numeric, v_p.precio_venta);
    v_desc := coalesce((r ->> 'descuento_pct')::numeric, 0);
    select coalesce(x.costo_promedio, v_p.costo_referencia) into v_costo
      from public.existencias x where x.producto_id = v_p.id and x.almacen_id = v_almacen;
    insert into public.movimientos_inventario (empresa_id, almacen_id, producto_id, tipo, cantidad, costo_unitario, fecha,
                                               comentario, registrado_por, codigo_escaneado)
    values (p_empresa, v_almacen, v_p.id, 'salida', v_cant, v_costo, (now() at time zone 'America/Mexico_City')::date,
            'Venta ' || v_folio, auth.uid(), nullif(r ->> 'codigo', ''))
    returning id into v_mov;
    v_orden := v_orden + 1;
    insert into public.pv_venta_lineas (venta_id, empresa_id, producto_id, sku, descripcion, unidad, cantidad, precio_unitario,
                                        descuento_pct, iva_tasa, costo_unitario, movimiento_id, orden)
    values (v_venta, p_empresa, v_p.id, v_p.sku, v_p.nombre, v_p.unidad_medida, v_cant, v_precio, v_desc, v_p.iva_tasa,
            v_costo, v_mov, v_orden);
  end loop;

  for r in select * from jsonb_array_elements(p_pagos) loop
    if (r ->> 'monto')::numeric is null or (r ->> 'monto')::numeric <= 0 then continue; end if;
    insert into public.pv_pagos (empresa_id, venta_id, turno_id, cliente_id, metodo, monto, recibido, cambio, referencia)
    values (p_empresa, v_venta, p_turno, p_cliente, r ->> 'metodo',
            case when r ->> 'metodo' = 'efectivo' then (r ->> 'monto')::numeric - v_cambio else (r ->> 'monto')::numeric end,
            case when r ->> 'metodo' = 'efectivo' then (r ->> 'monto')::numeric end,
            case when r ->> 'metodo' = 'efectivo' then v_cambio else 0 end,
            case when r ->> 'metodo' = 'nomina' then 'Nómina · ' || v_pagos_nomina || ' pago(s)'
                 else nullif(trim(coalesce(r ->> 'referencia', '')), '') end);
  end loop;

  return jsonb_build_object('id', v_venta, 'folio', v_folio, 'total', v_total, 'cambio', v_cambio);
end;
$$;
