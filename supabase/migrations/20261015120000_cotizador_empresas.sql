-- Cotizador para todas las empresas (15-oct-2026, Mario: "del cotizador
-- tomaremos los mismos productos y los mismos clientes y la lógica de la de
-- Clavicón para cada una de las empresas; puedes hacer un módulo completo").
-- Se reutilizan `cotizaciones_produccion` / `_lineas` (folio COT-<empresa>,
-- precio s/IVA, costo congelado para el margen interno): ahora cotiza
-- cualquier empresa del alcance.
--
-- - `auth_opera_cotizador()`: producción, admin, corporativo, dirección,
--   empresa, quienes capturan órdenes (almacén / permiso compras) o permiso
--   por persona 'cotizador'.
-- - Clientes compartidos: quien cotiza ve los clientes de TODAS las empresas
--   de su organización y da de alta / corrige clientes (antes dirección no
--   podía darlos de alta).
-- - `proveedores.domicilio` para la OC impresa.
-- Ya aplicado en producción.

create or replace function public.auth_opera_cotizador()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and not p.espectador
       and (p.rol in ('produccion', 'admin', 'corporativo', 'direccion', 'empresa', 'almacen')
            or exists (select 1 from public.permisos_modulo m where m.profile_id = p.id and m.modulo in ('compras', 'cotizador'))))
$$;
grant execute on function public.auth_opera_cotizador() to authenticated;

alter table public.permisos_modulo drop constraint if exists permisos_modulo_modulo_check;
alter table public.permisos_modulo add constraint permisos_modulo_modulo_check check (modulo = any (array[
  'inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva', 'comedor', 'legal',
  'checador', 'contabilidad', 'tesoreria', 'punto_venta', 'compras', 'cotizador']));

drop policy if exists cotizaciones_produccion_planta on public.cotizaciones_produccion;
create policy cotizaciones_produccion_planta on public.cotizaciones_produccion for all to authenticated
  using ((select public.auth_opera_cotizador()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
  with check ((select public.auth_opera_cotizador()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists director_general on public.cotizaciones_produccion;
create policy director_general on public.cotizaciones_produccion for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
drop policy if exists director_general on public.cotizaciones_produccion_lineas;
create policy director_general on public.cotizaciones_produccion_lineas for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));

drop policy if exists clientes_cotizador_select on public.clientes;
create policy clientes_cotizador_select on public.clientes for select
  using ((select public.auth_opera_cotizador()));
drop policy if exists clientes_cotizador_insert on public.clientes;
create policy clientes_cotizador_insert on public.clientes for insert
  with check ((select public.auth_opera_cotizador()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists clientes_cotizador_update on public.clientes;
create policy clientes_cotizador_update on public.clientes for update
  using ((select public.auth_opera_cotizador()) and empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check ((select public.auth_opera_cotizador()) and empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));

alter table public.proveedores add column if not exists domicilio text;
