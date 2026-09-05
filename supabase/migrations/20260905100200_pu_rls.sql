-- RLS de Precios Unitarios.
--
-- Un PU no es un documento de una obra: es el catálogo de precios de la
-- empresa, y quien trabaja ahí lo consulta completo (a diferencia de
-- Requisiciones, donde un 'responsable' sólo ve sus proyectos). Por eso la
-- lectura es por empresa, más las obras donde el usuario esté asignado
-- aunque sean de otra empresa.
--
-- La escritura es la que se acota, y se acota por ETAPA, no por rol suelto:
-- pu_puede_actuar(estado) decide quién resuelve cada paso del circuito, y es
-- la misma función que usa el trigger de flujo. Así no hay dos versiones de
-- la regla que se puedan desincronizar.
--
-- auth.uid() va siempre envuelto en (select ...) para que el planner lo
-- evalúe una vez por statement y no por fila (advisor auth_rls_initplan,
-- mismo hallazgo que ya se corrigió en Inventario y Requisiciones).

-- ── Catálogo de insumos ──────────────────────────────────────────────────
alter table public.pu_insumos enable row level security;

create policy pu_insumos_select on public.pu_insumos
  for select
  using (public.auth_rol() <> 'pendiente');

-- Almacén pone precio y proveedor sobre lo que ya cargó supervisión; el
-- catálogo de insumos no es suyo (por eso ni ve la pestaña). RH tampoco
-- entra a este módulo.
create policy pu_insumos_write on public.pu_insumos
  for all
  using (public.auth_rol() in ('admin', 'corporativo', 'empresa', 'direccion', 'responsable'))
  with check (public.auth_rol() in ('admin', 'corporativo', 'empresa', 'direccion', 'responsable'));

-- ── Historial de cotizaciones ────────────────────────────────────────────
alter table public.pu_insumo_precios enable row level security;

