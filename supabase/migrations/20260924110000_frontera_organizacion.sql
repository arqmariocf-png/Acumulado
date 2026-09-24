-- ── Cierra la frontera de organización en TODO el esquema ───────────────
--
-- Hasta aquí el aislamiento entre organizaciones solo cubría las tablas que
-- pasaron por 20260923090002 (conciliación, inventario, RH). Los módulos que
-- crecieron después -- producción, requisiciones, precios unitarios,
-- remisiones, proyectos, tableros, checador, BBVA, nómina externa -- seguían
-- con el patrón `auth_ve_todas_empresas() or empresa_id = auth_empresa_id()`,
-- que devuelve true para TODAS las filas cuando el usuario es corporativo o
-- admin. Con un segundo cliente en la misma base, eso es una fuga.
--
-- Se arregla con policies RESTRICTIVAS en vez de reescribir las 29 policies
-- existentes, y la diferencia importa:
--
--   - Una restrictiva se evalúa en AND con TODAS las demás, incluidas las que
--     todavía no existen. Una policy nueva mal escrita en un módulo futuro ya
--     no puede abrir la frontera: sigue topando con esta.
--   - No hay que tocar -- ni entender, ni arriesgarse a romper -- la lógica de
--     permisos de cada módulo, que es de quien lo construyó.
--
-- Las permisivas siguen decidiendo QUIÉN ve qué dentro de la organización.
-- Estas solo agregan: "y que sea de tu organización".

-- Frontera de organización a secas, sin el alcance de empresa. Distinta de
-- empresa_en_alcance(), que además exige que sea TU empresa: aquí solo importa
-- que la empresa sea del mismo grupo, para no quitarle acceso a nadie dentro
-- de su propia organización (un responsable de proyecto de otra empresa del
-- grupo, por ejemplo, que hoy sí ve lo suyo).
create or replace function public.empresa_en_mi_organizacion(p_empresa_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_admin_global()
      or exists (
        select 1 from public.empresas e
        where e.id = p_empresa_id and e.grupo_id = public.auth_grupo_id()
      )
$$;

-- ── Catálogos que eran globales y ahora son por organización ────────────
-- pu_insumos es el catálogo de insumos de Precios Unitarios: sin grupo_id,
-- ARSSA vería los insumos y los costos de Loma, que es información de negocio.
alter table public.pu_insumos add column grupo_id uuid references public.grupos (id);
update public.pu_insumos set grupo_id = (select id from public.grupos where es_maestro);
alter table public.pu_insumos alter column grupo_id set not null;
create index pu_insumos_grupo_idx on public.pu_insumos (grupo_id);
create trigger pu_insumos_set_grupo before insert on public.pu_insumos
  for each row execute function public.set_grupo_id_del_usuario();

-- Mismo caso: catálogos y bitácoras que no cuelgan de ninguna empresa.
alter table public.perfiles_jornada add column grupo_id uuid references public.grupos (id);
update public.perfiles_jornada set grupo_id = (select id from public.grupos where es_maestro);
alter table public.perfiles_jornada alter column grupo_id set not null;
create trigger perfiles_jornada_set_grupo before insert on public.perfiles_jornada
  for each row execute function public.set_grupo_id_del_usuario();

alter table public.checador_ubicaciones add column grupo_id uuid references public.grupos (id);
update public.checador_ubicaciones set grupo_id = (select id from public.grupos where es_maestro);
alter table public.checador_ubicaciones alter column grupo_id set not null;
create trigger checador_ubicaciones_set_grupo before insert on public.checador_ubicaciones
  for each row execute function public.set_grupo_id_del_usuario();

alter table public.nomina_externa_origenes add column grupo_id uuid references public.grupos (id);
update public.nomina_externa_origenes set grupo_id = (select id from public.grupos where es_maestro);
alter table public.nomina_externa_origenes alter column grupo_id set not null;
create trigger nomina_externa_origenes_set_grupo before insert on public.nomina_externa_origenes
  for each row execute function public.set_grupo_id_del_usuario();

-- ── Frontera: tablas que cuelgan de una empresa ─────────────────────────
-- `profiles` y `empresas` no llevan restrictiva de empresa: su frontera es
-- grupo_id y ya la imponen sus propias policies (20260923090002). Ponerle una
-- de empresa a profiles dejaría fuera a los usuarios sin empresa asignada.
create policy frontera_organizacion on public.almacenes as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.asignaciones_diarias as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.cfdi as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.contrataciones as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.cuentas_bancarias as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.empresas_perfil_legal as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.equipos_produccion as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.materias_primas as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.movimientos as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.movimientos_inventario as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.notas_entrega as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.ordenes_compra as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.ordenes_produccion as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.ordenes_venta as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.pagos_programados as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.perfil_fiscal_parametros as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.productos as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.productos_produccion as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.proyectos as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.pu_analisis as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.pu_factores as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.pu_precios_cliente as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.remisiones_produccion as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.remisiones_salida as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.requisiciones as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.solicitudes_firma as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));
create policy frontera_organizacion on public.vacantes as restrictive for all
  using (public.empresa_en_mi_organizacion(empresa_id)) with check (public.empresa_en_mi_organizacion(empresa_id));

