-- 4-nov-2026, Mario:
--
-- (1) "En cuentas por cobrar poder consultar el archivo que adjunto para tomar
--     esta base para la conciliación y de ahí arrancamos de ceros. Y aplícales
--     un filtro por empresa y clientes específicos."
--     · cxc_archivos: el estado de cuenta de clientes (Excel de Laura) subido
--       por empresa con su fecha de corte; se consulta desde la pantalla
--       (edge cxc-archivos, bucket cargas/cxc/<empresa>/…).
--     · cxc_documentos.archivo_id liga los saldos iniciales con ese archivo.
--     · Corte: cuando un cliente de una empresa tiene un documento
--       'saldo_inicial' vigente, las facturas del SAT y las OV con fecha hasta
--       ese corte ya no entran a la cartera (están dentro del saldo). Lo
--       posterior al corte sí. Así se arranca de ceros desde la base de Laura.
--     Los filtros por empresa y clientes son de pantalla (el jsonb ya trae
--     empresa_id y cliente_clave por documento).
--
-- (2) "En mi seguimiento de obras para Laura lo único que necesita impactar en
--     gasto son las órdenes relacionadas a la empresa que contrata porque como
--     hay operación entre empresas se duplican pasos."
--     Las OC/OS de una obra solo cuentan si son de la MISMA empresa de la obra
--     (proyectos.empresa_id). Ejemplo: en una obra de Ergodinova, AEP compra el
--     material (OC de AEP a nombre de la obra) y se lo vende a ERG (OC de ERG a
--     AEP): antes se sumaban las dos; ahora solo la de ERG.
--     Aplica en fn_avance_financiero_real (la fuente única del real),
--     fn_obra_gasto_backoffice (conteo de OC), fn_obra_ordenes (lista #gastos)
--     y fn_avance_financiero_pendientes. La mano de obra no cambia.

-- ---------- (2) Gasto de obra: solo órdenes de la empresa que contrata ----------

create or replace function public.fn_avance_financiero_real()
returns table(proyecto_id uuid, mes date, categoria text, origen text, monto_real numeric, pagado numeric)
language sql stable security definer set search_path = public as $$
  with obras as materialized (
    select p.id, p.empresa_id, public.normalizar_texto_sql(p.nombre) as clave, e.grupo_id
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
  ), oc as materialized (
    select ob.id as proyecto_id, o.id, o.tipo,
           date_trunc('month', coalesce(o.fecha_creacion, o.created_at::date))::date as mes
      from public.ordenes_compra o
      join obras ob on ob.clave = public.normalizar_texto_sql(o.proyecto) and ob.empresa_id = o.empresa_id
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
  ), control as (
    select pc.proyecto_id, date_trunc('month', cc.fecha)::date as mes,
           coalesce(public.fn_categoria_partida_obra(public.normalizar_texto_sql(concat_ws(' ', cc.categoria, cc.descripcion)), 'OC'), 'materiales') as categoria,
           sum(cc.importe) as monto, sum(cc.importe) filter (where cc.estatus = 'pagado') as pagado
      from public.proyecto_control_compras cc
      join public.proyecto_controles pc on pc.id = cc.control_id
     where cc.orden_compra_id is null
     group by 1, 2, 3
  )
  select proyecto_id, mes, categoria, 'oc', round(monto_real, 2), round(pagado, 2) from oc_real
  union all
  select proyecto_id, mes, 'mano_obra', 'mano_obra', round(monto, 2), round(monto, 2) from mo where mes is not null
  union all
  select proyecto_id, mes, categoria, 'control', round(monto, 2), round(coalesce(pagado, 0), 2) from control
$$;

create or replace function public.fn_obra_gasto_backoffice(p_proyecto uuid default null)
returns table(proyecto_id uuid, oc_num integer, oc_total numeric, oc_pagado numeric, mo_total numeric, mo_semanas jsonb, mo_partidas jsonb)
language sql stable security definer set search_path = public as $$
  with obras as materialized (
    select p.id, p.empresa_id, public.normalizar_texto_sql(p.nombre) as clave, e.grupo_id
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
     where p_proyecto is null or p.id = p_proyecto
  ), real as materialized (
    select r.* from public.fn_avance_financiero_real() r
     where r.proyecto_id in (select id from obras)
  ), oc as materialized (
    select o.id, o.empresa_id, public.normalizar_texto_sql(o.proyecto) as clave
      from public.ordenes_compra o
     where o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
       and coalesce(btrim(o.proyecto), '') <> ''
  ), oc_num as (
    select ob.id as proyecto_id, count(*)::int as n
      from obras ob join oc on oc.clave = ob.clave and oc.empresa_id = ob.empresa_id
     group by ob.id
  ), oc_obra as (
    select r.proyecto_id, sum(r.monto_real) as total, sum(r.pagado) as pagado
      from real r where r.origen = 'oc' group by r.proyecto_id
  ), mo as materialized (
    select public.normalizar_texto_sql(r.datos ->> 'Proyecto') as clave, o.grupo_id,
           coalesce(nullif(r.datos ->> 'Year', '')::int, extract(year from (r.datos ->> 'Fecha_fin')::date)::int) as anio,
           (r.datos ->> 'Num_sem')::int as semana,
           (r.datos ->> 'Fecha_inicio')::date as inicio, (r.datos ->> 'Fecha_fin')::date as fin,
           coalesce(nullif(btrim(r.datos ->> 'Partida'), ''), 'Sin partida') as partida,
           coalesce((r.datos ->> 'Monto')::numeric, 0) as monto
      from public.nomina_externa_renglones r
      join public.nomina_externa_origenes o on o.origen = r.origen
     where r.origen = 'mano_obra'
  ), mo_obra as (
    select ob.id as proyecto_id, mo.anio, mo.semana, min(mo.inicio) as inicio, max(mo.fin) as fin, mo.partida, sum(mo.monto) as monto
      from obras ob join mo on mo.clave = ob.clave and mo.grupo_id = ob.grupo_id
     group by ob.id, mo.anio, mo.semana, mo.partida
  ), mo_sem as (
    select proyecto_id, sum(monto) as total,
           jsonb_agg(jsonb_build_object('anio', anio, 'semana', semana, 'inicio', inicio, 'fin', fin, 'monto', monto) order by anio desc, semana desc) as semanas
      from (select proyecto_id, anio, semana, min(inicio) as inicio, max(fin) as fin, sum(monto) as monto from mo_obra group by 1, 2, 3) s
     group by proyecto_id
  ), mo_par as (
    select proyecto_id, jsonb_agg(jsonb_build_object('partida', partida, 'monto', monto) order by monto desc) as partidas
      from (select proyecto_id, partida, sum(monto) as monto from mo_obra group by 1, 2) s
     group by proyecto_id
  )
  select ob.id, coalesce(n.n, 0), coalesce(oc_obra.total, 0), coalesce(oc_obra.pagado, 0),
         coalesce(ms.total, 0), coalesce(ms.semanas, '[]'::jsonb), coalesce(mp.partidas, '[]'::jsonb)
    from obras ob
    left join oc_num n on n.proyecto_id = ob.id
    left join oc_obra on oc_obra.proyecto_id = ob.id
    left join mo_sem ms on ms.proyecto_id = ob.id
    left join mo_par mp on mp.proyecto_id = ob.id
   where oc_obra.proyecto_id is not null or ms.proyecto_id is not null
$$;

create or replace function public.fn_obra_ordenes(p_proyecto uuid)
returns table(id uuid, id_orden text, tipo text, empresa_codigo text, proveedor text, fecha_creacion date, total numeric, pagado numeric, saldo numeric, pagada boolean, estatus text, fuente text)
language sql stable security definer set search_path = public as $$
  with obra as (
    select p.empresa_id, public.normalizar_texto_sql(p.nombre) as clave
      from public.proyectos p
     where p.id = p_proyecto
       and public.auth_rol()::text in ('admin', 'corporativo', 'direccion', 'empresa')
       and public.auth_ve_proyecto(p_proyecto)
  )
  select o.id, o.id_orden, o.tipo, e.codigo, o.proveedor, o.fecha_creacion,
         v.total, coalesce(v.pagado, 0), coalesce(v.saldo, v.total),
         (coalesce(v.pagada_backoffice, false) or coalesce(v.saldo, v.total) <= 0.01),
         coalesce(o.estatus_backoffice, case when o.autorizada_en is not null then 'Autorizada' else 'Por autorizar' end),
         o.fuente
    from obra
    join public.ordenes_compra o on public.normalizar_texto_sql(o.proyecto) = obra.clave and o.empresa_id = obra.empresa_id
    join public.empresas e on e.id = o.empresa_id
    join public.v_oc_pagos v on v.id = o.id
   where o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
   order by o.fecha_creacion desc, o.id_orden desc
$$;

create or replace function public.fn_avance_financiero_pendientes(p_proyecto uuid)
returns table(orden_compra_id uuid, folio text, tipo text, proveedor text, fecha date, total numeric, saldo numeric, pendiente_sin_iva numeric, vence date, programado numeric)
language sql stable security definer set search_path = public as $$
  with obra as (
    select p.id, p.empresa_id, public.normalizar_texto_sql(p.nombre) as clave
      from public.proyectos p join public.empresas e on e.id = p.empresa_id
     where p.id = p_proyecto
       and e.id = any (public.auth_empresas_organizacion())
       and (public.auth_admin_global()
            or (public.auth_rol()::text in ('direccion', 'empresa', 'admin') and e.id = any (public.auth_empresas_alcance())))
  )
  select o.id, o.id_orden, o.tipo, o.proveedor, o.fecha_creacion, v.total, v.saldo,
         round(coalesce(i.subtotal, v.total / 1.16) * v.saldo / nullif(v.total, 0), 2), v.vence, v.programado
    from obra
    join public.ordenes_compra o on o.empresa_id = obra.empresa_id and public.normalizar_texto_sql(o.proyecto) = obra.clave
    join public.v_oc_pagos v on v.id = o.id
    left join public.v_oc_importes i on i.orden_compra_id = o.id
   where o.rechazada_en is null and coalesce(o.estatus_backoffice, '') <> 'Cancelada'
     and not coalesce(v.pagada_backoffice, false) and coalesce(v.saldo, 0) > 0.01
   order by v.vence nulls last, o.fecha_creacion desc
$$;

-- ---------- (1) Estados de cuenta de clientes y corte ----------

create table if not exists public.cxc_archivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  nombre text not null,
  storage_path text not null,
  tamano bigint,
  corte date not null,
  nota text,
  -- Lo que se leyó del archivo al subirlo: {clientes: [{nombre, saldo, clave}], total}.
  resumen jsonb,
  subido_por uuid references auth.users(id) default auth.uid(),
  subido_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists cxc_archivos_empresa_idx on public.cxc_archivos (empresa_id, corte desc);

alter table public.cxc_documentos add column if not exists archivo_id uuid references public.cxc_archivos(id);
create index if not exists cxc_documentos_archivo_idx on public.cxc_documentos (archivo_id);

alter table public.cxc_archivos enable row level security;
create policy frontera_organizacion on public.cxc_archivos as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
create policy cxc_archivos_select on public.cxc_archivos for select
  using ((select public.auth_ve_cxc()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
create policy cxc_archivos_insert on public.cxc_archivos for insert
  with check ((select public.auth_opera_cxc()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
create policy cxc_archivos_update on public.cxc_archivos for update
  using ((select public.auth_opera_cxc()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
  with check ((select public.auth_opera_cxc()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
-- Quitar un archivo: solo por la edge cxc-archivos (service role) tras
-- comprobar que quien pide opera cuentas por cobrar en esa empresa.
create policy espectador_sin_datos on public.cxc_archivos as restrictive for select using (not (select public.auth_es_espectador()));
create policy director_general on public.cxc_archivos for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
create trigger solo_consulta before insert or update on public.cxc_archivos for each statement execute function public.bloquear_solo_consulta();
grant select, insert, update on public.cxc_archivos to authenticated;

-- Quien sube pone su nombre (profiles solo deja leer el renglón propio).
create or replace function public.cxc_archivos_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.subido_por_nombre is null and new.subido_por is not null then
    select nombre into new.subido_por_nombre from public.profiles where id = new.subido_por;
  end if;
  return new;
end;
$$;
create or replace trigger cxc_archivos_antes before insert on public.cxc_archivos
  for each row execute function public.cxc_archivos_antes();

-- Cartera: con corte por cliente (saldo inicial vigente) y liga al archivo.
create or replace function public.fn_cxc_cartera()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid[];
  v_grupo uuid := public.auth_grupo_id();
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_docs jsonb;
  v_clientes jsonb;
  v_cortes jsonb;
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
  -- Corte por empresa y cliente: el saldo inicial vigente más reciente. Lo
  -- facturado hasta esa fecha ya está dentro del saldo y no se vuelve a contar.
  cortes as (
    select d.empresa_id, d.cliente_clave, max(d.fecha) corte
      from public.cxc_documentos d
     where d.tipo = 'saldo_inicial' and d.cancelado_en is null and d.empresa_id = any (v_emp)
     group by 1, 2
  ),
  sat as (
    select c.empresa_id, upper(x->>'uuid') uuid,
           sum(case when c.tipo_comprobante = 'P' then coalesce((x->>'importe')::numeric, 0)
                    else c.total / greatest(jsonb_array_length(c.relacionados), 1) end) monto
      from public.cfdi c cross join lateral jsonb_array_elements(c.relacionados) x
     where c.tipo = 'emitido' and c.empresa_id = any (v_emp)
       and (c.tipo_comprobante = 'P' or (c.tipo_comprobante = 'E' and coalesce(x->>'tipo_relacion', '') in ('01', '03')))
     group by 1, 2
  ),
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
           coalesce(aq.monto, 0) cobrado_aqui, null::text concepto, null::uuid archivo_id
      from public.cfdi c
      left join cli on cli.clave = upper(c.rfc)
      left join aqui aq on aq.cfdi_id = c.id
     where c.tipo = 'emitido' and c.empresa_id = any (v_emp) and c.tipo_comprobante = 'I'
       and (c.metodo_pago = 'PPD' or coalesce(cli.pue_a_credito, false))
       and c.id not in (select l.cfdi_id from ligadas l)
       and not exists (select 1 from cortes k where k.empresa_id = c.empresa_id and k.cliente_clave = upper(c.rfc) and c.fecha <= k.corte)
    union all
    select 'manual', d.id, d.empresa_id, d.cliente_clave, d.cliente_nombre, d.cliente_rfc, d.tipo, d.folio,
           upper(c.folio), d.fecha, d.vence, d.total, d.retenido, c.metodo_pago, d.proyecto_id,
           coalesce(d.obra, p.nombre), d.cfdi_id,
           coalesce(aq.monto, 0) + coalesce(aqc.monto, 0), d.concepto, d.archivo_id
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
           'metodo_pago', metodo_pago, 'proyecto_id', proyecto_id, 'obra', obra, 'cfdi_id', cfdi_id,
           'concepto', concepto, 'archivo_id', archivo_id
         ) order by fecha, folio), '[]'::jsonb)
    into v_docs
    from fin
   where total - cobrado - retenido > 0.5 or retenido > 0 or fecha >= v_hoy - 180;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.nombre), '[]'::jsonb) into v_clientes
    from public.cxc_clientes c where c.grupo_id = v_grupo;

  select coalesce(jsonb_agg(jsonb_build_object('empresa_id', k.empresa_id, 'cliente_clave', k.cliente_clave, 'corte', k.corte)), '[]'::jsonb)
    into v_cortes
    from (select d.empresa_id, d.cliente_clave, max(d.fecha) corte
            from public.cxc_documentos d
           where d.tipo = 'saldo_inicial' and d.cancelado_en is null and d.empresa_id = any (v_emp)
           group by 1, 2) k;

  return jsonb_build_object('hoy', v_hoy, 'documentos', v_docs, 'clientes', v_clientes, 'cortes', v_cortes);
end;
$$;

-- OV pendientes de pago: las de hasta el corte del cliente ya están en su saldo inicial.
create or replace function public.fn_cxc_ov_pendientes(p_empresa uuid default null)
returns table(id uuid, id_ov text, empresa_id uuid, empresa text, cliente text, cliente_clave text, cliente_rfc text, fecha_ov date, total numeric, cobrado numeric, saldo numeric, proyecto text, fuente text, condicion_pago text, documento_id uuid, dias_credito integer)
language sql stable security definer set search_path = public as $$
  with emp as (
    select e.id, e.codigo from public.empresas e
     where e.id = any (public.auth_empresas_alcance()) and (p_empresa is null or e.id = p_empresa)
       and public.auth_ve_cxc()
  ),
  ov as (
    select o.*, public.fn_proveedor_clave(o.cliente) k, e.codigo
      from public.ordenes_venta o join emp e on e.id = o.empresa_id
     where o.cancelada_en is null and coalesce(o.total, 0) > 0.5
  ),
  rfc as (
    select distinct on (c.empresa_id, public.fn_proveedor_clave(c.contraparte))
           c.empresa_id, public.fn_proveedor_clave(c.contraparte) k, upper(c.rfc) rfc
      from public.cfdi c join emp e on e.id = c.empresa_id
     where c.tipo = 'emitido' and c.contraparte is not null and c.rfc is not null
     order by c.empresa_id, public.fn_proveedor_clave(c.contraparte), c.fecha desc
  ),
  cli as (
    select cc.clave, cc.rfc, cc.dias_credito, public.fn_proveedor_clave(cc.nombre) k
      from public.cxc_clientes cc where cc.grupo_id = public.auth_grupo_id()
  ),
  docs as (
    select d.orden_venta_id, d.id documento_id, coalesce(sum(a.monto), 0) cobrado
      from public.cxc_documentos d
      left join public.cxc_aplicaciones a on a.documento_id = d.id
      left join public.cxc_cobros cb on cb.id = a.cobro_id and cb.cancelado_en is null
     where d.orden_venta_id is not null and d.cancelado_en is null
     group by d.orden_venta_id, d.id
  ),
  cortes as (
    select d.empresa_id, d.cliente_clave, max(d.fecha) corte
      from public.cxc_documentos d join emp e on e.id = d.empresa_id
     where d.tipo = 'saldo_inicial' and d.cancelado_en is null
     group by 1, 2
  ),
  lista as (
    select ov.id, ov.id_ov, ov.empresa_id, ov.codigo, ov.cliente,
           coalesce(r.rfc, cli.rfc, cli.clave, 'N:' || ov.k) cliente_clave, coalesce(r.rfc, cli.rfc) cliente_rfc,
           ov.fecha_ov, round(ov.total, 2) total, round(coalesce(d.cobrado, 0), 2) cobrado, round(ov.total - coalesce(d.cobrado, 0), 2) saldo,
           ov.proyecto, ov.fuente, ov.condicion_pago, d.documento_id, coalesce(cli.dias_credito, 30) dias_credito
      from ov
      left join rfc r on r.empresa_id = ov.empresa_id and r.k = ov.k
      left join cli on cli.k = ov.k
      left join docs d on d.orden_venta_id = ov.id
     where ov.total - coalesce(d.cobrado, 0) > 0.5
  )
  select l.*
    from lista l
   where l.documento_id is not null
      or not exists (select 1 from cortes k where k.empresa_id = l.empresa_id and k.cliente_clave = l.cliente_clave and l.fecha_ov <= k.corte)
   order by l.fecha_ov desc, l.id_ov desc
$$;
