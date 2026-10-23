-- Cuentas por cobrar (23-oct-2026, Laura con el diseño "Comercial / Cobranza /
-- Cuentas por cobrar": Cartera, Registrar cobro, Agenda de cobranza, Entre
-- empresas). Lo que nos deben los clientes sale de lo que ya hay:
--   * Facturas del SAT (cfdi emitidos, tipo I). Las PPD quedan por cobrar hasta
--     que sus complementos de pago (cfdi P, relacionados con ImpPagado) o notas
--     de crédito (cfdi E relacionadas) las cubren; las PUE se pagaron al
--     facturar, salvo clientes marcados `pue_a_credito`. La nómina (N) no cuenta.
--   * Estimaciones y documentos sin CFDI (cxc_documentos), con su retenido
--     (fondo de garantía): saldo exigible = total − cobrado − retenido.
--   * Cobrado = el mayor entre lo que dice el SAT y lo registrado aquí más los
--     depósitos conciliados con la factura en Movimientos (FACTURA "F-/FM-").
-- Nada se captura como saldo: todo se calcula en fn_cxc_cartera().
--
-- Ven: admin, dirección, corporativo y rol empresa (`auth_ve_cxc`); operan
-- admin, dirección y corporativo (`auth_opera_cxc`). Los cobros no se borran:
-- se cancelan (cancelado_en). Frontera, espectador, director general y solo
-- consulta en las cinco tablas.
--
-- Ya aplicado en producción (cuentas_por_cobrar_tablas, _funciones).

-- ---------- Tablas ----------

create table if not exists public.cxc_clientes (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  clave text not null,
  nombre text not null,
  rfc text,
  dias_credito int not null default 30 check (dias_credito between 0 and 365),
  linea_credito numeric(14, 2) check (linea_credito is null or linea_credito >= 0),
  pue_a_credito boolean not null default false,
  area text,
  responsable text,
  notas text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id),
  unique (grupo_id, clave)
);

create table if not exists public.cxc_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  tipo text not null default 'estimacion' check (tipo in ('estimacion', 'factura', 'saldo_inicial', 'otro')),
  folio text not null,
  cliente_clave text not null,
  cliente_nombre text not null,
  cliente_rfc text,
  proyecto_id uuid references public.proyectos (id),
  obra text,
  fecha date not null,
  vence date,
  total numeric(14, 2) not null check (total > 0),
  retenido numeric(14, 2) not null default 0 check (retenido >= 0),
  cfdi_id uuid,
  concepto text,
  cancelado_en timestamptz,
  cancelado_motivo text,
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (retenido <= total)
);
create unique index if not exists cxc_documentos_folio_unico
  on public.cxc_documentos (empresa_id, tipo, upper(folio)) where cancelado_en is null;
create index if not exists cxc_documentos_empresa_idx on public.cxc_documentos (empresa_id, cliente_clave);
create index if not exists cxc_documentos_cfdi_idx on public.cxc_documentos (cfdi_id);
create index if not exists cxc_documentos_proyecto_idx on public.cxc_documentos (proyecto_id);
create index if not exists cxc_documentos_created_by_idx on public.cxc_documentos (created_by);

create table if not exists public.cxc_cobros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  cliente_clave text not null,
  cliente_nombre text not null,
  tipo text not null default 'deposito' check (tipo in ('deposito', 'ajuste')),
  fecha date not null,
  monto numeric(14, 2) not null check (monto > 0),
  cuenta_id uuid references public.cuentas_bancarias (id),
  referencia text,
  movimiento_id uuid references public.movimientos (id),
  notas text,
  cancelado_en timestamptz,
  cancelado_por uuid references auth.users (id),
  cancelado_motivo text,
  created_by uuid default auth.uid() references auth.users (id),
  created_by_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists cxc_cobros_empresa_idx on public.cxc_cobros (empresa_id, cliente_clave, fecha);
create index if not exists cxc_cobros_movimiento_idx on public.cxc_cobros (movimiento_id);
create index if not exists cxc_cobros_cuenta_idx on public.cxc_cobros (cuenta_id);
create index if not exists cxc_cobros_created_by_idx on public.cxc_cobros (created_by);
create index if not exists cxc_cobros_cancelado_por_idx on public.cxc_cobros (cancelado_por);

