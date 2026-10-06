-- La página se volvía a trabar (6-oct-2026, Mario: "se está trabando mucho"):
-- 40 "statement timeout" por cada 5 minutos, casi todos en BIND sobre
-- requisicion_linea_eventos, requisicion_lineas, avance_resolucion_linea,
-- v_requisicion_ordenes y v_requisicion_avance. Como Alma, leer 50 eventos
-- tardaba 3 s en planear y 18 s en correr: cada tabla hija preguntaba
-- "exists (… requisiciones r …)", y eso arrastraba la policy de
-- requisiciones, que a su vez preguntaba por proyectos (con su propia RLS).
-- Siete copias anidadas por consulta.
--
-- Ahora la regla de quién ve qué requisición se calcula UNA vez por consulta
-- en funciones definer (misma lógica que requisiciones_select) y las tablas
-- hijas solo comparan contra ese arreglo. Misma regla que en
-- 20260928210000: en una policy nunca se pregunta por otra tabla con RLS
-- fila por fila.
--
-- Ya aplicado en producción.

create or replace function public.auth_requisiciones_organizacion()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(r.id), '{}'::uuid[])
  from public.requisiciones r
  where r.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])
$$;

-- Lo mismo que la policy requisiciones_select (5-oct-2026), sin RLS anidada.
create or replace function public.auth_requisiciones_visibles()
returns uuid[] language sql stable security definer set search_path = public as $$
  with yo as (
    select (select public.auth_rol_definer()) as rol,
           (select public.auth_ve_todas_empresas_definer()) as todas,
           (select public.auth_opera_proyectos_empresa_definer()) as opera,
           (select public.auth_empresas_alcance())::uuid[] as alcance,
           (select public.auth_proyectos_propios())::uuid[] as propios,
           (select auth.uid()) as uid
  )
  select coalesce(array_agg(r.id), '{}'::uuid[])
  from public.requisiciones r, yo
  where r.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])
    and yo.rol <> 'pendiente'
    and (
      (yo.todas and not yo.rol = any ('{operativo,administrativo,supervisor,directivo}'::app_rol[]))
      or (yo.rol = any ('{empresa,direccion,almacen}'::app_rol[]) and r.empresa_id = any (yo.alcance))
      or (yo.opera and not yo.rol = any ('{operativo,administrativo,supervisor,directivo}'::app_rol[]) and r.empresa_id = any (yo.alcance))
      or r.solicitado_por = yo.uid
      or r.proyecto_id = any (yo.propios)
      or exists (select 1 from public.proyectos p
                 where p.id = r.proyecto_id and (p.responsable_id = yo.uid or p.comprador_id = yo.uid))
    )
$$;

-- Renglones que se pueden editar: admin/corporativo, o quien la pidió mientras está enviada.
create or replace function public.auth_requisiciones_editables()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(r.id), '{}'::uuid[])
  from public.requisiciones r
  where r.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])
    and ((select public.auth_rol_definer()) = any (array['admin', 'corporativo']::app_rol[])
         or (r.solicitado_por = (select auth.uid()) and r.estado = 'enviada'))
$$;

revoke all on function public.auth_requisiciones_organizacion() from public, anon;
revoke all on function public.auth_requisiciones_visibles() from public, anon;
revoke all on function public.auth_requisiciones_editables() from public, anon;
grant execute on function public.auth_requisiciones_organizacion() to authenticated;
grant execute on function public.auth_requisiciones_visibles() to authenticated;
grant execute on function public.auth_requisiciones_editables() to authenticated;

-- solicitado_por va por fila: al crear una requisición la app pide el
-- renglón de regreso (insert … returning) y el arreglo, calculado al
-- inicio de la sentencia, todavía no la trae ("new row violates row-level
-- security policy for table requisiciones", Timoteo, 6-oct-2026).
alter policy requisiciones_select on public.requisiciones
  using (solicitado_por = (select auth.uid()) or id = any ((select public.auth_requisiciones_visibles())::uuid[]));

alter policy requisicion_lineas_select on public.requisicion_lineas
  using (requisicion_id = any ((select public.auth_requisiciones_visibles())::uuid[]));
alter policy requisicion_lineas_write on public.requisicion_lineas
  using (requisicion_id = any ((select public.auth_requisiciones_editables())::uuid[]))
  with check (requisicion_id = any ((select public.auth_requisiciones_editables())::uuid[]));
alter policy frontera_organizacion on public.requisicion_lineas
  using (requisicion_id = any ((select public.auth_requisiciones_organizacion())::uuid[]))
  with check (requisicion_id = any ((select public.auth_requisiciones_organizacion())::uuid[]));

alter policy requisicion_etapas_select on public.requisicion_etapas
  using (requisicion_id = any ((select public.auth_requisiciones_visibles())::uuid[]));
alter policy frontera_organizacion on public.requisicion_etapas
  using (requisicion_id = any ((select public.auth_requisiciones_organizacion())::uuid[]))
  with check (requisicion_id = any ((select public.auth_requisiciones_organizacion())::uuid[]));

-- Hijas de los renglones: la frontera ya no junta requisiciones (con su RLS).
alter policy frontera_organizacion on public.requisicion_linea_eventos
  using (exists (select 1 from public.requisicion_lineas rl where rl.id = requisicion_linea_eventos.requisicion_linea_id
                 and rl.requisicion_id = any ((select public.auth_requisiciones_organizacion())::uuid[])))
  with check (exists (select 1 from public.requisicion_lineas rl where rl.id = requisicion_linea_eventos.requisicion_linea_id
                 and rl.requisicion_id = any ((select public.auth_requisiciones_organizacion())::uuid[])));
alter policy frontera_organizacion on public.necesidades_compra
  using (exists (select 1 from public.requisicion_lineas rl where rl.id = necesidades_compra.requisicion_linea_id
                 and rl.requisicion_id = any ((select public.auth_requisiciones_organizacion())::uuid[])))
  with check (exists (select 1 from public.requisicion_lineas rl where rl.id = necesidades_compra.requisicion_linea_id
                 and rl.requisicion_id = any ((select public.auth_requisiciones_organizacion())::uuid[])));
alter policy frontera_organizacion on public.necesidades_entrega
  using (exists (select 1 from public.requisicion_lineas rl where rl.id = necesidades_entrega.requisicion_linea_id
                 and rl.requisicion_id = any ((select public.auth_requisiciones_organizacion())::uuid[])))
  with check (exists (select 1 from public.requisicion_lineas rl where rl.id = necesidades_entrega.requisicion_linea_id
                 and rl.requisicion_id = any ((select public.auth_requisiciones_organizacion())::uuid[])));
