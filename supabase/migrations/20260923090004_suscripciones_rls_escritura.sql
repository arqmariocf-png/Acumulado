-- ── "Gracia y luego solo lectura", aplicado en la base ──────────────────
--
-- Cuando una organización deja de pagar, sus usuarios siguen pudiendo
-- consultar y exportar lo suyo pero no capturar ni cargar nada. Eso son dos
-- cambios sobre las policies de 20260923090002:
--
--   1. Toda policy de ESCRITURA de datos operativos gana
--      auth_suscripcion_permite_escribir().
--   2. Las tablas cuya única policy era `for all` se parten en select +
--      insert/update/delete. Con una sola policy `for all`, meter la
--      condición en el USING también apagaría la LECTURA (y dejarla solo en
--      el WITH CHECK dejaría pasar los DELETE, que no revisan WITH CHECK).
--      Partirlas es la única forma de que "solo lectura" signifique eso.
--
-- Lo que NO se bloquea nunca: administrar la propia cuenta (empresas,
-- usuarios, organización) y ver el estado de la suscripción. Si al cliente
-- se le bloquea la administración, no puede ni actualizar su tarjeta para
-- volver a estar al corriente.

-- ── Conciliación ────────────────────────────────────────────────────────
alter policy cuentas_bancarias_insert on public.cuentas_bancarias
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cuentas_bancarias_update on public.cuentas_bancarias
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cuentas_bancarias_delete on public.cuentas_bancarias
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_compra_insert on public.ordenes_compra
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_compra_update on public.ordenes_compra
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_compra_delete on public.ordenes_compra
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_venta_insert on public.ordenes_venta
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_venta_update on public.ordenes_venta
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_venta_delete on public.ordenes_venta
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cfdi_insert on public.cfdi
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cfdi_update on public.cfdi
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cfdi_delete on public.cfdi
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy movimientos_insert on public.movimientos
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy movimientos_update on public.movimientos
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy movimientos_delete on public.movimientos
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy archivos_cargados_insert on public.archivos_cargados
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and case
          when empresa_id is null then public.grupo_en_alcance(grupo_id)
          else public.empresa_en_alcance(empresa_id)
        end
    and cargado_por = (select auth.uid())
  );

alter policy reglas_clasificacion_insert on public.reglas_clasificacion
  with check (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id));

alter policy reglas_clasificacion_update on public.reglas_clasificacion
  using (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id))
  with check (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id));

alter policy reglas_clasificacion_delete on public.reglas_clasificacion
  using (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id));

alter policy excepciones_proveedor_insert on public.excepciones_proveedor
  with check (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id));

alter policy excepciones_proveedor_update on public.excepciones_proveedor
  using (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id))
  with check (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id));

alter policy excepciones_proveedor_delete on public.excepciones_proveedor
  using (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id));

-- ── Inventario ──────────────────────────────────────────────────────────
-- almacenes_write y productos_write eran `for all`: se parten para que el
-- SELECT no dependa de la suscripción.
drop policy almacenes_write on public.almacenes;

create policy almacenes_insert on public.almacenes for insert
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

create policy almacenes_update on public.almacenes for update
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

create policy almacenes_delete on public.almacenes for delete
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

drop policy productos_write on public.productos;

create policy productos_insert on public.productos for insert
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

create policy productos_update on public.productos for update
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

create policy productos_delete on public.productos for delete
  using (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy movimientos_inventario_insert on public.movimientos_inventario
  with check (
    public.auth_puede_escribir()
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
    and registrado_por = (select auth.uid())
  );

-- ── Recursos humanos ────────────────────────────────────────────────────
-- Todas estas eran `for all` y además eran la ÚNICA policy de su tabla, así
-- que aquí el split es lo que permite que RH siga consultando expedientes
-- aunque la organización esté en solo lectura.
drop policy personal_all on public.personal;

create policy personal_select on public.personal for select
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.grupo_en_alcance(grupo_id)
  );

create policy personal_insert on public.personal for insert
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.grupo_en_alcance(grupo_id)
  );

create policy personal_update on public.personal for update
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.grupo_en_alcance(grupo_id)
  )
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.grupo_en_alcance(grupo_id)
  );

create policy personal_delete on public.personal for delete
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.grupo_en_alcance(grupo_id)
  );

drop policy asignaciones_diarias_all on public.asignaciones_diarias;

create policy asignaciones_diarias_select on public.asignaciones_diarias for select
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  );

create policy asignaciones_diarias_insert on public.asignaciones_diarias for insert
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
    and public.empresa_en_alcance(empresa_id)
  );

create policy asignaciones_diarias_update on public.asignaciones_diarias for update
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  )
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
    and public.empresa_en_alcance(empresa_id)
  );

create policy asignaciones_diarias_delete on public.asignaciones_diarias for delete
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  );

drop policy contrataciones_all on public.contrataciones;

create policy contrataciones_select on public.contrataciones for select
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  );

create policy contrataciones_insert on public.contrataciones for insert
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
    and public.empresa_en_alcance(empresa_id)
  );

create policy contrataciones_update on public.contrataciones for update
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  )
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
    and public.empresa_en_alcance(empresa_id)
  );

create policy contrataciones_delete on public.contrataciones for delete
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  );

drop policy documentos_personal_all on public.documentos_personal;

create policy documentos_personal_select on public.documentos_personal for select
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  );

create policy documentos_personal_insert on public.documentos_personal for insert
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  );

create policy documentos_personal_update on public.documentos_personal for update
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  )
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  );

create policy documentos_personal_delete on public.documentos_personal for delete
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  );

drop policy empresas_perfil_legal_all on public.empresas_perfil_legal;

create policy empresas_perfil_legal_select on public.empresas_perfil_legal for select
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.empresa_en_alcance(empresa_id)
  );

create policy empresas_perfil_legal_insert on public.empresas_perfil_legal for insert
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.empresa_en_alcance(empresa_id)
  );

create policy empresas_perfil_legal_update on public.empresas_perfil_legal for update
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.empresa_en_alcance(empresa_id)
  );

create policy empresas_perfil_legal_delete on public.empresas_perfil_legal for delete
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('rh')
    and public.empresa_en_alcance(empresa_id)
  );

drop policy tipos_documento_personal_write on public.tipos_documento_personal;

create policy tipos_documento_personal_insert on public.tipos_documento_personal for insert
  with check (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id));

create policy tipos_documento_personal_update on public.tipos_documento_personal for update
  using (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id))
  with check (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id));

create policy tipos_documento_personal_delete on public.tipos_documento_personal for delete
  using (public.auth_rol() = 'admin' and public.auth_suscripcion_permite_escribir() and public.grupo_en_alcance(grupo_id));