create table if not exists public.cxc_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  cobro_id uuid not null references public.cxc_cobros (id),
  empresa_id uuid not null references public.empresas (id),
  cfdi_id uuid,
  documento_id uuid references public.cxc_documentos (id),
  monto numeric(14, 2) not null check (monto > 0),
  check (num_nonnulls(cfdi_id, documento_id) = 1)
);
create index if not exists cxc_aplicaciones_cobro_idx on public.cxc_aplicaciones (cobro_id);
create index if not exists cxc_aplicaciones_empresa_idx on public.cxc_aplicaciones (empresa_id);
create index if not exists cxc_aplicaciones_cfdi_idx on public.cxc_aplicaciones (cfdi_id);
create index if not exists cxc_aplicaciones_documento_idx on public.cxc_aplicaciones (documento_id);

create table if not exists public.cxc_gestiones (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  empresa_id uuid references public.empresas (id),
  cliente_clave text not null,
  cliente_nombre text not null,
  tipo text not null default 'llamada' check (tipo in ('llamada', 'correo', 'whatsapp', 'visita', 'aviso_legal', 'otro')),
  fecha date not null default current_date,
  nota text,
  promesa_fecha date,
  promesa_monto numeric(14, 2) check (promesa_monto is null or promesa_monto > 0),
  created_by uuid default auth.uid() references auth.users (id),
  created_by_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists cxc_gestiones_cliente_idx on public.cxc_gestiones (grupo_id, cliente_clave, fecha);
create index if not exists cxc_gestiones_empresa_idx on public.cxc_gestiones (empresa_id);
create index if not exists cxc_gestiones_created_by_idx on public.cxc_gestiones (created_by);

-- ---------- Quién ve y quién opera ----------

create or replace function public.auth_opera_cxc()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo and not p.espectador
      and p.rol in ('admin', 'direccion', 'corporativo'))
$$;

create or replace function public.auth_ve_cxc()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo and not p.espectador
      and p.rol in ('admin', 'direccion', 'corporativo', 'empresa'))
$$;
revoke all on function public.auth_opera_cxc() from public, anon;
revoke all on function public.auth_ve_cxc() from public, anon;
grant execute on function public.auth_opera_cxc() to authenticated;
grant execute on function public.auth_ve_cxc() to authenticated;

-- Clave del cliente: el RFC; sin RFC, "N:" + nombre normalizado.
create or replace function public.fn_cxc_clave_cliente(p_rfc text, p_nombre text)
returns text language sql immutable set search_path = public as $$
  select case when nullif(btrim(coalesce(p_rfc, '')), '') is not null then upper(btrim(p_rfc))
              else 'N:' || public.fn_proveedor_clave(coalesce(p_nombre, '')) end
$$;

-- ---------- Triggers ----------

create or replace function public.cxc_clientes_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.grupo_id is null then new.grupo_id := public.auth_grupo_id(); end if;
  if new.grupo_id is null then raise exception 'No se pudo determinar la organización del cliente.'; end if;
  new.nombre := btrim(regexp_replace(new.nombre, '\s+', ' ', 'g'));
  new.rfc := nullif(upper(btrim(coalesce(new.rfc, ''))), '');
  if new.clave is null or btrim(new.clave) = '' then new.clave := public.fn_cxc_clave_cliente(new.rfc, new.nombre); end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
create or replace trigger cxc_clientes_antes before insert or update on public.cxc_clientes
  for each row execute function public.cxc_clientes_antes();

create or replace function public.cxc_documentos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.folio := btrim(new.folio);
  new.cliente_nombre := btrim(regexp_replace(new.cliente_nombre, '\s+', ' ', 'g'));
  new.cliente_rfc := nullif(upper(btrim(coalesce(new.cliente_rfc, ''))), '');
  new.cliente_clave := public.fn_cxc_clave_cliente(new.cliente_rfc, new.cliente_nombre);
  if new.cfdi_id is not null and not exists (
       select 1 from public.cfdi c where c.id = new.cfdi_id and c.empresa_id = new.empresa_id and c.tipo = 'emitido') then
    raise exception 'La factura ligada no es de esa empresa.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger cxc_documentos_antes before insert or update on public.cxc_documentos
  for each row execute function public.cxc_documentos_antes();

create or replace function public.cxc_gestiones_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.grupo_id is null then new.grupo_id := public.auth_grupo_id(); end if;
  if new.grupo_id is null then raise exception 'No se pudo determinar la organización.'; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    select nombre into new.created_by_nombre from public.profiles where id = auth.uid();
  end if;
  return new;
