-- profiles sólo es legible por su dueño (o admin), así que un supervisor que
-- baja su PDF no podría leer el nombre de quien firmó arriba de él. Se resuelve
-- por dos vías distintas a propósito:
--
--  1. La firma se congela en la bitácora al momento de firmar. Es lo correcto
--     documentalmente: si Alma cambia de apellido o se va, el PDF de 2026 debe
--     seguir diciendo quién firmó ese día.
--  2. Para la pantalla (listas, "elaborado por") se expone un directorio mínimo
--     -- nombre y rol, nada más -- porque eso sí debe reflejar el presente.

alter table pu_aprobaciones add column actor_nombre text;

comment on column pu_aprobaciones.actor_nombre is
  'Nombre de quien firmó, congelado al momento de la firma. No se actualiza si el perfil cambia: el documento debe conservar quién firmó ese día.';

create or replace function registrar_aprobacion_pu() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  insert into pu_aprobaciones (
    analisis_id, estado_anterior, estado_nuevo, actor_id, actor_rol, actor_nombre, comentario
  )
  values (
    new.id, old.estado, new.estado, v_uid, auth_rol(),
    (select p.nombre from profiles p where p.id = v_uid),
    new.comentario_revision
  );

  update pu_analisis set comentario_revision = null where id = new.id;
  return null;
end;
$$;

revoke execute on function registrar_aprobacion_pu() from anon, authenticated;

-- Directorio mínimo del grupo. Corre como definer para saltar el RLS de
-- profiles, pero sólo devuelve nombre y rol -- nunca empresa ni nada que
-- permita inferir estructura financiera -- y se cierra a quien ya tiene rol.
create view v_directorio with (security_invoker = false) as
select p.id, p.nombre, p.rol, p.activo
from profiles p
where (select auth_rol()) is not null
  and (select auth_rol()) <> 'pendiente';

comment on view v_directorio is
  'Nombre y rol de los usuarios del grupo, para poblar listas y etiquetas de "elaboró". Deliberadamente NO expone empresa_id: quién es quién es información de operación, a qué empresa pertenece no lo es.';

grant select on v_directorio to authenticated;

create or replace view v_pu_analisis_costeo with (security_invoker = true) as
select
  a.id as analisis_id,
  a.empresa_id,
  e.codigo as empresa_codigo,
  e.nombre as empresa_nombre,
  a.proyecto_id,
  py.nombre as proyecto_nombre,
  a.codigo,
  a.concepto,
  a.unidad,
  a.es_auxiliar,
  a.estado,
  a.creado_por,
  dir.nombre as creado_por_nombre,
  f.nombre as factor_nombre,
  fx.indirectos_pct,
  fx.financiamiento_pct,
  fx.utilidad_pct,
  fx.cargos_adicionales_pct,
  d.costo_directo,
  t.importe_material,
  t.importe_mano_obra,
  t.importe_equipo,
  round(d.costo_directo * fx.indirectos_pct, 2) as importe_indirectos,
  round(b.base_financiamiento * fx.financiamiento_pct, 2) as importe_financiamiento,
  round(b.base_utilidad * fx.utilidad_pct, 2) as importe_utilidad,
  round(b.base_cargos * fx.cargos_adicionales_pct, 2) as importe_cargos_adicionales,
  round(b.base_cargos * (1 + fx.cargos_adicionales_pct), 2) as precio_unitario,
  t.insumos_sin_precio,
  a.updated_at
from pu_analisis a
join empresas e on e.id = a.empresa_id
left join proyectos py on py.id = a.proyecto_id
left join v_directorio dir on dir.id = a.creado_por
left join pu_factores f on f.id = a.factor_id
cross join lateral (select fn_pu_costo_directo(a.id) as costo_directo) d
cross join lateral (
  select
    case when a.es_auxiliar then 0 else coalesce(f.indirectos_pct, 0) end as indirectos_pct,
    case when a.es_auxiliar then 0 else coalesce(f.financiamiento_pct, 0) end as financiamiento_pct,
    case when a.es_auxiliar then 0 else coalesce(f.utilidad_pct, 0) end as utilidad_pct,
    case when a.es_auxiliar then 0 else coalesce(f.cargos_adicionales_pct, 0) end as cargos_adicionales_pct
) fx
cross join lateral (
  select
    d.costo_directo * (1 + fx.indirectos_pct) as base_financiamiento,
    d.costo_directo * (1 + fx.indirectos_pct) * (1 + fx.financiamiento_pct) as base_utilidad,
    d.costo_directo * (1 + fx.indirectos_pct) * (1 + fx.financiamiento_pct) * (1 + fx.utilidad_pct) as base_cargos
) b
left join lateral (
  select
    coalesce(sum(x.importe) filter (where x.tipo = 'material'), 0) as importe_material,
    coalesce(sum(x.importe) filter (where x.tipo = 'mano_obra'), 0) as importe_mano_obra,
    coalesce(sum(x.importe) filter (where x.tipo in ('herramienta', 'equipo')), 0) as importe_equipo,
    count(*) filter (where x.costo_unitario = 0) as insumos_sin_precio
  from fn_pu_explosion_insumos(a.id) x
) t on true;

-- El supervisor tiene que poder dar de alta el material que le falta en
-- catálogo: si no, se atora en obra esperando a que alguien más lo capture.
-- Sólo alta -- editar y desactivar el catálogo sigue siendo de dirección.
create policy pu_insumos_alta_supervisor on pu_insumos
  for insert with check (auth_rol() = 'responsable');