-- tableros.empresa_id es nullable: el tablero de RH es de toda la
-- organización. Mientras no tenga grupo_id propio, un tablero sin empresa se
-- comparte -- queda anotado en SPEC.md 11.1 como pendiente.
create policy frontera_organizacion on public.tableros as restrictive for all
  using (empresa_id is null or public.empresa_en_mi_organizacion(empresa_id))
  with check (empresa_id is null or public.empresa_en_mi_organizacion(empresa_id));

-- ── Frontera: tablas que ya cuelgan de un grupo ─────────────────────────
create policy frontera_organizacion on public.archivos_cargados as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
create policy frontera_organizacion on public.reglas_clasificacion as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
create policy frontera_organizacion on public.excepciones_proveedor as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
create policy frontera_organizacion on public.personal as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
create policy frontera_organizacion on public.tipos_documento_personal as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
create policy frontera_organizacion on public.pu_insumos as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
create policy frontera_organizacion on public.perfiles_jornada as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
create policy frontera_organizacion on public.checador_ubicaciones as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
create policy frontera_organizacion on public.nomina_externa_origenes as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));

-- ── Frontera: tablas que cuelgan de un padre ────────────────────────────
create policy frontera_organizacion on public.proyecto_planos as restrictive for all
  using (exists (select 1 from public.proyectos p where p.id = proyecto_planos.proyecto_id and public.empresa_en_mi_organizacion(p.empresa_id)))
  with check (exists (select 1 from public.proyectos p where p.id = proyecto_planos.proyecto_id and public.empresa_en_mi_organizacion(p.empresa_id)));
create policy frontera_organizacion on public.proyecto_controles as restrictive for all
  using (exists (select 1 from public.proyectos p where p.id = proyecto_controles.proyecto_id and public.empresa_en_mi_organizacion(p.empresa_id)))
  with check (exists (select 1 from public.proyectos p where p.id = proyecto_controles.proyecto_id and public.empresa_en_mi_organizacion(p.empresa_id)));
create policy frontera_organizacion on public.proyecto_control_compras as restrictive for all
  using (exists (select 1 from public.proyecto_controles c join public.proyectos p on p.id = c.proyecto_id where c.id = proyecto_control_compras.control_id and public.empresa_en_mi_organizacion(p.empresa_id)))
  with check (exists (select 1 from public.proyecto_controles c join public.proyectos p on p.id = c.proyecto_id where c.id = proyecto_control_compras.control_id and public.empresa_en_mi_organizacion(p.empresa_id)));
create policy frontera_organizacion on public.proyecto_control_nomina as restrictive for all
  using (exists (select 1 from public.proyecto_controles c join public.proyectos p on p.id = c.proyecto_id where c.id = proyecto_control_nomina.control_id and public.empresa_en_mi_organizacion(p.empresa_id)))
  with check (exists (select 1 from public.proyecto_controles c join public.proyectos p on p.id = c.proyecto_id where c.id = proyecto_control_nomina.control_id and public.empresa_en_mi_organizacion(p.empresa_id)));

create policy frontera_organizacion on public.pu_analisis_items as restrictive for all
  using (exists (select 1 from public.pu_analisis a where a.id = pu_analisis_items.analisis_id and public.empresa_en_mi_organizacion(a.empresa_id)))
  with check (exists (select 1 from public.pu_analisis a where a.id = pu_analisis_items.analisis_id and public.empresa_en_mi_organizacion(a.empresa_id)));
