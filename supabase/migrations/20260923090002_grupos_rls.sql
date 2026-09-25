-- ── RLS por organización + interruptor de módulos ───────────────────────
--
-- Reescribe las policies existentes para que, además del alcance de empresa
-- que ya tenían (sección 6 del spec), respeten dos fronteras nuevas:
--
--   1. Organización. Antes `auth_ve_todas_empresas()` significaba "las 8
--      empresas"; ahora significa "todas las empresas DE MI ORGANIZACIÓN".
--      Sin este cambio, un corporativo de Loma vería los movimientos de
--      ARSSA en cuanto ARSSA diera de alta su primera empresa.
--   2. Módulo. Si la organización no tiene abierto el módulo, sus tablas no
--      responden -- el interruptor de grupo_modulos es real, no cosmético.
--
-- El admin de la organización maestra (Acumulado) cruza ambas fronteras: es
-- quien da de alta clientes, les abre módulos y da soporte.

-- El alcance de las tablas de RH cuelga de la persona, que es del grupo
-- (personal no tiene empresa_id a propósito: una persona rota entre las
-- empresas del grupo).
create or replace function public.persona_en_alcance(p_personal_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.auth_admin_global()
      or exists (
        select 1 from public.personal p
        where p.id = p_personal_id and p.grupo_id = public.auth_grupo_id()
      )
$$;

-- ── grupos / modulos / grupo_modulos ────────────────────────────────────
alter table public.grupos enable row level security;

create policy grupos_select on public.grupos
  for select
  using (public.auth_rol() <> 'pendiente' and public.grupo_en_alcance(id));

-- Dar de alta (o dar de baja) una organización es una operación de la
-- plataforma, no de un cliente.
create policy grupos_insert on public.grupos
  for insert with check (public.auth_admin_global());

create policy grupos_delete on public.grupos
  for delete using (public.auth_admin_global());

-- Un admin de organización cliente puede corregir el nombre/marca de la
-- suya, pero no convertirla en maestra (el índice único ya lo impediría
-- mientras exista una maestra; el WITH CHECK lo cierra explícitamente).
create policy grupos_update on public.grupos
  for update
  using (public.auth_rol() = 'admin' and public.grupo_en_alcance(id))
  with check (
    public.auth_admin_global()
    or (public.auth_rol() = 'admin' and public.grupo_en_alcance(id) and not es_maestro)
  );

alter table public.modulos enable row level security;

create policy modulos_select on public.modulos
  for select using (public.auth_rol() <> 'pendiente');

create policy modulos_insert on public.modulos for insert with check (public.auth_admin_global());
create policy modulos_update on public.modulos for update using (public.auth_admin_global()) with check (public.auth_admin_global());
create policy modulos_delete on public.modulos for delete using (public.auth_admin_global());

alter table public.grupo_modulos enable row level security;

-- Cualquier usuario con acceso necesita LEER qué módulos tiene abierta su
-- organización (el menú y las rutas del frontend se arman con eso), pero
-- abrirlos y cerrarlos es de la organización maestra.
create policy grupo_modulos_select on public.grupo_modulos
  for select
  using (public.auth_rol() <> 'pendiente' and public.grupo_en_alcance(grupo_id));

create policy grupo_modulos_insert on public.grupo_modulos for insert with check (public.auth_admin_global());
create policy grupo_modulos_update on public.grupo_modulos for update using (public.auth_admin_global()) with check (public.auth_admin_global());
create policy grupo_modulos_delete on public.grupo_modulos for delete using (public.auth_admin_global());

-- ── empresas ────────────────────────────────────────────────────────────
alter policy empresas_select on public.empresas
  using (public.auth_rol() <> 'pendiente' and public.grupo_en_alcance(grupo_id));

alter policy empresas_insert on public.empresas
  with check (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id));

alter policy empresas_update on public.empresas
  using (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id))
  with check (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id));

alter policy empresas_delete on public.empresas
  using (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id));

-- ── profiles ────────────────────────────────────────────────────────────
-- Un admin administra los usuarios de SU organización. Los usuarios recién
-- registrados (rol 'pendiente', todavía sin organización) son visibles para
-- el admin de cualquier organización hasta que alguno los asigne a la suya:
-- es el único camino de alta por autoservicio, y un profile sin asignar no
-- expone más que nombre y rol 'pendiente'.
alter policy profiles_select_self on public.profiles
  using (
    id = (select auth.uid())
    or (public.auth_rol() = 'admin' and (public.grupo_en_alcance(grupo_id) or grupo_id is null))
  );

alter policy profiles_update_self on public.profiles
  using (
    id = (select auth.uid())
    or (public.auth_rol() = 'admin' and (public.grupo_en_alcance(grupo_id) or grupo_id is null))
  )
  with check (
    -- un usuario normal no puede cambiar su propio rol/empresa/organización
    (
      id = (select auth.uid())
      and rol = public.auth_rol()
      and empresa_id is not distinct from public.auth_empresa_id()
      and grupo_id is not distinct from public.auth_grupo_id()
    )
    -- y un admin solo puede dejarlo dentro de su propia organización
    or (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id))
  );

alter policy profiles_admin_insert on public.profiles
  with check (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id));

alter policy profiles_admin_delete on public.profiles
  using (public.auth_rol() = 'admin' and (public.grupo_en_alcance(grupo_id) or grupo_id is null));

