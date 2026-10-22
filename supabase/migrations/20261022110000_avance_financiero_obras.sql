-- Avance financiero de obras (22-oct-2026, Laura por WhatsApp a Mario: "se
-- puede crear un módulo de avance financiero con estos puntos y visual", con
-- el diseño: filtros empresa / obra / año / periodo / categoría; indicadores
-- presupuesto, real, pagado, pendiente de pago, disponible, obras con alerta;
-- pestañas por obra, por empresa, por categoría, por periodo y capturar
-- presupuesto).
--
-- Lo único que se captura es el presupuesto: `obra_presupuesto`, un renglón
-- por obra y categoría (materiales, mano de obra, subcontratos, renta de
-- equipo, fletes, indirectos) con su monto sin IVA, mes de inicio y de
-- término y el reparto (parejo o curva S; el reparto por mes lo hace la
-- pantalla, lib/avanceFinanciero.ts). Lo real sale de lo que Acumulado ya
-- tiene, por mes y categoría:
--   * OC y OS ligadas a la obra por nombre de proyecto (igual que
--     fn_obra_gasto_backoffice), sin canceladas ni rechazadas, en el mes en
--     que se emiten, a subtotal (sin IVA). Cada OC se reparte entre
--     categorías por el importe de sus partidas: "flete/acarreo" → fletes,
--     "renta/arrendamiento" → renta de equipo, combustible, viáticos,
--     papelería… → indirectos; lo demás → materiales (OC) o subcontratos (OS).
--     Pagado = la OC completa si ya se pagó (aquí o en el backoffice) o lo
--     pagado aquí; pendiente = real − pagado.
--   * Mano de obra pagada de la API (api_MO_period_aut) en el mes en que
--     termina su semana; ya está pagada.
-- `fn_avance_financiero()` (definer) regresa obras activas con su avance
-- físico (tarjetas hechas / total de sus tableros) y lo real; lo ven el admin
-- maestro y dirección/empresa en su alcance. `fn_avance_financiero_pendientes`
-- da las OC con saldo de una obra con su vencimiento.
--
-- Ya aplicado en producción (avance_financiero_obras).

create table if not exists public.obra_presupuesto (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),
  categoria text not null check (categoria in ('materiales', 'mano_obra', 'subcontratos', 'renta_equipo', 'fletes', 'indirectos')),
  monto numeric(14, 2) not null default 0 check (monto >= 0),
  mes_inicio date not null,
  mes_fin date not null,
  reparto text not null default 'parejo' check (reparto in ('parejo', 'curva_s')),
  notas text,
  created_by uuid default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint obra_presupuesto_meses check (mes_fin >= mes_inicio),
  constraint obra_presupuesto_unico unique (proyecto_id, categoria)
);
create index if not exists obra_presupuesto_empresa_idx on public.obra_presupuesto (empresa_id);
create index if not exists obra_presupuesto_created_by_idx on public.obra_presupuesto (created_by);

-- La empresa sale de la obra; los meses se guardan al día 1.
create or replace function public.obra_presupuesto_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.empresa_id into new.empresa_id from public.proyectos p where p.id = new.proyecto_id;
  if new.empresa_id is null then raise exception 'No encuentro la obra del presupuesto.'; end if;
  new.mes_inicio := date_trunc('month', new.mes_inicio)::date;
  new.mes_fin := date_trunc('month', new.mes_fin)::date;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists obra_presupuesto_antes on public.obra_presupuesto;
create trigger obra_presupuesto_antes before insert or update on public.obra_presupuesto
  for each row execute function public.obra_presupuesto_antes();

-- Quién ve y captura: admin, dirección y rol empresa (en su alcance).
create or replace function public.auth_opera_presupuesto_obra()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo and not p.espectador
      and p.rol in ('admin', 'direccion', 'empresa'))
$$;
revoke all on function public.auth_opera_presupuesto_obra() from public, anon;
grant execute on function public.auth_opera_presupuesto_obra() to authenticated;

alter table public.obra_presupuesto enable row level security;