create policy frontera_organizacion on public.pu_aprobaciones as restrictive for all
  using (exists (select 1 from public.pu_analisis a where a.id = pu_aprobaciones.analisis_id and public.empresa_en_mi_organizacion(a.empresa_id)))
  with check (exists (select 1 from public.pu_analisis a where a.id = pu_aprobaciones.analisis_id and public.empresa_en_mi_organizacion(a.empresa_id)));
-- pu_insumo_precios.empresa_id es nullable (precio de catálogo, sin empresa):
-- en ese caso la frontera la pone el insumo, que ya es de una organización.
create policy frontera_organizacion on public.pu_insumo_precios as restrictive for all
  using (
    public.empresa_en_mi_organizacion(empresa_id)
    or (empresa_id is null and exists (select 1 from public.pu_insumos i where i.id = pu_insumo_precios.insumo_id and public.grupo_en_alcance(i.grupo_id)))
  )
  with check (
    public.empresa_en_mi_organizacion(empresa_id)
    or (empresa_id is null and exists (select 1 from public.pu_insumos i where i.id = pu_insumo_precios.insumo_id and public.grupo_en_alcance(i.grupo_id)))
  );

create policy frontera_organizacion on public.requisicion_lineas as restrictive for all
  using (exists (select 1 from public.requisiciones r where r.id = requisicion_lineas.requisicion_id and public.empresa_en_mi_organizacion(r.empresa_id)))
  with check (exists (select 1 from public.requisiciones r where r.id = requisicion_lineas.requisicion_id and public.empresa_en_mi_organizacion(r.empresa_id)));
create policy frontera_organizacion on public.necesidades_compra as restrictive for all
  using (exists (select 1 from public.requisicion_lineas rl join public.requisiciones r on r.id = rl.requisicion_id where rl.id = necesidades_compra.requisicion_linea_id and public.empresa_en_mi_organizacion(r.empresa_id)))
  with check (exists (select 1 from public.requisicion_lineas rl join public.requisiciones r on r.id = rl.requisicion_id where rl.id = necesidades_compra.requisicion_linea_id and public.empresa_en_mi_organizacion(r.empresa_id)));
create policy frontera_organizacion on public.necesidades_entrega as restrictive for all
  using (exists (select 1 from public.requisicion_lineas rl join public.requisiciones r on r.id = rl.requisicion_id where rl.id = necesidades_entrega.requisicion_linea_id and public.empresa_en_mi_organizacion(r.empresa_id)))
  with check (exists (select 1 from public.requisicion_lineas rl join public.requisiciones r on r.id = rl.requisicion_id where rl.id = necesidades_entrega.requisicion_linea_id and public.empresa_en_mi_organizacion(r.empresa_id)));

create policy frontera_organizacion on public.remisiones_produccion_lineas as restrictive for all
  using (exists (select 1 from public.remisiones_produccion r where r.id = remisiones_produccion_lineas.remision_id and public.empresa_en_mi_organizacion(r.empresa_id)))
  with check (exists (select 1 from public.remisiones_produccion r where r.id = remisiones_produccion_lineas.remision_id and public.empresa_en_mi_organizacion(r.empresa_id)));
create policy frontera_organizacion on public.receta_items as restrictive for all
  using (exists (select 1 from public.productos_produccion p where p.id = receta_items.producto_id and public.empresa_en_mi_organizacion(p.empresa_id)))
  with check (exists (select 1 from public.productos_produccion p where p.id = receta_items.producto_id and public.empresa_en_mi_organizacion(p.empresa_id)));
create policy frontera_organizacion on public.rutas_producto as restrictive for all
  using (exists (select 1 from public.productos_produccion p where p.id = rutas_producto.producto_id and public.empresa_en_mi_organizacion(p.empresa_id)))
  with check (exists (select 1 from public.productos_produccion p where p.id = rutas_producto.producto_id and public.empresa_en_mi_organizacion(p.empresa_id)));
create policy frontera_organizacion on public.operaciones_programadas as restrictive for all
  using (exists (select 1 from public.ordenes_produccion o where o.id = operaciones_programadas.orden_produccion_id and public.empresa_en_mi_organizacion(o.empresa_id)))
  with check (exists (select 1 from public.ordenes_produccion o where o.id = operaciones_programadas.orden_produccion_id and public.empresa_en_mi_organizacion(o.empresa_id)));
create policy frontera_organizacion on public.costos_indirectos_produccion as restrictive for all
  using (exists (select 1 from public.ordenes_produccion o where o.id = costos_indirectos_produccion.orden_produccion_id and public.empresa_en_mi_organizacion(o.empresa_id)))
  with check (exists (select 1 from public.ordenes_produccion o where o.id = costos_indirectos_produccion.orden_produccion_id and public.empresa_en_mi_organizacion(o.empresa_id)));