end;
$$;
create or replace trigger cxc_gestiones_antes before insert or update on public.cxc_gestiones
  for each row execute function public.cxc_gestiones_antes();

-- ---------- RLS ----------

alter table public.cxc_clientes enable row level security;
alter table public.cxc_documentos enable row level security;
alter table public.cxc_cobros enable row level security;
alter table public.cxc_aplicaciones enable row level security;
alter table public.cxc_gestiones enable row level security;

do $x$
declare t text;
begin
  -- Por empresa.
  foreach t in array array['cxc_documentos', 'cxc_cobros', 'cxc_aplicaciones'] loop
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
      with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))$p$, t);
    execute format($p$create policy %I on public.%I for select
      using ((select public.auth_ve_cxc()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_select', t);
  end loop;
  -- Por organización.
  foreach t in array array['cxc_clientes', 'cxc_gestiones'] loop
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))$p$, t);
    execute format($p$create policy %I on public.%I for select using ((select public.auth_ve_cxc()))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I for insert with check ((select public.auth_opera_cxc()))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update using ((select public.auth_opera_cxc())) with check ((select public.auth_opera_cxc()))$p$, t || '_update', t);
  end loop;
  foreach t in array array['cxc_clientes', 'cxc_documentos', 'cxc_cobros', 'cxc_aplicaciones', 'cxc_gestiones'] loop
    execute format('create policy espectador_sin_datos on public.%I as restrictive for select using (not (select public.auth_es_espectador()))', t);
    execute format('create policy director_general on public.%I for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()))', t);
    execute format('create trigger solo_consulta before insert or update on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $x$;

-- Estimaciones y documentos: los capturan quienes operan, en su alcance.
create policy cxc_documentos_insert on public.cxc_documentos for insert
  with check ((select public.auth_opera_cxc()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
create policy cxc_documentos_update on public.cxc_documentos for update
  using ((select public.auth_opera_cxc()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
  with check ((select public.auth_opera_cxc()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
-- Cobros y aplicaciones solo por fn_cxc_registrar_cobro / fn_cxc_cancelar_cobro.

-- ---------- Cartera calculada ----------

create or replace function public.fn_cxc_cartera()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid[];
  v_grupo uuid := public.auth_grupo_id();
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_docs jsonb;
  v_clientes jsonb;
begin
  if not public.auth_ve_cxc() then
    raise exception 'Solo dirección, corporativo, empresa o el administrador ven cuentas por cobrar' using errcode = '42501';
  end if;
  v_emp := public.auth_empresas_alcance();

  with emp as (
    select e.id, e.codigo from public.empresas e where e.id = any (v_emp)
  ),
  grupo as (
    select e.id, e.codigo, upper(e.rfc) rfc,
           public.fn_proveedor_clave(coalesce(e.razon_social, e.nombre)) c1, public.fn_proveedor_clave(e.nombre) c2
      from public.empresas e where e.grupo_id = v_grupo
  ),
  cli as (select * from public.cxc_clientes where grupo_id = v_grupo),
  -- Complementos de pago (ImpPagado por factura) y notas de crédito relacionadas.
  sat as (
    select c.empresa_id, upper(x->>'uuid') uuid,
           sum(case when c.tipo_comprobante = 'P' then coalesce((x->>'importe')::numeric, 0)
                    else c.total / greatest(jsonb_array_length(c.relacionados), 1) end) monto
      from public.cfdi c cross join lateral jsonb_array_elements(c.relacionados) x
     where c.tipo = 'emitido' and c.empresa_id = any (v_emp)
       and (c.tipo_comprobante = 'P' or (c.tipo_comprobante = 'E' and coalesce(x->>'tipo_relacion', '') in ('01', '03')))
     group by 1, 2
  ),
  -- Depósitos conciliados con la factura en Movimientos (los ligados a un cobro de aquí van por el cobro).
  banco as (
    select m.empresa_id, upper(btrim(f.folio)) uuid, sum(m.abono_total / f.n) monto
      from public.movimientos m
      cross join lateral (
        select t.folio, count(*) over () n
          from unnest(string_to_array(regexp_replace(m.factura, '^FM?-\s*', ''), ',')) t(folio)) f
     where m.empresa_id = any (v_emp) and m.abono_total > 0 and m.factura ~ '^FM?- '
       and not exists (select 1 from public.cxc_cobros cb where cb.movimiento_id = m.id and cb.cancelado_en is null)
     group by 1, 2
  ),
  aqui as (
    select a.cfdi_id, a.documento_id, sum(a.monto) monto
      from public.cxc_aplicaciones a
      join public.cxc_cobros cb on cb.id = a.cobro_id and cb.cancelado_en is null
     where a.empresa_id = any (v_emp)
     group by 1, 2
  ),
  ligadas as (
    select d.cfdi_id from public.cxc_documentos d
     where d.cfdi_id is not null and d.cancelado_en is null and d.empresa_id = any (v_emp)
  ),
  base as (
    select 'cfdi'::text origen, c.id, c.empresa_id, upper(c.rfc) cliente_clave, coalesce(c.contraparte, c.rfc) cliente_nombre,
           upper(c.rfc) rfc, 'factura'::text tipo, c.folio, upper(c.folio) uuid, c.fecha, null::date vence_propio,
           c.total, 0::numeric retenido, c.metodo_pago, null::uuid proyecto_id, null::text obra, c.id cfdi_id,
           coalesce(aq.monto, 0) cobrado_aqui
      from public.cfdi c
      left join cli on cli.clave = upper(c.rfc)
      left join aqui aq on aq.cfdi_id = c.id
     where c.tipo = 'emitido' and c.empresa_id = any (v_emp) and c.tipo_comprobante = 'I'
       and (c.metodo_pago = 'PPD' or coalesce(cli.pue_a_credito, false))
       and c.id not in (select l.cfdi_id from ligadas l)
    union all
    select 'manual', d.id, d.empresa_id, d.cliente_clave, d.cliente_nombre, d.cliente_rfc, d.tipo, d.folio,
           upper(c.folio), d.fecha, d.vence, d.total, d.retenido, c.metodo_pago, d.proyecto_id,
           coalesce(d.obra, p.nombre), d.cfdi_id,
           coalesce(aq.monto, 0) + coalesce(aqc.monto, 0)
      from public.cxc_documentos d
      left join public.cfdi c on c.id = d.cfdi_id
      left join public.proyectos p on p.id = d.proyecto_id
      left join aqui aq on aq.documento_id = d.id
      left join aqui aqc on d.cfdi_id is not null and aqc.cfdi_id = d.cfdi_id
     where d.empresa_id = any (v_emp) and d.cancelado_en is null
  ),
  calc as (
    select b.*, e.codigo empresa_codigo,
           coalesce(s.monto, 0) cobrado_sat, coalesce(bk.monto, 0) cobrado_banco,
           coalesce(cli.dias_credito, 30) dias_credito,
           g.id cliente_empresa_id, g.codigo cliente_empresa_codigo
      from base b
      join emp e on e.id = b.empresa_id
      left join sat s on s.empresa_id = b.empresa_id and s.uuid = b.uuid
      left join banco bk on bk.empresa_id = b.empresa_id and bk.uuid = b.uuid
      left join cli on cli.clave = b.cliente_clave
      left join lateral (
        select g.id, g.codigo from grupo g
         where g.id <> b.empresa_id
           and (g.rfc = b.rfc or b.cliente_clave in ('N:' || g.c1, 'N:' || g.c2))
         limit 1) g on true
  ),
  fin as (
    select c.*,
           least(c.total, greatest(c.cobrado_sat, c.cobrado_aqui + c.cobrado_banco)) cobrado,
           coalesce(c.vence_propio, c.fecha + c.dias_credito) vence
      from calc c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'origen', origen, 'id', id, 'empresa_id', empresa_id, 'empresa', empresa_codigo,
           'cliente_clave', cliente_clave, 'cliente', cliente_nombre, 'rfc', rfc,
           'cliente_empresa_id', cliente_empresa_id, 'cliente_empresa', cliente_empresa_codigo,
           'tipo', tipo, 'folio', folio, 'uuid', uuid, 'fecha', fecha, 'vence', vence,
           'total', round(total, 2), 'retenido', round(retenido, 2), 'cobrado', round(cobrado, 2),
           'cobrado_sat', round(cobrado_sat, 2), 'cobrado_banco', round(cobrado_banco, 2), 'cobrado_aqui', round(cobrado_aqui, 2),
           'saldo', greatest(round(total - cobrado - retenido, 2), 0),
           'metodo_pago', metodo_pago, 'proyecto_id', proyecto_id, 'obra', obra, 'cfdi_id', cfdi_id
         ) order by fecha, folio), '[]'::jsonb)
    into v_docs
    from fin
   where total - cobrado - retenido > 0.5 or retenido > 0 or fecha >= v_hoy - 180;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.nombre), '[]'::jsonb) into v_clientes
    from public.cxc_clientes c where c.grupo_id = v_grupo;

  return jsonb_build_object('hoy', v_hoy, 'documentos', v_docs, 'clientes', v_clientes);
end;
$$;
revoke all on function public.fn_cxc_cartera() from public, anon;
grant execute on function public.fn_cxc_cartera() to authenticated;

-- ---------- Registrar y cancelar cobros ----------

-- p: {empresa_id, cliente_clave, cliente_nombre, tipo, fecha, monto, cuenta_id,
--     referencia, movimiento_id, notas, aplicaciones: [{origen, id, monto}]}
create or replace function public.fn_cxc_registrar_cobro(p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_empresa uuid := nullif(p->>'empresa_id', '')::uuid;
  v_clave text := nullif(btrim(coalesce(p->>'cliente_clave', '')), '');
  v_monto numeric := round(nullif(p->>'monto', '')::numeric, 2);
  v_tipo text := coalesce(nullif(p->>'tipo', ''), 'deposito');
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, (now() at time zone 'America/Mexico_City')::date);
  v_cuenta uuid := nullif(p->>'cuenta_id', '')::uuid;
  v_mov uuid := nullif(p->>'movimiento_id', '')::uuid;
  v_cartera jsonb;
  v_doc jsonb;
  r record;
  v_suma numeric := 0;
  v_id uuid;
  v_nombre text;
  v_folios text[];
  m public.movimientos%rowtype;
begin
  if not public.auth_opera_cxc() then
    raise exception 'Solo dirección, corporativo o el administrador registran cobros' using errcode = '42501';
  end if;
  if v_empresa is null or not (v_empresa = any (public.auth_empresas_alcance())) then
    raise exception 'Elige una empresa que manejes' using errcode = '42501';
  end if;
  if v_clave is null then raise exception 'Elige el cliente'; end if;
  if v_monto is null or v_monto <= 0 then raise exception 'Captura el monto cobrado'; end if;
  if v_tipo not in ('deposito', 'ajuste') then raise exception 'Tipo de cobro inválido'; end if;
  if v_tipo = 'ajuste' and nullif(btrim(coalesce(p->>'notas', '')), '') is null then
    raise exception 'Un ajuste lleva el motivo en la nota';
  end if;
  if v_cuenta is not null and not exists (select 1 from public.cuentas_bancarias cb where cb.id = v_cuenta and cb.empresa_id = v_empresa) then
    raise exception 'La cuenta no es de esa empresa';
  end if;
  if v_mov is not null then
    select * into m from public.movimientos where id = v_mov for update;
    if not found or m.empresa_id <> v_empresa or coalesce(m.abono_total, 0) <= 0 then
      raise exception 'El depósito elegido no es un abono de esa empresa';
    end if;
    if exists (select 1 from public.cxc_cobros cb where cb.movimiento_id = v_mov and cb.cancelado_en is null) then
      raise exception 'Ese depósito ya está registrado como cobro';
    end if;
  end if;

  v_cartera := public.fn_cxc_cartera() -> 'documentos';
  for r in
    select a->>'origen' origen, a->>'id' id, sum(round((a->>'monto')::numeric, 2)) monto
      from jsonb_array_elements(coalesce(p->'aplicaciones', '[]'::jsonb)) a
     group by 1, 2
  loop
    if r.monto is null or r.monto <= 0 then continue; end if;
    v_doc := null;
    select d into v_doc from jsonb_array_elements(v_cartera) d where d->>'id' = r.id and d->>'origen' = r.origen;
    if v_doc is null then raise exception 'Uno de los documentos ya no está por cobrar; vuelve a cargar la pantalla'; end if;
    if (v_doc->>'empresa_id')::uuid <> v_empresa or v_doc->>'cliente_clave' <> v_clave then
      raise exception 'El documento % no es de ese cliente en esa empresa', v_doc->>'folio';
    end if;
    if r.monto > (v_doc->>'saldo')::numeric + 0.01 then
      raise exception 'Se aplica más del saldo de % ($%)', v_doc->>'folio', v_doc->>'saldo';
    end if;
    v_suma := v_suma + r.monto;
  end loop;
  if v_suma > v_monto + 0.01 then
    raise exception 'Lo aplicado ($%) pasa del monto del cobro ($%)', v_suma, v_monto;
  end if;

  select nombre into v_nombre from public.profiles where id = auth.uid();
  insert into public.cxc_cobros (empresa_id, cliente_clave, cliente_nombre, tipo, fecha, monto, cuenta_id, referencia,
                                 movimiento_id, notas, created_by, created_by_nombre)
  values (v_empresa, v_clave, coalesce(nullif(btrim(coalesce(p->>'cliente_nombre', '')), ''), v_clave), v_tipo, v_fecha, v_monto,
          v_cuenta, nullif(btrim(coalesce(p->>'referencia', '')), ''), v_mov, nullif(btrim(coalesce(p->>'notas', '')), ''),
          auth.uid(), v_nombre)
  returning id into v_id;

  insert into public.cxc_aplicaciones (cobro_id, empresa_id, cfdi_id, documento_id, monto)
  select v_id, v_empresa,
         case when a.origen = 'cfdi' then a.id::uuid end,
         case when a.origen = 'manual' then a.id::uuid end,
         a.monto
    from (select x->>'origen' origen, x->>'id' id, sum(round((x->>'monto')::numeric, 2)) monto
            from jsonb_array_elements(coalesce(p->'aplicaciones', '[]'::jsonb)) x group by 1, 2) a
   where a.monto > 0;

  -- El depósito del banco queda conciliado con las facturas que cubre.
  if v_mov is not null and m.estado_clasificacion is distinct from 'resuelto' then
    select array_agg(distinct upper(c.folio)) into v_folios
      from public.cxc_aplicaciones a
      left join public.cxc_documentos d on d.id = a.documento_id
      join public.cfdi c on c.id = coalesce(a.cfdi_id, d.cfdi_id)
     where a.cobro_id = v_id;
    update public.movimientos mv
       set estado_clasificacion = 'resuelto',
           factura = case when coalesce(array_length(v_folios, 1), 0) > 0 and coalesce(mv.factura, '') !~ '^FM?- '
                          then 'FM- ' || array_to_string(v_folios, ', ') else mv.factura end,
           nombre_razon_social = coalesce(mv.nombre_razon_social, p->>'cliente_nombre'),
           observacion = 'Cobro de ' || coalesce(p->>'cliente_nombre', v_clave) || ' registrado en cuentas por cobrar por ' || coalesce(v_nombre, 'usuario'),
           updated_by = auth.uid(), updated_at = now()
     where mv.id = v_mov;
  end if;
  return v_id;
end;
$$;
revoke all on function public.fn_cxc_registrar_cobro(jsonb) from public, anon;
grant execute on function public.fn_cxc_registrar_cobro(jsonb) to authenticated;

create or replace function public.fn_cxc_cancelar_cobro(p_cobro uuid, p_motivo text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_empresa uuid;
begin
  if not public.auth_opera_cxc() then
    raise exception 'Solo dirección, corporativo o el administrador cancelan cobros' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo'; end if;
  select empresa_id into v_empresa from public.cxc_cobros where id = p_cobro and cancelado_en is null for update;
  if v_empresa is null or not (v_empresa = any (public.auth_empresas_alcance())) then
    raise exception 'Cobro no encontrado o ya cancelado' using errcode = '42501';
  end if;
  update public.cxc_cobros
     set cancelado_en = now(), cancelado_por = auth.uid(), cancelado_motivo = btrim(p_motivo)
   where id = p_cobro;
end;
$$;
revoke all on function public.fn_cxc_cancelar_cobro(uuid, text) from public, anon;
grant execute on function public.fn_cxc_cancelar_cobro(uuid, text) to authenticated;

-- ---------- Entre empresas del grupo ----------

-- Por pareja (vende → compra): lo vendido en OV contra lo que la otra registró
-- como OC/OS al proveedor del grupo, su saldo por pagar y lo vencido; y las OV
-- inter empresa cuya OC no existe en la empresa que compra.
create or replace function public.fn_cxc_entre_empresas(p_desde date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid[];
  v_grupo uuid := public.auth_grupo_id();
  v_desde date := coalesce(p_desde, date '2026-01-01');
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_r jsonb;
begin
  if not public.auth_ve_cxc() then
    raise exception 'Solo dirección, corporativo, empresa o el administrador ven cuentas por cobrar' using errcode = '42501';
  end if;
  v_emp := public.auth_empresas_alcance();

  with emp as (
    select e.id, e.codigo, upper(e.rfc) rfc,
           public.fn_proveedor_clave(coalesce(e.razon_social, e.nombre)) c1, public.fn_proveedor_clave(e.nombre) c2
      from public.empresas e where e.grupo_id = v_grupo and e.id = any (v_emp)
  ),
  ov as (
    select v.empresa_id vende, b.id compra, v.id, v.id_ov folio, v.total, v.interempresa_origen_id origen
      from public.ordenes_venta v
      join lateral (select b.id from emp b
                     where b.id <> v.empresa_id and public.fn_proveedor_clave(v.cliente) in (b.c1, b.c2) limit 1) b on true
     where v.empresa_id = any (v_emp) and v.cancelada_en is null and v.fecha_ov >= v_desde
  ),
  oc as (
    select o.empresa_id compra, a.id vende, o.id, o.total,
           coalesce(o.estatus_backoffice, '') in ('Pendiente Factura', 'Pendiente Comprobante', 'Completada') pagada_bo,
           greatest(o.total - coalesce((select sum(pp.monto) from public.pagos_programados pp
                                         where pp.orden_compra_id = o.id and pp.estatus = 'pagado'), 0), 0) saldo,
           o.fecha_creacion + coalesce((select cc.dias_credito from public.cxc_clientes cc
                                         where cc.grupo_id = v_grupo and cc.clave = b.rfc), 30) vence
      from public.ordenes_compra o
      join lateral (select a.id from emp a
                     where a.id <> o.empresa_id and public.fn_proveedor_clave(o.proveedor) in (a.c1, a.c2) limit 1) a on true
      join emp b on b.id = o.empresa_id
     where o.empresa_id = any (v_emp) and o.rechazada_en is null
       and coalesce(o.estatus_backoffice, '') not ilike 'cancel%' and o.fecha_creacion >= v_desde
  ),
  pares as (select vende, compra from ov union select vende, compra from oc)
  select coalesce(jsonb_agg(jsonb_build_object(
           'vende_id', pr.vende, 'vende', ev.codigo, 'compra_id', pr.compra, 'compra', ec.codigo,
           'vendido', coalesce((select round(sum(ov.total), 2) from ov where ov.vende = pr.vende and ov.compra = pr.compra), 0),
           'ov', (select count(*) from ov where ov.vende = pr.vende and ov.compra = pr.compra),
           'comprado', coalesce((select round(sum(oc.total), 2) from oc where oc.vende = pr.vende and oc.compra = pr.compra), 0),
           'oc', (select count(*) from oc where oc.vende = pr.vende and oc.compra = pr.compra),
           'por_pagar', coalesce((select round(sum(oc.saldo), 2) from oc where oc.vende = pr.vende and oc.compra = pr.compra and not oc.pagada_bo), 0),
           'vencido', coalesce((select round(sum(oc.saldo), 2) from oc where oc.vende = pr.vende and oc.compra = pr.compra and not oc.pagada_bo and oc.vence < v_hoy), 0),
           'ov_sin_oc', coalesce((select jsonb_agg(ov.folio order by ov.folio) from ov
                                   where ov.vende = pr.vende and ov.compra = pr.compra and ov.origen is not null
                                     and not exists (select 1 from public.ordenes_compra o2
                                                      where o2.empresa_id = ov.compra and o2.interempresa_origen_id = ov.origen
                                                        and o2.rechazada_en is null)), '[]'::jsonb)
         ) order by ev.codigo, ec.codigo), '[]'::jsonb)
    into v_r
    from pares pr join emp ev on ev.id = pr.vende join emp ec on ec.id = pr.compra;

  return jsonb_build_object('desde', v_desde, 'hoy', v_hoy, 'pares', v_r);
end;
$$;
revoke all on function public.fn_cxc_entre_empresas(date) from public, anon;
grant execute on function public.fn_cxc_entre_empresas(date) to authenticated;
