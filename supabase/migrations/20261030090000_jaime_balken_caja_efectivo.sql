-- Jaime Sierra (produccion) con Balken y la caja de efectivo (30-oct-2026,
-- Mario: "Habilita a Jaime el poder editar los tiempos de la Maquinaria y
-- también las órdenes y requisiciones de balken. De igual manera que pueda
-- ver la caja de efectivo ya que Jaime hará uso de esa caja").
--
-- 1. Los tiempos de máquina (equipos_produccion, rutas_producto,
--    operaciones_programadas) ya los escribe el rol produccion en su alcance;
--    lo que faltaba estaba en la pantalla (tiempos reales y pasos de la ruta
--    no se editaban a mano). Aquí no cambia nada de eso.
-- 2. Requisiciones de Balken: VBB entra a "Maneja también" de Jaime
--    (auth_empresas_requisicion_permiso = principal + maneja también).
-- 3. Órdenes IA (OC/OS/OV): permiso por persona 'compras'. Quien captura SOLO
--    por ese permiso (no por rol) queda acotado a su empresa principal + las
--    de "Maneja también" (auth_empresas_captura_ordenes), aunque tenga
--    todas_las_empresas; los roles siguen con todo su alcance.
-- 4. Caja de efectivo: permiso por persona 'caja' = ver Efectivo por confirmar
--    (las OC con saldo que se pagan en efectivo y sus pagos) en su alcance.
--    Confirmar sigue siendo de dirección/admin (fn_oc_confirmar_pagadas y el
--    trigger pagos_programados_efectivo_guarda no cambian).

alter table public.permisos_modulo drop constraint if exists permisos_modulo_modulo_check;
alter table public.permisos_modulo add constraint permisos_modulo_modulo_check
  check (modulo = any (array['inventario','produccion','precios','requisiciones','tareas','proyectos','bbva','comedor','legal','checador','contabilidad','tesoreria','punto_venta','compras','cotizador','herramienta','cumplimiento','caja']));

-- Empresas en las que la persona puede capturar órdenes IA.
create or replace function public.auth_empresas_captura_ordenes()
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select case
    when p.rol in ('admin', 'corporativo', 'direccion', 'almacen', 'empresa') then public.auth_empresas_alcance()
    when exists (select 1 from public.permisos_modulo m where m.profile_id = p.id and m.modulo = 'compras') then
      (select coalesce(array_agg(distinct e), '{}'::uuid[])
         from unnest(array[p.empresa_id]
           || coalesce((select array_agg(pe.empresa_id) from public.profile_empresas pe where pe.profile_id = p.id), '{}'::uuid[])) e
        where e is not null)
    else '{}'::uuid[] end
  from public.profiles p
  where p.id = auth.uid() and p.activo and not p.espectador and p.rol <> 'pendiente'
$$;
grant execute on function public.auth_empresas_captura_ordenes() to authenticated, service_role;

do $x$
declare d text; n text;
begin
  d := pg_get_functiondef('public.fn_orden_ia_guardar(uuid,text,uuid,text,text,date,jsonb,text,text,date,text,text)'::regprocedure);
  n := replace(d, $r$if p_empresa is null or not (p_empresa = any (public.auth_empresas_alcance())) then
    raise exception 'Elige una empresa que manejes.' using errcode = '42501';$r$,
  $r$if p_empresa is null or not (p_empresa = any (public.auth_empresas_captura_ordenes())) then
    raise exception 'Elige una empresa que manejes (con permiso de compras solo tu empresa principal y las de "Maneja también").' using errcode = '42501';$r$);
  if n = d then raise exception 'fn_orden_ia_guardar: no se encontró la validación de empresa a reemplazar'; end if;
  execute n;
end $x$;

-- Caja de efectivo: ver las OC en efectivo con saldo y sus pagos.
create policy ordenes_compra_caja_select on public.ordenes_compra
  for select using (
    'caja' = any ((select public.auth_modulos_asignados())::text[])
    and empresa_id = any ((select public.auth_empresas_alcance())::uuid[])
    and (condicion_pago = 'efectivo' or tipo_pago_backoffice ilike 'efectivo%')
  );

create policy pagos_programados_caja_select on public.pagos_programados
  for select using (
    'caja' = any ((select public.auth_modulos_asignados())::text[])
    and empresa_id = any ((select public.auth_empresas_alcance())::uuid[])
    and metodo = 'efectivo'
  );

-- Jaime: Balken en "Maneja también", permiso de compras y de caja.
insert into public.profile_empresas (profile_id, empresa_id)
select p.id, e.id from public.profiles p, public.empresas e
 where p.rol = 'produccion' and p.nombre ilike 'Jaime Sierra%' and e.codigo = 'VBB'
on conflict do nothing;

insert into public.permisos_modulo (profile_id, modulo)
select p.id, m from public.profiles p, unnest(array['compras', 'caja']) m
 where p.rol = 'produccion' and p.nombre ilike 'Jaime Sierra%'
on conflict do nothing;