create policy frontera_organizacion on public.mano_de_obra_produccion as restrictive for all
  using (exists (select 1 from public.ordenes_produccion o where o.id = mano_de_obra_produccion.orden_produccion_id and public.empresa_en_mi_organizacion(o.empresa_id)))
  with check (exists (select 1 from public.ordenes_produccion o where o.id = mano_de_obra_produccion.orden_produccion_id and public.empresa_en_mi_organizacion(o.empresa_id)));
create policy frontera_organizacion on public.movimientos_materia_prima as restrictive for all
  using (exists (select 1 from public.materias_primas m where m.id = movimientos_materia_prima.materia_prima_id and public.empresa_en_mi_organizacion(m.empresa_id)))
  with check (exists (select 1 from public.materias_primas m where m.id = movimientos_materia_prima.materia_prima_id and public.empresa_en_mi_organizacion(m.empresa_id)));
create policy frontera_organizacion on public.movimientos_producto_terminado as restrictive for all
  using (exists (select 1 from public.productos_produccion p where p.id = movimientos_producto_terminado.producto_id and public.empresa_en_mi_organizacion(p.empresa_id)))
  with check (exists (select 1 from public.productos_produccion p where p.id = movimientos_producto_terminado.producto_id and public.empresa_en_mi_organizacion(p.empresa_id)));

create policy frontera_organizacion on public.documentos_personal as restrictive for all
  using (public.persona_en_alcance(personal_id)) with check (public.persona_en_alcance(personal_id));
create policy frontera_organizacion on public.vacante_candidatos as restrictive for all
  using (exists (select 1 from public.vacantes v where v.id = vacante_candidatos.vacante_id and public.empresa_en_mi_organizacion(v.empresa_id)))
  with check (exists (select 1 from public.vacantes v where v.id = vacante_candidatos.vacante_id and public.empresa_en_mi_organizacion(v.empresa_id)));
create policy frontera_organizacion on public.tablero_columnas as restrictive for all
  using (exists (select 1 from public.tableros t where t.id = tablero_columnas.tablero_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))))
  with check (exists (select 1 from public.tableros t where t.id = tablero_columnas.tablero_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))));

create policy frontera_organizacion on public.nomina_externa_mapeos as restrictive for all
  using (exists (select 1 from public.nomina_externa_origenes o where o.origen = nomina_externa_mapeos.origen and public.grupo_en_alcance(o.grupo_id)))
  with check (exists (select 1 from public.nomina_externa_origenes o where o.origen = nomina_externa_mapeos.origen and public.grupo_en_alcance(o.grupo_id)));
create policy frontera_organizacion on public.nomina_externa_pagos as restrictive for all
  using (exists (select 1 from public.nomina_externa_origenes o where o.origen = nomina_externa_pagos.origen and public.grupo_en_alcance(o.grupo_id)))
  with check (exists (select 1 from public.nomina_externa_origenes o where o.origen = nomina_externa_pagos.origen and public.grupo_en_alcance(o.grupo_id)));
create policy frontera_organizacion on public.nomina_externa_renglones as restrictive for all
  using (exists (select 1 from public.nomina_externa_origenes o where o.origen = nomina_externa_renglones.origen and public.grupo_en_alcance(o.grupo_id)))
  with check (exists (select 1 from public.nomina_externa_origenes o where o.origen = nomina_externa_renglones.origen and public.grupo_en_alcance(o.grupo_id)));

-- El checador y los tableros de BBVA cuelgan de la persona o del usuario que
-- los capturó; su frontera es la organización de ese usuario.
create policy frontera_organizacion on public.checador_registros as restrictive for all
  using (exists (select 1 from public.profiles pr where pr.id = checador_registros.profile_id and public.grupo_en_alcance(pr.grupo_id)))
  with check (exists (select 1 from public.profiles pr where pr.id = checador_registros.profile_id and public.grupo_en_alcance(pr.grupo_id)));

