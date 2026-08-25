-- Correcciones a partir de los advisors de RENDIMIENTO de Supabase (corridos
-- después del primer despliegue real). De los 4 tipos de hallazgo, dos se
-- corrigen aquí y dos se dejan tal cual, a propósito:
--
-- - unused_index (11, INFO): esperado -- la base está prácticamente vacía,
--   ningún índice ha tenido oportunidad de usarse todavía. Son los mismos
--   índices que ya se diseñaron pensando en los filtros reales del
--   dashboard y de motor-conciliacion (por archivo_id, por empresa, por
--   estado). No se tocan.
-- - unindexed_foreign_keys (10, INFO): igual de esperado por ahora, pero
--   SÍ se corrige -- son índices baratos y varias de estas FK (archivo_id
--   en movimientos/cfdi/ordenes_*) sí se van a filtrar en cuanto haya
--   tráfico real (motor-conciliacion y las funciones de ingesta ya
--   filtran por archivo_id).

create index archivos_cargados_cargado_por_idx on public.archivos_cargados (cargado_por);
create index audit_log_usuario_id_idx on public.audit_log (usuario_id);
create index cfdi_archivo_id_idx on public.cfdi (archivo_id);
create index excepciones_proveedor_updated_by_idx on public.excepciones_proveedor (updated_by);
create index movimientos_archivo_id_idx on public.movimientos (archivo_id);
create index movimientos_created_by_idx on public.movimientos (created_by);
create index movimientos_updated_by_idx on public.movimientos (updated_by);
create index ordenes_compra_archivo_id_idx on public.ordenes_compra (archivo_id);
create index ordenes_venta_archivo_id_idx on public.ordenes_venta (archivo_id);
create index reglas_clasificacion_updated_by_idx on public.reglas_clasificacion (updated_by);

-- ── auth_rls_initplan ────────────────────────────────────────────────────
-- profiles_select_self, profiles_update_self y archivos_cargados_insert
-- llaman a auth.uid() directo en la policy. Postgres re-evalúa esa llamada
-- por CADA FILA en vez de una sola vez por consulta (el resto de las
-- policies del esquema ya evitaban esto porque pasan por los helpers
-- public.auth_rol()/auth_empresa_id(), que sí se cachean como initplan al
-- estar marcados STABLE -- el linter solo detecta llamadas directas a
-- auth.<función>()). El fix estándar: envolver en `(select auth.uid())`,
-- que Postgres sí puede evaluar una sola vez por consulta.
drop policy profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select
  using (id = (select auth.uid()) or public.auth_rol() = 'admin');

drop policy profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update
  using (id = (select auth.uid()) or public.auth_rol() = 'admin')
  with check (
    (id = (select auth.uid()) and rol = public.auth_rol() and empresa_id is not distinct from public.auth_empresa_id())
    or public.auth_rol() = 'admin'
  );

drop policy archivos_cargados_insert on public.archivos_cargados;
create policy archivos_cargados_insert on public.archivos_cargados
  for insert
  with check (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
    and cargado_por = (select auth.uid())
  );

-- ── multiple_permissive_policies ────────────────────────────────────────
-- 8 tablas tenían una policy `for select` Y una policy `for all` (que
-- también cubre select) aplicando ambas al mismo SELECT -- Postgres
-- evalúa las dos por fila en vez de una. Se reemplaza cada `_write for
-- all` por policies específicas de insert/update/delete (mismas
-- condiciones, sin el solape de select).

drop policy empresas_write on public.empresas;
create policy empresas_insert on public.empresas for insert with check (public.auth_rol() = 'admin');
create policy empresas_update on public.empresas for update using (public.auth_rol() = 'admin') with check (public.auth_rol() = 'admin');
create policy empresas_delete on public.empresas for delete using (public.auth_rol() = 'admin');

drop policy cuentas_bancarias_write on public.cuentas_bancarias;
create policy cuentas_bancarias_insert on public.cuentas_bancarias for insert
  with check (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy cuentas_bancarias_update on public.cuentas_bancarias for update
  using (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()))
  with check (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy cuentas_bancarias_delete on public.cuentas_bancarias for delete
  using (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));

drop policy ordenes_compra_write on public.ordenes_compra;
create policy ordenes_compra_insert on public.ordenes_compra for insert
  with check (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy ordenes_compra_update on public.ordenes_compra for update
  using (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()))
  with check (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy ordenes_compra_delete on public.ordenes_compra for delete
  using (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));

drop policy ordenes_venta_write on public.ordenes_venta;
create policy ordenes_venta_insert on public.ordenes_venta for insert
  with check (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy ordenes_venta_update on public.ordenes_venta for update
  using (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()))
  with check (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy ordenes_venta_delete on public.ordenes_venta for delete
  using (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));

drop policy cfdi_write on public.cfdi;
create policy cfdi_insert on public.cfdi for insert
  with check (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy cfdi_update on public.cfdi for update
  using (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()))
  with check (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy cfdi_delete on public.cfdi for delete
  using (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));

drop policy movimientos_write on public.movimientos;
create policy movimientos_insert on public.movimientos for insert
  with check (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy movimientos_update on public.movimientos for update
  using (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()))
  with check (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));
create policy movimientos_delete on public.movimientos for delete
  using (public.auth_puede_escribir() and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id()));

drop policy reglas_clasificacion_write on public.reglas_clasificacion;
create policy reglas_clasificacion_insert on public.reglas_clasificacion for insert with check (public.auth_rol() = 'admin');
create policy reglas_clasificacion_update on public.reglas_clasificacion for update using (public.auth_rol() = 'admin') with check (public.auth_rol() = 'admin');
create policy reglas_clasificacion_delete on public.reglas_clasificacion for delete using (public.auth_rol() = 'admin');

drop policy excepciones_proveedor_write on public.excepciones_proveedor;
create policy excepciones_proveedor_insert on public.excepciones_proveedor for insert with check (public.auth_rol() = 'admin');
create policy excepciones_proveedor_update on public.excepciones_proveedor for update using (public.auth_rol() = 'admin') with check (public.auth_rol() = 'admin');
create policy excepciones_proveedor_delete on public.excepciones_proveedor for delete using (public.auth_rol() = 'admin');