-- ── Módulo: conciliación bancaria ───────────────────────────────────────
alter policy cuentas_bancarias_select on public.cuentas_bancarias
  using (
    public.auth_ve_datos_financieros()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cuentas_bancarias_insert on public.cuentas_bancarias
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cuentas_bancarias_update on public.cuentas_bancarias
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cuentas_bancarias_delete on public.cuentas_bancarias
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_compra_select on public.ordenes_compra
  using (
    public.auth_ve_datos_financieros()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_compra_insert on public.ordenes_compra
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_compra_update on public.ordenes_compra
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_compra_delete on public.ordenes_compra
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_venta_select on public.ordenes_venta
  using (
    public.auth_ve_datos_financieros()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_venta_insert on public.ordenes_venta
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_venta_update on public.ordenes_venta
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy ordenes_venta_delete on public.ordenes_venta
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cfdi_select on public.cfdi
  using (
    public.auth_ve_datos_financieros()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cfdi_insert on public.cfdi
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cfdi_update on public.cfdi
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy cfdi_delete on public.cfdi
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy movimientos_select on public.movimientos
  using (
    public.auth_ve_datos_financieros()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy movimientos_insert on public.movimientos
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy movimientos_update on public.movimientos
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy movimientos_delete on public.movimientos
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and public.empresa_en_alcance(empresa_id)
  );

-- archivos_cargados: empresa_id es nullable (carga que falló antes de
-- resolver la empresa), por eso cae al grupo_id propio del archivo.
alter policy archivos_cargados_select on public.archivos_cargados
  using (
    public.auth_ve_datos_financieros()
    and public.auth_modulo_habilitado('conciliacion')
    and case
          when empresa_id is null then public.grupo_en_alcance(grupo_id)
          else public.empresa_en_alcance(empresa_id)
        end
  );

alter policy archivos_cargados_insert on public.archivos_cargados
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('conciliacion')
    and case
          when empresa_id is null then public.grupo_en_alcance(grupo_id)
          else public.empresa_en_alcance(empresa_id)
        end
    and cargado_por = (select auth.uid())
  );

alter policy reglas_clasificacion_select on public.reglas_clasificacion
  using (public.auth_ve_datos_financieros() and public.grupo_en_alcance(grupo_id));

alter policy reglas_clasificacion_insert on public.reglas_clasificacion
  with check (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id));

alter policy reglas_clasificacion_update on public.reglas_clasificacion
  using (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id))
  with check (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id));

alter policy reglas_clasificacion_delete on public.reglas_clasificacion
  using (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id));

alter policy excepciones_proveedor_select on public.excepciones_proveedor
  using (public.auth_ve_datos_financieros() and public.grupo_en_alcance(grupo_id));

alter policy excepciones_proveedor_insert on public.excepciones_proveedor
  with check (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id));

alter policy excepciones_proveedor_update on public.excepciones_proveedor
  using (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id))
  with check (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id));

alter policy excepciones_proveedor_delete on public.excepciones_proveedor
  using (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id));

-- La bitácora guarda la fila completa del movimiento en jsonb: sin frontera
-- de organización sería una fuga de datos financieros entre clientes.
alter policy audit_log_select on public.audit_log
  using (public.auth_rol() in ('corporativo', 'admin') and public.grupo_en_alcance(grupo_id));

-- ── Módulo: inventario ──────────────────────────────────────────────────
alter policy almacenes_select on public.almacenes
  using (
    public.auth_rol() <> 'pendiente'
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy almacenes_write on public.almacenes
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy productos_select on public.productos
  using (
    public.auth_rol() <> 'pendiente'
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy productos_write on public.productos
  using (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy movimientos_inventario_select on public.movimientos_inventario
  using (
    public.auth_rol() <> 'pendiente'
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
  );

alter policy movimientos_inventario_insert on public.movimientos_inventario
  with check (
    public.auth_puede_escribir()
    and public.auth_modulo_habilitado('inventario')
    and public.empresa_en_alcance(empresa_id)
    and registrado_por = (select auth.uid())
  );

-- ── Módulo: recursos humanos ────────────────────────────────────────────
alter policy personal_all on public.personal
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.grupo_en_alcance(grupo_id)
  )
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.grupo_en_alcance(grupo_id)
  );

alter policy asignaciones_diarias_all on public.asignaciones_diarias
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  )
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
    and public.empresa_en_alcance(empresa_id)
  );

alter policy contrataciones_all on public.contrataciones
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  )
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
    and public.empresa_en_alcance(empresa_id)
  );

alter policy documentos_personal_all on public.documentos_personal
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  )
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.persona_en_alcance(personal_id)
  );

alter policy tipos_documento_personal_select on public.tipos_documento_personal
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.grupo_en_alcance(grupo_id)
  );

alter policy tipos_documento_personal_write on public.tipos_documento_personal
  using (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id))
  with check (public.auth_rol() = 'admin' and public.grupo_en_alcance(grupo_id));

alter policy empresas_perfil_legal_all on public.empresas_perfil_legal
  using (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.empresa_en_alcance(empresa_id)
  )
  with check (
    public.auth_rol() in ('rh', 'admin')
    and public.auth_modulo_habilitado('rh')
    and public.empresa_en_alcance(empresa_id)
  );
