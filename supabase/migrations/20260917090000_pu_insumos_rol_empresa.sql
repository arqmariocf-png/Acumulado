-- El catálogo de insumos (pu_insumos) es del grupo: un cambio de texto se ve
-- en todas las tarjetas que lo usan, de cualquier empresa. Hasta ahora solo
-- admin/corporativo/dirección lo escribían y el supervisor ('responsable')
-- podía dar de alta. Un director de empresa (rol 'empresa', ej. Jorge en
-- Ergodinova) necesita armar sus tarjetas completas: crear insumos,
-- corregirles el texto y cotizarlos.
--
-- Regla para no pisar a las demás empresas:
--  * Alta: libre para 'empresa'.
--  * Edición de texto/unidad: 'empresa' y 'responsable' solo sobre insumos
--    que ninguna OTRA empresa usa en sus análisis (nuevos, o usados solo por
--    la suya).
--  * Cotización: 'empresa' captura precios de SU empresa (empresa_id =
--    auth_empresa_id()); fn_pu_costo_insumo ya prefiere el precio de la
--    empresa sobre el del grupo, así que sus tarjetas lo toman y las de las
--    demás siguen con el precio de grupo.

create policy pu_insumos_alta_empresa on public.pu_insumos
  for insert with check (public.auth_rol() = 'empresa');

create policy pu_insumos_editar_empresa on public.pu_insumos
  for update
  using (
    public.auth_rol() in ('empresa', 'responsable')
    and public.auth_empresa_id() is not null
    and not exists (
      select 1
      from public.pu_analisis_items it
      join public.pu_analisis a on a.id = it.analisis_id
      where it.insumo_id = pu_insumos.id
        and a.empresa_id <> public.auth_empresa_id()
    )
  )
  with check (
    public.auth_rol() in ('empresa', 'responsable')
    and public.auth_empresa_id() is not null
  );

create policy pu_insumo_precios_empresa_insert on public.pu_insumo_precios
  for insert with check (
    public.auth_rol() = 'empresa'
    and empresa_id is not null
    and empresa_id = public.auth_empresa_id()
  );