-- Se ve el precio de grupo y el de la empresa propia. Un usuario de una
-- empresa no tiene por qué ver lo que otra negoció con su proveedor.
--
-- OJO si algún día se empiezan a capturar precios por empresa: el costeo
-- busca el precio de la empresa DEL ANÁLISIS, pero esta policy filtra por la
-- empresa DE QUIEN CONSULTA. Para quien entra a un análisis de otra empresa
-- (un responsable asignado a una obra ajena, ver pu_analisis_select) las dos
-- no coinciden, y vería el precio de grupo donde otro ve el de la empresa.
-- Hoy no puede pasar porque el frontend guarda todas las cotizaciones a
-- nivel grupo (empresa_id null); en cuanto deje de ser así, hay que
-- resolverlo aquí.
create policy pu_insumo_precios_select on public.pu_insumo_precios
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (empresa_id is null or public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

-- Sólo INSERT: el historial es append-only. Corregir una cotización mal
-- capturada es agregar la buena, no borrar la anterior -- si se pudiera
-- borrar, un análisis viejo dejaría de ser reproducible.
create policy pu_insumo_precios_insert on public.pu_insumo_precios
  for insert
  with check (
    public.auth_rol() in ('admin', 'corporativo', 'empresa', 'direccion', 'responsable')
    and (empresa_id is null or public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

-- ── Factores de sobrecosto ───────────────────────────────────────────────
alter table public.pu_factores enable row level security;

create policy pu_factores_select on public.pu_factores
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

-- Indirectos y utilidad los define dirección general y nadie más: es el
-- margen del grupo, no un parámetro de captura.
create policy pu_factores_write on public.pu_factores
  for all
  using (public.auth_rol() = 'admin')
  with check (public.auth_rol() = 'admin');

-- ── Análisis ─────────────────────────────────────────────────────────────
alter table public.pu_analisis enable row level security;

create policy pu_analisis_select on public.pu_analisis
  for select
  using (
    public.auth_rol() not in ('pendiente', 'rh', 'rh_documentos')
    and (
      public.auth_ve_todas_empresas()
      or empresa_id = public.auth_empresa_id()
      or exists (
        select 1 from public.proyectos p
        where p.id = pu_analisis.proyecto_id
          and (p.responsable_id = (select auth.uid()) or p.comprador_id = (select auth.uid()))
      )
    )
  );

-- Crear siempre a nombre propio: quien elabora el PU es quien firma la
-- primera casilla del circuito. admin/corporativo pueden capturar a nombre
-- de alguien más mientras no todos los supervisores tengan cuenta.
create policy pu_analisis_insert on public.pu_analisis
  for insert
  with check (
    (
      public.auth_rol() in ('admin', 'corporativo')
      or (
        public.auth_rol() in ('empresa', 'direccion', 'responsable')
        and creado_por = (select auth.uid())
      )
    )
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
    and estado = 'borrador'
  );

-- USING mira la fila como está hoy (¿me toca a mí esta etapa?) y WITH CHECK
-- la fila que quedaría (que no se la lleven a otra empresa). Qué transición
-- es válida lo decide validar_flujo_pu_analisis, no esto.
create policy pu_analisis_update on public.pu_analisis
  for update
  using (
    public.auth_rol() in ('admin', 'corporativo')
    or (
      public.pu_puede_actuar(estado)
      and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
      -- En borrador manda quien lo elaboró; jefatura de la empresa puede
      -- entrar a corregirlo, un supervisor no toca el borrador de otro.
      and (
        estado <> 'borrador'
        or creado_por = (select auth.uid())
        or public.auth_rol() in ('empresa', 'direccion')
      )
    )
  )
  with check (
    public.auth_rol() in ('admin', 'corporativo')
    or public.auth_ve_todas_empresas()
    or empresa_id = public.auth_empresa_id()
  );

-- Borrar sólo lo que nunca entró al circuito: una vez que alguien firmó, el
-- análisis se da de baja ('obsoleto'), no desaparece.
create policy pu_analisis_delete on public.pu_analisis
  for delete
  using (
    estado = 'borrador'
    and (
      public.auth_rol() in ('admin', 'corporativo')
      or (public.auth_rol() in ('empresa', 'direccion', 'responsable') and creado_por = (select auth.uid()))
    )
  );

-- ── Renglones ────────────────────────────────────────────────────────────
-- Cuelgan del análisis: si lo ves, ves sus renglones; si te toca la etapa en
-- la que está, los puedes tocar. Cuánto puedes cambiar dentro de esa etapa
-- lo acota validar_edicion_item_pu (en revisión de material, sólo precio y
-- proveedor).
alter table public.pu_analisis_items enable row level security;

create policy pu_analisis_items_select on public.pu_analisis_items
  for select
  using (exists (select 1 from public.pu_analisis a where a.id = pu_analisis_items.analisis_id));

create policy pu_analisis_items_write on public.pu_analisis_items
  for all
  using (
    exists (
      select 1 from public.pu_analisis a
      where a.id = pu_analisis_items.analisis_id
        and (public.auth_rol() in ('admin', 'corporativo') or public.pu_puede_actuar(a.estado))
    )
  )
  with check (
    exists (
      select 1 from public.pu_analisis a
      where a.id = pu_analisis_items.analisis_id
        and (public.auth_rol() in ('admin', 'corporativo') or public.pu_puede_actuar(a.estado))
    )
  );

-- ── Bitácora ─────────────────────────────────────────────────────────────
-- Sólo lectura, para todos. La escribe el trigger registrar_aprobacion_pu
-- (SECURITY DEFINER) y nadie más: sin policy de INSERT/UPDATE/DELETE, ni
-- para admin -- una firma que se puede borrar no es una firma.
alter table public.pu_aprobaciones enable row level security;

create policy pu_aprobaciones_select on public.pu_aprobaciones
  for select
  using (exists (select 1 from public.pu_analisis a where a.id = pu_aprobaciones.analisis_id));