-- ── BBVA, notificaciones y bitácora de sincronización ───────────────────
-- El módulo de mantenimiento BBVA es de Loma y no cuelga de ninguna empresa:
-- se le pone grupo_id como a los demás catálogos, para que el día que otro
-- cliente use algo parecido no compartan tablero.
alter table public.bbva_mantenimiento_snapshots add column grupo_id uuid references public.grupos (id);
update public.bbva_mantenimiento_snapshots set grupo_id = (select id from public.grupos where es_maestro);
alter table public.bbva_mantenimiento_snapshots alter column grupo_id set not null;
create trigger bbva_mantenimiento_snapshots_set_grupo before insert on public.bbva_mantenimiento_snapshots
  for each row execute function public.set_grupo_id_del_usuario();

alter table public.bbva_adquira_pedidos add column grupo_id uuid references public.grupos (id);
update public.bbva_adquira_pedidos set grupo_id = (select id from public.grupos where es_maestro);
alter table public.bbva_adquira_pedidos alter column grupo_id set not null;
create trigger bbva_adquira_pedidos_set_grupo before insert on public.bbva_adquira_pedidos
  for each row execute function public.set_grupo_id_del_usuario();

alter table public.bbva_folios_cuadrilla add column grupo_id uuid references public.grupos (id);
update public.bbva_folios_cuadrilla set grupo_id = (select id from public.grupos where es_maestro);
alter table public.bbva_folios_cuadrilla alter column grupo_id set not null;
create trigger bbva_folios_cuadrilla_set_grupo before insert on public.bbva_folios_cuadrilla
  for each row execute function public.set_grupo_id_del_usuario();

create policy frontera_organizacion on public.bbva_mantenimiento_snapshots as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
create policy frontera_organizacion on public.bbva_adquira_pedidos as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
create policy frontera_organizacion on public.bbva_folios_cuadrilla as restrictive for all
  using (public.grupo_en_alcance(grupo_id)) with check (public.grupo_en_alcance(grupo_id));
create policy frontera_organizacion on public.bbva_folios_control as restrictive for all
  using (exists (select 1 from public.bbva_mantenimiento_snapshots s where s.id = bbva_folios_control.corte_id and public.grupo_en_alcance(s.grupo_id)))
  with check (exists (select 1 from public.bbva_mantenimiento_snapshots s where s.id = bbva_folios_control.corte_id and public.grupo_en_alcance(s.grupo_id)));

-- Una suscripción push es de un usuario, y un usuario es de una organización.
create policy frontera_organizacion on public.push_subscripciones as restrictive for all
  using (exists (select 1 from public.profiles pr where pr.id = push_subscripciones.profile_id and public.grupo_en_alcance(pr.grupo_id)))
  with check (exists (select 1 from public.profiles pr where pr.id = push_subscripciones.profile_id and public.grupo_en_alcance(pr.grupo_id)));

create policy frontera_organizacion on public.sincronizaciones_oc_ov as restrictive for all
  using (exists (select 1 from public.profiles pr where pr.id = sincronizaciones_oc_ov.solicitada_por and public.grupo_en_alcance(pr.grupo_id)))
  with check (exists (select 1 from public.profiles pr where pr.id = sincronizaciones_oc_ov.solicitada_por and public.grupo_en_alcance(pr.grupo_id)));

-- ── Tableros de tareas (kanban) ─────────────────────────────────────────
-- Cuelgan del tablero, que cuelga de la empresa (o de toda la organización,
-- cuando empresa_id es null -- ver la nota en `tableros`).
create policy frontera_organizacion on public.tarjetas as restrictive for all
  using (exists (select 1 from public.tableros t where t.id = tarjetas.tablero_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))))
  with check (exists (select 1 from public.tableros t where t.id = tarjetas.tablero_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))));
create policy frontera_organizacion on public.tarjeta_comentarios as restrictive for all
  using (exists (select 1 from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = tarjeta_comentarios.tarjeta_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))))
  with check (exists (select 1 from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = tarjeta_comentarios.tarjeta_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))));
create policy frontera_organizacion on public.tarjeta_archivos as restrictive for all
  using (exists (select 1 from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = tarjeta_archivos.tarjeta_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))))
  with check (exists (select 1 from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = tarjeta_archivos.tarjeta_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))));
create policy frontera_organizacion on public.tarjeta_actividad as restrictive for all
  using (exists (select 1 from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = tarjeta_actividad.tarjeta_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))))
  with check (exists (select 1 from public.tarjetas ta join public.tableros t on t.id = ta.tablero_id where ta.id = tarjeta_actividad.tarjeta_id and (t.empresa_id is null or public.empresa_en_mi_organizacion(t.empresa_id))));
