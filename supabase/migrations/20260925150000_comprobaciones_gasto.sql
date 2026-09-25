-- Comprobación de gastos / caja chica (25-sep-2026). Mario: "los supervisores
-- tendrán la facultad de comprobar sus gastos o caja chica subiendo factura o
-- nota con monto y de la obra correspondiente; esto llega como aviso".
-- La factura/nota se sube por la edge function gastos-comprobar (el bucket
-- `cargas` es privado y no tiene policies de storage), que guarda el archivo,
-- inserta aquí y manda push a finanzas (admin, dirección, corporativo).
-- Ya aplicado en producción.

create table if not exists public.comprobaciones_gasto (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  proyecto_id uuid references public.proyectos (id),
  obra_texto text,
  supervisor_id uuid not null references public.profiles (id),
  tipo text not null check (tipo in ('factura', 'nota', 'ticket')),
  monto numeric(14, 2) not null check (monto > 0),
  fecha date not null default current_date,
  concepto text not null,
  proveedor text,
  archivo_path text not null,
  archivo_nombre text,
  estatus text not null default 'enviada' check (estatus in ('enviada', 'aprobada', 'rechazada', 'pagada')),
  revisado_por uuid references public.profiles (id),
  revisado_en timestamptz,
  comentario_revision text,
  created_at timestamptz not null default now()
);

create index if not exists comprobaciones_gasto_empresa_idx on public.comprobaciones_gasto (empresa_id, estatus);
create index if not exists comprobaciones_gasto_supervisor_idx on public.comprobaciones_gasto (supervisor_id);
create index if not exists comprobaciones_gasto_proyecto_idx on public.comprobaciones_gasto (proyecto_id);

-- Quién puede comprobar gastos: supervisores de obra (rol responsable),
-- roles básicos supervisor/directivo/administrativo y los de finanzas.
create or replace function public.auth_puede_comprobar_gasto()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_rol() in ('supervisor', 'responsable', 'directivo', 'administrativo', 'admin', 'corporativo', 'direccion', 'empresa')
$$;

-- Quién revisa (aprueba/rechaza/marca pagada): finanzas.
create or replace function public.auth_revisa_gastos()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_rol() in ('admin', 'corporativo', 'direccion')
$$;

alter table public.comprobaciones_gasto enable row level security;

drop policy if exists comprobaciones_gasto_select on public.comprobaciones_gasto;
create policy comprobaciones_gasto_select on public.comprobaciones_gasto
  for select to authenticated
  using (
    supervisor_id = (select auth.uid())
    or (
      (public.auth_revisa_gastos() or public.auth_rol() = 'empresa')
      and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
    )
  );

drop policy if exists comprobaciones_gasto_insert on public.comprobaciones_gasto;
create policy comprobaciones_gasto_insert on public.comprobaciones_gasto
  for insert to authenticated
  with check (
    public.auth_puede_comprobar_gasto()
    and supervisor_id = (select auth.uid())
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

drop policy if exists comprobaciones_gasto_revision on public.comprobaciones_gasto;
create policy comprobaciones_gasto_revision on public.comprobaciones_gasto
  for update to authenticated
  using (public.auth_revisa_gastos() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()))
  with check (public.auth_revisa_gastos() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));

-- Frontera entre organizaciones (la introdujo otra rama; solo si ya existe).
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'empresa_en_mi_organizacion') then
    execute 'drop policy if exists frontera_organizacion on public.comprobaciones_gasto';
    execute 'create policy frontera_organizacion on public.comprobaciones_gasto as restrictive for all to authenticated using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id))';
  end if;
end $$;

-- El supervisor escoge la obra de su empresa: los roles básicos no veían
-- proyectos si no eran responsables de ellos.
drop policy if exists proyectos_select_gastos on public.proyectos;
create policy proyectos_select_gastos on public.proyectos
  for select to authenticated
  using (
    public.auth_puede_comprobar_gasto()
    and activo
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );

