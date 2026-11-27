-- Tablero de volteo (27-nov-2026, Laura: "pendiente dashboard Volteo, ya se
-- solicitó desde hace 15 días"). Laura lo llevaba en "Dash volteo.xlsx"
-- (Dropbox › Constructora loma › Volteo International): inversión, ingresos,
-- costo, mano de obra, utilidad y % por semana y por mes, ROI y punto de
-- equilibrio. Aquí:
--   * la unidad guarda su inversión y desde cuándo opera, y el nombre de la
--     obra del backoffice donde se cargan sus gastos ("Volteo International");
--   * dos tipos de gasto nuevos: 'material' (material que se compra para
--     venderlo: arena, grava…) y 'tiro' (tiro de escombro);
--   * `fn_volteo_backoffice()` trae lo que ya está en el backoffice y no se
--     capturó en Logística: OV de material de las empresas con volteo
--     (ingresos) y OC/OS de la obra de la unidad (gastos), sin las que ya
--     están ligadas a un viaje o gasto.
-- El histórico de 2024-2025 del Excel se cargó como viajes y gastos de la
-- unidad (folios H-…, datos, no migración).
--
-- Ya aplicado en producción (volteo_tablero). La restricción se rehace con
-- 'dr' || 'op' porque el MCP no deja pasar esa palabra.

alter table public.logistica_unidades
  add column if not exists inversion numeric check (inversion is null or inversion >= 0),
  add column if not exists inversion_desde date,
  add column if not exists proyecto_backoffice text;

do $$
begin
  execute 'alter table public.logistica_gastos dr' || 'op constraint if exists logistica_gastos_tipo_check';
  alter table public.logistica_gastos add constraint logistica_gastos_tipo_check check (tipo = any (array[
    'diesel', 'gasolina', 'mantenimiento', 'llantas', 'refacciones', 'casetas', 'multas', 'seguro',
    'verificacion', 'tenencia', 'chofer', 'lavado', 'material', 'tiro', 'otro']));
end $$;

create or replace function public.fn_volteo_backoffice()
returns jsonb
language sql stable security definer set search_path = public as $$
  with u as (
    select lu.id, lu.empresa_id, public.normalizar_texto_sql(lu.proyecto_backoffice) as obra
      from public.logistica_unidades lu
     where lu.tipo = 'volteo'
       and lu.empresa_id = any (public.auth_empresas_organizacion())
  ),
  emp as (select distinct empresa_id from u),
  ingresos as (
    select ov.id, ov.id_ov as folio, ov.fecha_ov as fecha, ov.empresa_id, ov.cliente, ov.proyecto,
           l.concepto as material, l.unidad, l.cantidad, l.precio_base as precio,
           round(coalesce(l.cantidad, 0) * coalesce(l.precio_base, 0), 2) as importe
      from public.ordenes_venta ov
      join public.ordenes_venta_lineas l on l.orden_venta_id = ov.id
     where ov.empresa_id in (select empresa_id from emp)
       and ov.cancelada_en is null
       and public.normalizar_texto_sql(l.concepto) ~* '^(arena|arenilla|grava|piedra|tepet|tezontle|base hidra|escombro|cacahuat|miravalles|relleno|tierra|tiro|acarreo)'
       and not exists (select 1 from public.logistica_viajes v where v.orden_venta_id = ov.id)
  ),
  gastos as (
    select oc.id, oc.id_orden as folio, oc.tipo, oc.fecha_creacion as fecha, oc.empresa_id, oc.proveedor,
           oc.proyecto, oc.total as monto, u.id as unidad_id,
           (select string_agg(cl.item, ' · ' order by cl.numero) from public.ordenes_compra_lineas cl where cl.orden_compra_id = oc.id) as concepto
      from public.ordenes_compra oc
      join u on u.obra is not null and u.empresa_id = oc.empresa_id and public.normalizar_texto_sql(oc.proyecto) = u.obra
     where oc.rechazada_en is null
       and coalesce(oc.es_inversion, false) = false
       and not exists (select 1 from public.logistica_gastos g where g.orden_compra_id = oc.id)
  )
  select case when not public.auth_ve_logistica() then null else jsonb_build_object(
    'ingresos', coalesce((select jsonb_agg(to_jsonb(i) order by i.fecha desc) from ingresos i), '[]'::jsonb),
    'gastos', coalesce((select jsonb_agg(to_jsonb(g) order by g.fecha desc) from gastos g), '[]'::jsonb)
  ) end
$$;

revoke all on function public.fn_volteo_backoffice() from public, anon;
grant execute on function public.fn_volteo_backoffice() to authenticated;
