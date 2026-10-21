-- Deuda financiera (21-oct-2026, Mario: "crear un módulo de deuda financiera
-- para subir los préstamos"). Créditos que las empresas del grupo deben a
-- bancos, arrendadoras o particulares (lo de "Préstamos entre empresas" sigue
-- aparte: sale de los movimientos bancarios intercompañía).
--
-- - `deuda_creditos`: un crédito por renglón y empresa (folio DF-<emp>-0001):
--   acreedor, tipo, contrato, moneda, monto dispuesto, fecha de disposición y
--   vencimiento, tasa anual (fija o variable con su referencia), IVA de
--   intereses, plazo, periodicidad, forma de amortización, primer pago, cuenta
--   de cargo, garantía, aval y estatus. Para los préstamos que se suben ya
--   avanzados: `saldo_corte` + `saldo_corte_al` (saldo según el estado de cuenta
--   del acreedor a esa fecha).
-- - `deuda_pagos`: cada pago con capital, interés, IVA del interés y
--   comisiones (total calculado); opcional la liga al movimiento bancario.
-- - `v_deuda_creditos`: el saldo SE CALCULA (nunca se captura): con corte =
--   saldo_corte − capital pagado después del corte; sin corte = monto − capital
--   pagado. Más capital/intereses pagados y último pago.
-- Ven: admin, dirección y permisos por persona tesorería o contabilidad;
-- capturan: admin, dirección y tesorería (`auth_opera_deuda`). Frontera por
-- empresa, espectador, director general y solo consulta.
-- Ya aplicado en producción (deuda_financiera).

create table if not exists public.deuda_creditos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  folio text not null default '',
  acreedor text not null check (btrim(acreedor) <> ''),
  tipo text not null default 'simple'
    check (tipo in ('simple', 'revolvente', 'arrendamiento', 'hipotecario', 'tarjeta', 'factoraje', 'particular', 'otro')),
  contrato text,
  moneda text not null default 'MXN' check (moneda in ('MXN', 'USD')),
  monto numeric(16, 2) not null check (monto > 0),
  fecha_disposicion date not null,
  fecha_vencimiento date,
  tasa_anual numeric(8, 4) check (tasa_anual is null or (tasa_anual >= 0 and tasa_anual < 200)),
  tasa_tipo text not null default 'fija' check (tasa_tipo in ('fija', 'variable')),
  tasa_referencia text,
  iva_intereses boolean not null default true,
  comision_apertura numeric(16, 2) check (comision_apertura is null or comision_apertura >= 0),
  plazo_meses integer check (plazo_meses is null or plazo_meses between 1 and 600),
  periodicidad text not null default 'mensual'
    check (periodicidad in ('semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', 'al_vencimiento')),
  amortizacion text not null default 'pagos_iguales'
    check (amortizacion in ('pagos_iguales', 'capital_igual', 'al_vencimiento', 'personalizado')),
  primer_pago date,
  cuenta_id uuid references public.cuentas_bancarias (id) on delete set null,
  garantia text,
  aval text,
  saldo_corte numeric(16, 2) check (saldo_corte is null or saldo_corte >= 0),
  saldo_corte_al date,
  estatus text not null default 'vigente' check (estatus in ('vigente', 'liquidado', 'reestructurado', 'cancelado')),
  notas text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio),
  check (saldo_corte is null or saldo_corte_al is not null),
  check (fecha_vencimiento is null or fecha_vencimiento >= fecha_disposicion)
);
create index if not exists deuda_creditos_empresa_idx on public.deuda_creditos (empresa_id);
create index if not exists deuda_creditos_cuenta_idx on public.deuda_creditos (cuenta_id);
create index if not exists deuda_creditos_created_by_idx on public.deuda_creditos (created_by);

create table if not exists public.deuda_pagos (
  id uuid primary key default gen_random_uuid(),
  credito_id uuid not null references public.deuda_creditos (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),
  fecha date not null,
  capital numeric(16, 2) not null default 0 check (capital >= 0),
  interes numeric(16, 2) not null default 0 check (interes >= 0),
  iva_interes numeric(16, 2) not null default 0 check (iva_interes >= 0),
  comisiones numeric(16, 2) not null default 0 check (comisiones >= 0),
  total numeric(16, 2) generated always as (capital + interes + iva_interes + comisiones) stored,
  referencia text,
  notas text,
  movimiento_id uuid references public.movimientos (id) on delete set null,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (capital + interes + iva_interes + comisiones > 0)
);
create index if not exists deuda_pagos_credito_idx on public.deuda_pagos (credito_id, fecha);
create index if not exists deuda_pagos_empresa_idx on public.deuda_pagos (empresa_id);
create index if not exists deuda_pagos_movimiento_idx on public.deuda_pagos (movimiento_id);
create index if not exists deuda_pagos_created_by_idx on public.deuda_pagos (created_by);