do $x$
declare t text := 'obra_presupuesto';
begin
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
    using ((select public.auth_opera_presupuesto_obra()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_select', t);
  execute format('drop policy if exists %I on public.%I', t || '_insert', t);
  execute format($p$create policy %I on public.%I for insert
    with check ((select public.auth_opera_presupuesto_obra()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_insert', t);
  execute format('drop policy if exists %I on public.%I', t || '_update', t);
  execute format($p$create policy %I on public.%I for update
    using ((select public.auth_opera_presupuesto_obra()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
    with check ((select public.auth_opera_presupuesto_obra()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_update', t);
  execute format('drop policy if exists %I on public.%I', t || '_delete', t);
  execute format($p$create policy %I on public.%I for delete
    using ((select public.auth_opera_presupuesto_obra()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_delete', t);
  execute format('drop trigger if exists solo_consulta on public.%I', t);
  execute format('create trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
end $x$;

-- Categoría de una partida de OC/OS por su texto (normalizado, en mayúsculas).
create or replace function public.fn_categoria_partida_obra(p_texto text, p_tipo text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_texto ~ '\m(FLETES?|ACARREOS?|TRASLADOS?|PAQUETERIA|MENSAJERIA)\M' then 'fletes'
    when p_texto ~ '\m(RENTAS?|ARRENDAMIENTO|ALQUILER)\M' then 'renta_equipo'
    when p_texto ~ '\m(GASOLINA|DIESEL|COMBUSTIBLES?|VIATICOS?|HOSPEDAJE|HOTEL|ALIMENTOS?|COMIDAS?|CASETAS?|PAPELERIA|ESTACIONAMIENTO|TELEFONIA|INTERNET|PERMISOS?|LICENCIAS?|FIANZAS?|SEGUROS?)\M' then 'indirectos'
    when p_tipo = 'OS' then 'subcontratos'
    else 'materiales'
  end
$$;

-- Lo real por obra, mes y categoría (sin guarda: la usan las de abajo).
create or replace function public.fn_avance_financiero_base()
returns table (proyecto_id uuid, mes date, categoria text, monto_real numeric, pagado numeric)
language sql stable security definer set search_path = public as $$
  with obras as materialized (
    select p.id, public.normalizar_texto_sql(p.nombre) as clave, e.grupo_id
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
     where p.activo
  ), oc as materialized (
    select ob.id as proyecto_id, o.id, o.tipo,
           date_trunc('month', coalesce(o.fecha_creacion, o.created_at::date))::date as mes
      from public.ordenes_compra o
      join public.empresas e on e.id = o.empresa_id
      join obras ob on ob.clave = public.normalizar_texto_sql(o.proyecto) and ob.grupo_id = e.grupo_id
     where o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
       and coalesce(btrim(o.proyecto), '') <> ''
  ), montos as materialized (
    select oc.id,
           coalesce(i.subtotal, v.total / 1.16, 0) as subtotal,
           case when coalesce(v.pagada_backoffice, false) or coalesce(v.saldo, v.total) <= 0.01 then 1::numeric
                else greatest(least((coalesce(v.total, 0) - coalesce(v.saldo, v.total, 0)) / nullif(v.total, 0), 1), 0) end as frac_pagada
      from oc
      join public.v_oc_pagos v on v.id = oc.id
      left join public.v_oc_importes i on i.orden_compra_id = oc.id
  ), lineas as (
    select oc.id, public.fn_categoria_partida_obra(public.normalizar_texto_sql(l.item), oc.tipo) as categoria,
           sum(abs(coalesce(l.cantidad, 0) * coalesce(l.costo, 0))) as peso
      from oc join public.ordenes_compra_lineas l on l.orden_compra_id = oc.id
     group by 1, 2
  ), reparto as (
    select oc.proyecto_id, oc.mes, oc.id,
           coalesce(li.categoria, case when oc.tipo = 'OS' then 'subcontratos' else 'materiales' end) as categoria,
           coalesce(li.peso / nullif(sum(li.peso) over (partition by oc.id), 0),
                    1::numeric / count(*) over (partition by oc.id)) as frac
      from oc left join lineas li on li.id = oc.id
  ), oc_real as (
    select r.proyecto_id, r.mes, r.categoria, sum(m.subtotal * r.frac) as monto_real, sum(m.subtotal * r.frac * m.frac_pagada) as pagado
      from reparto r join montos m on m.id = r.id
     group by 1, 2, 3
  ), mo as (
    select ob.id as proyecto_id,
           date_trunc('month', coalesce((r.datos ->> 'Fecha_fin')::date, (r.datos ->> 'Fecha_inicio')::date))::date as mes,
           sum(coalesce((r.datos ->> 'Monto')::numeric, 0)) as monto
      from public.nomina_externa_renglones r
      join public.nomina_externa_origenes o on o.origen = r.origen
      join obras ob on ob.clave = public.normalizar_texto_sql(r.datos ->> 'Proyecto') and ob.grupo_id = o.grupo_id
     where r.origen = 'mano_obra'
     group by 1, 2
  )
  select proyecto_id, mes, categoria, round(monto_real, 2), round(pagado, 2) from oc_real
  union all
  select proyecto_id, mes, 'mano_obra', round(monto, 2), round(monto, 2) from mo where mes is not null
$$;
revoke all on function public.fn_avance_financiero_base() from public, anon, authenticated;

-- Para la pantalla: obras activas del alcance con su avance físico y lo real.
create or replace function public.fn_avance_financiero()
returns jsonb
language sql stable security definer set search_path = public as $$
  with alcance as materialized (
    select p.id, p.nombre, p.empresa_id, e.codigo as empresa_codigo, e.nombre as empresa_nombre
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
     where p.activo
       and e.id = any (public.auth_empresas_organizacion())
       and (public.auth_admin_global()
            or (public.auth_rol()::text in ('direccion', 'empresa', 'admin') and e.id = any (public.auth_empresas_alcance())))
  ), ultima as (
    select distinct on (c.tablero_id) c.tablero_id, c.id as columna_id
      from public.tablero_columnas c order by c.tablero_id, c.orden desc
  ), tareas as (
    select tb.proyecto_id, count(t.id)::int as total, count(t.id) filter (where t.columna_id = u.columna_id)::int as hechas
      from public.tableros tb
      join public.tarjetas t on t.tablero_id = tb.id and not t.archivada and t.eliminada_en is null
      left join ultima u on u.tablero_id = tb.id
     where not tb.archivado and tb.proyecto_id in (select id from alcance)
     group by tb.proyecto_id
  ), reales as materialized (
    select b.* from public.fn_avance_financiero_base() b where b.proyecto_id in (select id from alcance)
  )
  select jsonb_build_object(
    'obras', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'nombre', a.nombre, 'empresa_id', a.empresa_id, 'empresa_codigo', a.empresa_codigo,
        'empresa_nombre', a.empresa_nombre, 'tareas', coalesce(t.total, 0), 'hechas', coalesce(t.hechas, 0)) order by a.nombre)
      from alcance a left join tareas t on t.proyecto_id = a.id), '[]'::jsonb),
    'real', coalesce((select jsonb_agg(jsonb_build_object(
        'proyecto_id', r.proyecto_id, 'mes', to_char(r.mes, 'YYYY-MM'), 'categoria', r.categoria, 'real', r.monto_real, 'pagado', r.pagado))
      from reales r), '[]'::jsonb))
$$;
revoke all on function public.fn_avance_financiero() from public, anon;
grant execute on function public.fn_avance_financiero() to authenticated;

-- Lo pendiente de pago de una obra: OC/OS con saldo y su vencimiento.
create or replace function public.fn_avance_financiero_pendientes(p_proyecto uuid)
returns table (orden_compra_id uuid, folio text, tipo text, proveedor text, fecha date, total numeric, saldo numeric,
               pendiente_sin_iva numeric, vence date, programado numeric)
language sql stable security definer set search_path = public as $$
  with obra as (
    select p.id, public.normalizar_texto_sql(p.nombre) as clave, e.grupo_id
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
     where p.id = p_proyecto
       and e.id = any (public.auth_empresas_organizacion())
       and (public.auth_admin_global()
            or (public.auth_rol()::text in ('direccion', 'empresa', 'admin') and e.id = any (public.auth_empresas_alcance())))
  )
  select o.id, o.id_orden, o.tipo, o.proveedor, o.fecha_creacion, v.total, v.saldo,
         round(coalesce(i.subtotal, v.total / 1.16) * v.saldo / nullif(v.total, 0), 2), v.vence, v.programado
    from obra
    join public.empresas e on e.grupo_id = obra.grupo_id
    join public.ordenes_compra o on o.empresa_id = e.id and public.normalizar_texto_sql(o.proyecto) = obra.clave
    join public.v_oc_pagos v on v.id = o.id
    left join public.v_oc_importes i on i.orden_compra_id = o.id
   where o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
     and not coalesce(v.pagada_backoffice, false) and coalesce(v.saldo, 0) > 0.01
   order by v.vence nulls last, o.fecha_creacion desc
$$;
revoke all on function public.fn_avance_financiero_pendientes(uuid) from public, anon;
grant execute on function public.fn_avance_financiero_pendientes(uuid) to authenticated;
