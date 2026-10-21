-- Deuda financiera, segunda vuelta (21-oct-2026, diseño que mandó Mario:
-- "Deuda financiera del grupo" con Resumen / Calendario de pagos / Registrar
-- crédito, "los pagos se envían a Programación de pagos", saldo por empresa
-- con aviso de avales de otra empresa del grupo, y en la tabla de
-- amortización "Registrar pago N" y "Deshacer último pago").
--
-- 1) deuda_creditos: `destino` (para qué es el crédito) y `aval_empresa_id`
--    (otra empresa del grupo que avala: el riesgo se suma).
-- 2) deuda_pagos.numero = número de pago de la tabla (único por crédito) y
--    `pago_programado_id` (el pago de Programación que lo originó).
-- 3) pagos_programados (tipo 'prestamo', el que ya existía; sin empresa
--    destino, así que la hoja del día lo pone como cargo) + `deuda_credito_id`,
--    `deuda_numero` y `deuda_detalle` (capital, interés, IVA). fn_deuda_enviar_pagos(credito,
--    pagos) da de alta (o corrige, si siguen pendientes) los pagos de la tabla
--    en Programación de pagos: salen en la hoja del día y en Tesorería con el
--    acreedor como beneficiario.
-- 4) Ida y vuelta: si Tesorería marca pagado un pago de deuda, se registra el
--    pago en el crédito; si se registra en el crédito y su pago programado
--    seguía pendiente, queda pagado allá. Deshacer el pago en el crédito lo
--    regresa a pendiente si aún no tiene comprobante (con comprobante no se
--    deshace: se corrige en Tesorería). Un pago de deuda ya registrado no se
--    regresa a pendiente desde Tesorería: se deshace en Deuda financiera.
-- Ya aplicado en producción (deuda_programacion_pagos).

alter table public.deuda_creditos
  add column if not exists destino text,
  add column if not exists aval_empresa_id uuid references public.empresas (id) on delete set null;
create index if not exists deuda_creditos_aval_idx on public.deuda_creditos (aval_empresa_id);

alter table public.deuda_pagos
  add column if not exists numero integer check (numero is null or numero > 0),
  add column if not exists pago_programado_id uuid references public.pagos_programados (id) on delete set null;
create unique index if not exists deuda_pagos_numero_unico on public.deuda_pagos (credito_id, numero) where numero is not null;
create index if not exists deuda_pagos_programado_idx on public.deuda_pagos (pago_programado_id);

alter table public.pagos_programados
  add column if not exists deuda_credito_id uuid references public.deuda_creditos (id) on delete set null,
  add column if not exists deuda_numero integer,
  add column if not exists deuda_detalle jsonb;
create unique index if not exists pagos_programados_deuda_unico on public.pagos_programados (deuda_credito_id, deuda_numero)
  where deuda_credito_id is not null and estatus <> 'cancelado';

-- La vista con las columnas nuevas al final (mismo orden de antes).
create or replace view public.v_deuda_creditos with (security_invoker = true) as
select c.id, c.empresa_id, c.folio, c.acreedor, c.tipo, c.contrato, c.moneda, c.monto, c.fecha_disposicion,
       c.fecha_vencimiento, c.tasa_anual, c.tasa_tipo, c.tasa_referencia, c.iva_intereses, c.comision_apertura,
       c.plazo_meses, c.periodicidad, c.amortizacion, c.primer_pago, c.cuenta_id, c.garantia, c.aval,
       c.saldo_corte, c.saldo_corte_al, c.estatus, c.notas, c.created_by, c.created_at, c.updated_at,
       e.codigo as empresa_codigo,
       coalesce(p.capital, 0) as capital_pagado,
       coalesce(p.intereses, 0) as intereses_pagados,
       coalesce(p.pagos, 0) as num_pagos,
       p.ultimo_pago,
       coalesce(pc.capital, 0) as capital_desde_corte,
       case when c.estatus in ('liquidado', 'cancelado') then 0
            when c.saldo_corte is not null then greatest(c.saldo_corte - coalesce(pc.capital, 0), 0)
            else greatest(c.monto - coalesce(p.capital, 0), 0) end as saldo,
       c.destino,
       c.aval_empresa_id,
       ea.codigo as aval_empresa_codigo,
       e.nombre as empresa_nombre,
       coalesce(p.numeros, '{}') as numeros_pagados,
       coalesce(pp.numeros, '{}') as numeros_programados,
       cb.banco as cuenta_banco,
       cb.ultimos_4 as cuenta_ultimos_4
  from public.deuda_creditos c
  join public.empresas e on e.id = c.empresa_id
  left join public.empresas ea on ea.id = c.aval_empresa_id
  left join public.cuentas_bancarias cb on cb.id = c.cuenta_id
  left join lateral (
    select sum(x.capital) as capital, sum(x.interes + x.iva_interes) as intereses, count(*) as pagos, max(x.fecha) as ultimo_pago,
           array_agg(x.numero order by x.numero) filter (where x.numero is not null) as numeros
      from public.deuda_pagos x where x.credito_id = c.id
  ) p on true
  left join lateral (
    select sum(x.capital) as capital
      from public.deuda_pagos x where x.credito_id = c.id and c.saldo_corte_al is not null and x.fecha > c.saldo_corte_al
  ) pc on true
  left join lateral (
    select array_agg(g.deuda_numero order by g.deuda_numero) as numeros
      from public.pagos_programados g
     where g.deuda_credito_id = c.id and g.estatus = 'pendiente'
  ) pp on true;