-- Quién opera y quién ve.
create or replace function public.auth_opera_deuda()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo and not p.espectador
      and (p.rol in ('admin', 'direccion')
           or exists (select 1 from public.permisos_modulo pm where pm.profile_id = p.id and pm.modulo = 'tesoreria'))
  )
$$;

create or replace function public.auth_ve_deuda()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_opera_deuda()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.activo and not p.espectador
          and exists (select 1 from public.permisos_modulo pm where pm.profile_id = p.id and pm.modulo = 'contabilidad'))
$$;
revoke all on function public.auth_opera_deuda() from public, anon;
revoke all on function public.auth_ve_deuda() from public, anon;
grant execute on function public.auth_opera_deuda() to authenticated;
grant execute on function public.auth_ve_deuda() to authenticated;

-- Folio por empresa, limpieza y fecha de actualización.
create or replace function public.deuda_creditos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_codigo text;
begin
  new.acreedor := btrim(regexp_replace(new.acreedor, '\s+', ' ', 'g'));
  new.contrato := nullif(btrim(coalesce(new.contrato, '')), '');
  if new.folio is null or btrim(new.folio) = '' then
    select coalesce(nullif(e.codigo, ''), 'EMP') into v_codigo from public.empresas e where e.id = new.empresa_id;
    select 'DF-' || v_codigo || '-' || lpad((coalesce(max(substring(c.folio from '-(\d+)$')::int), 0) + 1)::text, 4, '0')
      into new.folio
      from public.deuda_creditos c
     where c.empresa_id = new.empresa_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists deuda_creditos_antes on public.deuda_creditos;
create trigger deuda_creditos_antes before insert or update on public.deuda_creditos
  for each row execute function public.deuda_creditos_antes();

-- El pago hereda la empresa de su crédito (para la frontera y el alcance).
create or replace function public.deuda_pagos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select c.empresa_id into new.empresa_id from public.deuda_creditos c where c.id = new.credito_id;
  if new.empresa_id is null then raise exception 'No encuentro el crédito del pago.'; end if;
  return new;
end;
$$;
drop trigger if exists deuda_pagos_antes on public.deuda_pagos;
create trigger deuda_pagos_antes before insert or update on public.deuda_pagos
  for each row execute function public.deuda_pagos_antes();

-- RLS.
alter table public.deuda_creditos enable row level security;
alter table public.deuda_pagos enable row level security;

do $x$
declare t text;
begin
  foreach t in array array['deuda_creditos', 'deuda_pagos'] loop
    execute format('drop policy if exists frontera_organizacion on public.%I', t);
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
      with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))$p$, t);
    execute format('drop policy if exists espectador_sin_datos on public.%I', t);
    execute format('create policy espectador_sin_datos on public.%I as restrictive for select using (not (select public.auth_es_espectador()))', t);
    execute format('drop policy if exists director_general on public.%I', t);
    execute format('create policy director_general on public.%I for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()))', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select
      using ((select public.auth_ve_deuda()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($p$create policy %I on public.%I for insert
      with check ((select public.auth_opera_deuda()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($p$create policy %I on public.%I for update
      using ((select public.auth_opera_deuda()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
      with check ((select public.auth_opera_deuda()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($p$create policy %I on public.%I for delete
      using ((select public.auth_opera_deuda()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_delete', t);
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $x$;

-- Saldos calculados.
create or replace view public.v_deuda_creditos with (security_invoker = true) as
select c.*,
       e.codigo as empresa_codigo,
       coalesce(p.capital, 0) as capital_pagado,
       coalesce(p.intereses, 0) as intereses_pagados,
       coalesce(p.pagos, 0) as num_pagos,
       p.ultimo_pago,
       coalesce(pc.capital, 0) as capital_desde_corte,
       case when c.estatus in ('liquidado', 'cancelado') then 0
            when c.saldo_corte is not null then greatest(c.saldo_corte - coalesce(pc.capital, 0), 0)
            else greatest(c.monto - coalesce(p.capital, 0), 0) end as saldo
  from public.deuda_creditos c
  join public.empresas e on e.id = c.empresa_id
  left join lateral (
    select sum(x.capital) as capital, sum(x.interes + x.iva_interes) as intereses, count(*) as pagos, max(x.fecha) as ultimo_pago
      from public.deuda_pagos x where x.credito_id = c.id
  ) p on true
  left join lateral (
    select sum(x.capital) as capital
      from public.deuda_pagos x where x.credito_id = c.id and c.saldo_corte_al is not null and x.fecha > c.saldo_corte_al
  ) pc on true;
revoke all on public.v_deuda_creditos from anon;
grant select on public.v_deuda_creditos to authenticated;