create or replace view public.v_comprobaciones_gasto
with (security_invoker = true) as
select c.*,
       p.nombre as supervisor_nombre,
       pr.nombre as proyecto_nombre,
       coalesce(pr.nombre, c.obra_texto) as obra,
       e.codigo as empresa_codigo,
       e.nombre as empresa_nombre,
       r.nombre as revisado_por_nombre
from public.comprobaciones_gasto c
join public.profiles p on p.id = c.supervisor_id
left join public.proyectos pr on pr.id = c.proyecto_id
join public.empresas e on e.id = c.empresa_id
left join public.profiles r on r.id = c.revisado_por;

grant select on public.v_comprobaciones_gasto to authenticated;

-- KPI de finanzas: comprobaciones por revisar.
insert into public.kpis_organigrama (area, indicador, orden, umbral_ambar, umbral_rojo)
values ('finanzas', 'fin_comprobaciones_por_revisar', 6, 1, 5)
on conflict (area, indicador) do nothing;

-- fn_kpis_empresa: se agrega la clave fin_comprobaciones_por_revisar.
create or replace function public.fn_kpis_empresa(e uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with hoy as (
    select (now() at time zone 'America/Mexico_City')::date as d,
           ((now() at time zone 'America/Mexico_City')::date)::timestamp at time zone 'America/Mexico_City' as inicio
  )
  select jsonb_build_object(
    'fin_saldo_consolidado', (select coalesce(sum(saldo_cierre), 0) from v_saldo_cierre_cuenta where empresa_id = e),
    'fin_pagos_vencidos', (select count(*) from pagos_programados where empresa_id = e and estatus = 'pendiente' and fecha_programada < (select d from hoy)),
    'fin_pagos_semana', (select coalesce(sum(monto), 0) from pagos_programados where empresa_id = e and estatus = 'pendiente' and fecha_programada between (select d from hoy) and (select d from hoy) + 7),
    'fin_saldos_desactualizados', (select count(*) from v_saldo_cierre_cuenta where empresa_id = e and fecha_ultimo_movimiento < (select d from hoy) - 7),
    'fin_prestamos_abiertos', (select count(*) from v_prestamos_intercompania where empresa_id = e and abs(coalesce(monto, 0)) > 0.01),
    'fin_comprobaciones_por_revisar', (select count(*) from comprobaciones_gasto where empresa_id = e and estatus = 'enviada'),
    'movimientos_revisar', (select coalesce(sum(coalesce(ambiguos, 0) + coalesce(duplicados, 0) + coalesce(faltantes, 0)), 0) from v_pendientes_por_empresa where empresa_id = e),
    'cont_sin_cfdi', (select coalesce(sum(coalesce(faltantes, 0)), 0) from v_pendientes_por_empresa where empresa_id = e),
    'carga_sin_estado', (select case when exists (select 1 from v_estado_carga_empresa where empresa_id = e and ultima_carga_estado_cuenta is null) then 1 else 0 end),
    'cont_dias_ultima_carga', (select extract(day from now() - max(completed_at))::int from archivos_cargados where empresa_id = e and estado = 'completado'),
    'cont_cargas_error', (select count(*) from archivos_cargados where empresa_id = e and estado = 'error' and created_at >= now() - interval '30 days'),
    'rh_asistencia_hoy', (
      with plantilla as (
        select distinct p.profile_id
        from personal p
        join contrataciones c on c.personal_id = p.id and c.empresa_id = e and c.estatus = 'vigente'
        where p.activo and p.profile_id is not null
      )
      select case when count(*) = 0 then null
                  else round(100.0 * count(*) filter (where exists (
                    select 1 from checador_registros r
                    where r.profile_id = plantilla.profile_id and r.tipo = 'entrada' and r.anulada_en is null
                      and r.created_at >= (select inicio from hoy))) / count(*))
             end
      from plantilla
    ),
    'rh_personal_activo', (select count(distinct c.personal_id) from contrataciones c join personal p on p.id = c.personal_id where c.empresa_id = e and c.estatus = 'vigente' and p.activo),
    'rh_accesos', (select count(*) from v_personal_accesos where empresa_contratacion_id = e and activo and profile_id is null and docs_indispensables >= 3),
    'rh_contratos', (select count(*) from contrataciones where empresa_id = e and estatus = 'vigente' and fecha_fin between (select d from hoy) and (select d from hoy) + 15),
    'rh_vacantes', (select count(*) from vacantes where empresa_id = e and estatus = 'abierta'),
    'rh_firmas_pendientes', (select count(*) from solicitudes_firma where empresa_id = e and estatus = 'pendiente'),
    'inventario_oc', (select count(*) from avance_recepcion_oc where empresa_id = e and estado_recepcion = 'parcial'),
    'alm_partidas_faltantes', (select count(*) from v_oc_lineas_avance l join ordenes_compra oc on oc.id = l.orden_compra_id where oc.empresa_id = e and l.estado = 'parcial'),
    'alm_partidas_excedente', (select count(*) from v_oc_lineas_avance l join ordenes_compra oc on oc.id = l.orden_compra_id where oc.empresa_id = e and l.estado = 'excedido'),
    'alm_entradas_sin_oc', (select count(*) from movimientos_inventario where empresa_id = e and tipo = 'entrada' and not es_ajuste and orden_compra_id is null),
    'alm_productos_sin_costo', (select count(*) from productos where empresa_id = e and activo and costo_referencia is null),
    'alm_movimientos_hoy', (select count(*) from movimientos_inventario where empresa_id = e and created_at >= (select inicio from hoy)),
    'inventario_remisiones', (select count(*) from remisiones_salida where empresa_id = e and estatus = 'emitida'),
    'produccion_remisiones', (select count(*) from remisiones_produccion where empresa_id = e and estatus = 'emitida'),
    'log_ov_parciales', (select count(*) from avance_embarque_ov where empresa_id = e and estado_embarque = 'parcial'),
    'log_requisiciones', (select count(*) from avance_resolucion_linea a join requisiciones r on r.id = a.requisicion_id where r.empresa_id = e and a.cantidad_sin_resolver > 0),
    'log_dias_entrega', (select coalesce(round(avg(extract(epoch from (entregada_en - created_at)) / 86400)::numeric, 1), 0) from remisiones_salida where empresa_id = e and estatus = 'entregada' and entregada_en is not null and created_at >= now() - interval '30 days'),
    'log_remisiones_semana', (select count(*) from remisiones_salida where empresa_id = e and created_at >= now() - interval '7 days'),
    'produccion_ordenes', (select count(*) from ordenes_produccion where empresa_id = e and estado in ('planeada', 'en_proceso')),
    'op_ordenes_atrasadas', (select count(*) from ordenes_produccion where empresa_id = e and estado in ('planeada', 'en_proceso') and fecha_estimada_embarque < (select d from hoy)),
    'op_operaciones_retrasadas', (select count(*) from operaciones_programadas op join ordenes_produccion o on o.id = op.orden_produccion_id where o.empresa_id = e and op.estado in ('programada', 'en_proceso') and op.fin_programado < now()),
    'precios_pendientes', (select count(*) from pu_analisis where empresa_id = e and estado in ('material_confirmado', 'autorizado')),
    'op_pu_borrador_viejos', (select count(*) from pu_analisis where empresa_id = e and estado = 'borrador' and updated_at < now() - interval '7 days'),
    'op_tareas_vencidas', (select count(*) from tarjetas t join tableros tb on tb.id = t.tablero_id where tb.empresa_id = e and not t.archivada and t.fecha_limite < (select d from hoy)),
    'op_proyectos_activos', (select count(*) from proyectos where empresa_id = e and activo),
    'usuarios', (select count(*) from profiles where empresa_id = e and rol <> 'pendiente'),
    'cuentas_bancarias', (select count(*) from cuentas_bancarias where empresa_id = e and activo)
  );
$$;

revoke all on function public.fn_kpis_empresa(uuid) from public, anon, authenticated;
revoke all on function public.auth_puede_comprobar_gasto() from public, anon;
revoke all on function public.auth_revisa_gastos() from public, anon;
grant execute on function public.auth_puede_comprobar_gasto() to authenticated;
grant execute on function public.auth_revisa_gastos() to authenticated;