revoke all on public.v_deuda_creditos from anon;
grant select on public.v_deuda_creditos to authenticated;

-- Manda (o corrige) pagos de la tabla a Programación de pagos.
-- p_pagos = [{numero, fecha, capital, interes, iva, total}]
create or replace function public.fn_deuda_enviar_pagos(p_credito uuid, p_pagos jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_c public.deuda_creditos;
  v_total integer;
  r record;
  v_n integer := 0;
  v_id uuid;
begin
  if not public.auth_opera_deuda() then
    raise exception 'Sin permiso para programar pagos de deuda.' using errcode = '42501';
  end if;
  select * into v_c from public.deuda_creditos where id = p_credito;
  if v_c.id is null or not (v_c.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'No encuentro el crédito o no es de una empresa que manejes.' using errcode = '42501';
  end if;
  if v_c.estatus <> 'vigente' then
    return 0;
  end if;
  v_total := jsonb_array_length(coalesce(p_pagos, '[]'::jsonb));
  for r in
    select (e ->> 'numero')::int as numero, (e ->> 'fecha')::date as fecha,
           coalesce((e ->> 'capital')::numeric, 0) as capital, coalesce((e ->> 'interes')::numeric, 0) as interes,
           coalesce((e ->> 'iva')::numeric, 0) as iva, (e ->> 'total')::numeric as total, (e ->> 'de')::int as de
      from jsonb_array_elements(coalesce(p_pagos, '[]'::jsonb)) e
  loop
    if r.numero is null or r.fecha is null or coalesce(r.total, 0) <= 0 then continue; end if;
    -- Ya pagado en el crédito: no se programa.
    if exists (select 1 from public.deuda_pagos d where d.credito_id = v_c.id and d.numero = r.numero) then continue; end if;
    select g.id into v_id from public.pagos_programados g
     where g.deuda_credito_id = v_c.id and g.deuda_numero = r.numero and g.estatus <> 'cancelado';
    if v_id is null then
      insert into public.pagos_programados (empresa_id, cuenta_id, beneficiario, concepto, monto, fecha_programada, estatus, metodo, tipo,
                                            notas, deuda_credito_id, deuda_numero, deuda_detalle, created_by)
      values (v_c.empresa_id, v_c.cuenta_id, v_c.acreedor,
              format('Pago %s%s %s · %s', r.numero, case when r.de is not null then '/' || r.de else '' end, v_c.folio, coalesce(nullif(v_c.contrato, ''), v_c.tipo)),
              round(r.total, 2), r.fecha, 'pendiente', 'transferencia', 'prestamo',
              format('capital %s · interés %s · IVA %s', to_char(r.capital, 'FM999,999,990.00'), to_char(r.interes, 'FM999,999,990.00'), to_char(r.iva, 'FM999,999,990.00')),
              v_c.id, r.numero, jsonb_build_object('capital', r.capital, 'interes', r.interes, 'iva', r.iva), auth.uid());
      v_n := v_n + 1;
    else
      update public.pagos_programados g
         set monto = round(r.total, 2), fecha_programada = r.fecha, cuenta_id = v_c.cuenta_id, beneficiario = v_c.acreedor,
             deuda_detalle = jsonb_build_object('capital', r.capital, 'interes', r.interes, 'iva', r.iva),
             notas = format('capital %s · interés %s · IVA %s', to_char(r.capital, 'FM999,999,990.00'), to_char(r.interes, 'FM999,999,990.00'), to_char(r.iva, 'FM999,999,990.00'))
       where g.id = v_id and g.estatus = 'pendiente'
         and (g.monto, g.fecha_programada, g.cuenta_id, g.beneficiario) is distinct from (round(r.total, 2), r.fecha, v_c.cuenta_id, v_c.acreedor);
      if found then v_n := v_n + 1; end if;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.fn_deuda_enviar_pagos(uuid, jsonb) from public, anon;
grant execute on function public.fn_deuda_enviar_pagos(uuid, jsonb) to authenticated;

-- Tesorería marca pagado un pago de deuda → se registra en el crédito. Si ya
-- estaba registrado y lo quieren regresar a pendiente o cancelar, se deshace
-- primero en Deuda financiera (que lo regresa solo).
create or replace function public.pagos_programados_deuda_sigue()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_det jsonb;
begin
  if new.deuda_credito_id is null or new.estatus is not distinct from old.estatus then return new; end if;
  if new.estatus = 'pagado' then
    if not exists (select 1 from public.deuda_pagos d where d.credito_id = new.deuda_credito_id and d.numero = new.deuda_numero) then
      v_det := coalesce(new.deuda_detalle, '{}'::jsonb);
      insert into public.deuda_pagos (credito_id, fecha, capital, interes, iva_interes, comisiones, referencia, numero, pago_programado_id, notas)
      values (new.deuda_credito_id, coalesce(new.pagado_en, current_date),
              coalesce((v_det ->> 'capital')::numeric, 0), coalesce((v_det ->> 'interes')::numeric, 0), coalesce((v_det ->> 'iva')::numeric, 0),
              greatest(new.monto - coalesce((v_det ->> 'capital')::numeric, 0) - coalesce((v_det ->> 'interes')::numeric, 0) - coalesce((v_det ->> 'iva')::numeric, 0), 0),
              new.referencia, new.deuda_numero, new.id, 'Pagado desde Programación de pagos');
    end if;
  elsif old.estatus = 'pagado'
        and exists (select 1 from public.deuda_pagos d where d.pago_programado_id = new.id) then
    raise exception 'Ese pago ya está registrado en Deuda financiera: deshazlo allá ("Deshacer último pago").';
  end if;
  return new;
end;
$$;
drop trigger if exists pagos_programados_deuda_sigue on public.pagos_programados;
create trigger pagos_programados_deuda_sigue after update of estatus on public.pagos_programados
  for each row execute function public.pagos_programados_deuda_sigue();

-- Pago registrado en el crédito → su pago programado pendiente queda pagado.
create or replace function public.deuda_pagos_marca_programado()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if new.numero is null or new.pago_programado_id is not null then return new; end if;
  select g.id into v_id from public.pagos_programados g
   where g.deuda_credito_id = new.credito_id and g.deuda_numero = new.numero and g.estatus = 'pendiente';
  if v_id is not null then
    update public.deuda_pagos set pago_programado_id = v_id where id = new.id;
    update public.pagos_programados
       set estatus = 'pagado', pagado_en = new.fecha, referencia = coalesce(new.referencia, referencia),
           monto = new.total
     where id = v_id;
  end if;
  return new;
end;
$$;
drop trigger if exists deuda_pagos_marca_programado on public.deuda_pagos;
create trigger deuda_pagos_marca_programado after insert on public.deuda_pagos
  for each row execute function public.deuda_pagos_marca_programado();

-- Deshacer el pago en el crédito → su pago programado vuelve a pendiente (si
-- todavía no tiene comprobante; con comprobante se corrige en Tesorería).
-- Después de borrar: así el trigger de pagos_programados ya no encuentra el
-- pago en el crédito y deja regresarlo a pendiente.
create or replace function public.deuda_pagos_deshace_programado()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_g public.pagos_programados;
begin
  if old.pago_programado_id is null then return old; end if;
  select * into v_g from public.pagos_programados where id = old.pago_programado_id;
  if v_g.id is null or v_g.estatus <> 'pagado' then return old; end if;
  if v_g.comprobante_path is not null then
    raise exception 'Ese pago ya tiene comprobante en Tesorería; corrígelo allá.';
  end if;
  update public.pagos_programados set estatus = 'pendiente', pagado_en = null where id = v_g.id;
  return old;
end;
$$;
drop trigger if exists deuda_pagos_deshace_programado on public.deuda_pagos;
create trigger deuda_pagos_deshace_programado after delete on public.deuda_pagos
  for each row execute function public.deuda_pagos_deshace_programado();

-- Crédito liquidado o cancelado: sus pagos aún pendientes en Programación se cancelan.
create or replace function public.deuda_creditos_cancela_programados()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estatus <> 'vigente' and old.estatus = 'vigente' then
    update public.pagos_programados set estatus = 'cancelado'
     where deuda_credito_id = new.id and estatus = 'pendiente';
  end if;
  return new;
end;
$$;
drop trigger if exists deuda_creditos_cancela_programados on public.deuda_creditos;
create trigger deuda_creditos_cancela_programados after update of estatus on public.deuda_creditos
  for each row execute function public.deuda_creditos_cancela_programados();
