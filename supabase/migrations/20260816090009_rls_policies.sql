-- Habilita RLS en todas las tablas transaccionales/de catálogo y define el
-- patrón de acceso descrito en la sección 6 del spec:
--   - rol 'pendiente'            -> sin acceso a nada hasta que admin asigne rol real
--   - rol 'corporativo'/'admin'  -> lee/escribe las 8 empresas
--   - rol 'empresa'              -> lee/escribe solo su empresa_id asignada
--   - rol 'direccion'            -> solo lectura (su empresa o todas si empresa_id es NULL)
-- Los helpers auth_rol()/auth_empresa_id()/auth_ve_todas_empresas()/auth_puede_escribir()
-- están definidos en 20260816090001_extensions_helpers.sql.

-- ── empresas ─────────────────────────────────────────────────────────────
alter table public.empresas enable row level security;

create policy empresas_select on public.empresas
  for select
  using (public.auth_rol() <> 'pendiente');

create policy empresas_write on public.empresas
  for all
  using (public.auth_rol() = 'admin')
  with check (public.auth_rol() = 'admin');

-- ── profiles ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy profiles_select_self on public.profiles
  for select
  using (id = auth.uid() or public.auth_rol() = 'admin');

create policy profiles_update_self on public.profiles
  for update
  using (id = auth.uid() or public.auth_rol() = 'admin')
  with check (
    -- un usuario normal no puede cambiar su propio rol/empresa; solo admin puede
    (id = auth.uid() and rol = public.auth_rol() and empresa_id is not distinct from public.auth_empresa_id())
    or public.auth_rol() = 'admin'
  );

create policy profiles_admin_insert on public.profiles
  for insert
  with check (public.auth_rol() = 'admin');

create policy profiles_admin_delete on public.profiles
  for delete
  using (public.auth_rol() = 'admin');

-- ── cuentas_bancarias ────────────────────────────────────────────────────
alter table public.cuentas_bancarias enable row level security;

create policy cuentas_bancarias_select on public.cuentas_bancarias
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy cuentas_bancarias_write on public.cuentas_bancarias
  for all
  using (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  )
  with check (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

-- ── ordenes_compra / ordenes_venta / cfdi ───────────────────────────────
alter table public.ordenes_compra enable row level security;
alter table public.ordenes_venta enable row level security;
alter table public.cfdi enable row level security;

create policy ordenes_compra_select on public.ordenes_compra
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy ordenes_compra_write on public.ordenes_compra
  for all
  using (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  )
  with check (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy ordenes_venta_select on public.ordenes_venta
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy ordenes_venta_write on public.ordenes_venta
  for all
  using (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  )
  with check (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy cfdi_select on public.cfdi
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy cfdi_write on public.cfdi
  for all
  using (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  )
  with check (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

-- ── movimientos ──────────────────────────────────────────────────────────
alter table public.movimientos enable row level security;

create policy movimientos_select on public.movimientos
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy movimientos_write on public.movimientos
  for all
  using (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  )
  with check (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

-- ── archivos_cargados ────────────────────────────────────────────────────
alter table public.archivos_cargados enable row level security;

create policy archivos_cargados_select on public.archivos_cargados
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy archivos_cargados_insert on public.archivos_cargados
  for insert
  with check (
    public.auth_puede_escribir()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
    and cargado_por = auth.uid()
  );

-- El resultado del procesamiento (estado, filas_procesadas, etc.) lo actualiza
-- el backend/edge function con la service_role key, que bypassa RLS; los
-- usuarios normales no editan archivos ya cargados.

-- ── reglas_clasificacion / excepciones_proveedor ────────────────────────
-- Reglas globales (no están ligadas a una empresa): visibles para cualquier
-- usuario con acceso a la app, editables solo por admin.
alter table public.reglas_clasificacion enable row level security;
alter table public.excepciones_proveedor enable row level security;

create policy reglas_clasificacion_select on public.reglas_clasificacion
  for select
  using (public.auth_rol() <> 'pendiente');

create policy reglas_clasificacion_write on public.reglas_clasificacion
  for all
  using (public.auth_rol() = 'admin')
  with check (public.auth_rol() = 'admin');

create policy excepciones_proveedor_select on public.excepciones_proveedor
  for select
  using (public.auth_rol() <> 'pendiente');

create policy excepciones_proveedor_write on public.excepciones_proveedor
  for all
  using (public.auth_rol() = 'admin')
  with check (public.auth_rol() = 'admin');

-- ── audit_log ────────────────────────────────────────────────────────────
-- Solo lectura para corporativo/admin. Nunca se inserta desde el cliente:
-- el trigger movimientos_audit corre con privilegios del owner de la tabla.
alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log
  for select
  using (public.auth_rol() in ('corporativo', 'admin'));
