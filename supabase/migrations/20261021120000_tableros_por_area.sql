-- Tareas por área (21-oct-2026, Mario: "agrega una barra de tareas a cada
-- una de las áreas, va a ser más fácil llevar el control; incluso hay algunas
-- ya en 'Tareas' pero muévelas para que sea más fácil para las áreas llevar
-- el control en su propio menú").
--
--   * tableros.area: la clave de la sección del menú (lib/menu.ts) a la que
--     pertenece el tablero. No se mueven tarjetas ni cambian ids (las
--     actividades recurrentes y los cierres automáticos apuntan por id).
--   * fn_tablero_area(area): los tableros activos de esa área en la
--     organización de quien consulta; si no hay ninguno, crea
--     "<Área> · Actividades" (sin empresa, columnas Por hacer / En progreso /
--     Hecho, las mismas que crea la pantalla de Tareas) y lo devuelve.
--     Un tablero sin empresa es de la organización de quien lo creó.
--
-- Ya aplicado en producción (tableros_por_area).

alter table public.tableros add column if not exists area text;
create index if not exists tableros_area_idx on public.tableros (area) where area is not null;

-- Los que ya existían, a su área.
update public.tableros set area = 'rh' where id = '9677c2d6-b851-49d3-baa9-91b9defba9aa' and area is null;
update public.tableros set area = 'contabilidad'
 where id in ('6f360f9b-17d2-4326-9c0b-3c0305edc408', '63976dc9-0ae9-43d3-b20e-332187a5f13a') and area is null;
update public.tableros set area = 'mantenimiento' where id = 'c824a05c-05e3-4127-b20c-50ac40e9fee7' and area is null;
update public.tableros t set area = 'operacion'
 where t.area is null
   and (t.proyecto_id is not null
        or t.id = '579573e5-ba40-4f8f-a07a-e2c90e758c9e'
        or t.empresa_id in (select e.id from public.empresas e where e.codigo = 'ERG'));

create or replace function public.fn_tablero_area(p_area text)
returns table (id uuid, nombre text, empresa_id uuid, empresa_nombre text, proyecto_id uuid, creado boolean)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_area text := lower(btrim(coalesce(p_area, '')));
  v_nombre text;
  v_grupo uuid;
  v_empresas uuid[];
  v_id uuid;
begin
  v_nombre := case v_area
    when 'finanzas' then 'Finanzas'
    when 'contabilidad' then 'Contabilidad'
    when 'legal' then 'Legal'
    when 'rh' then 'Recursos humanos'
    when 'almacen' then 'Almacén'
    when 'compras' then 'Compras'
    when 'logistica' then 'Logística'
    when 'mantenimiento' then 'Mantenimiento'
    when 'operacion' then 'Operación'
  end;
  if v_nombre is null then
    raise exception 'Área desconocida: %', p_area;
  end if;
  if public.auth_rol()::text = 'pendiente' or public.auth_es_espectador() then
    raise exception 'Sin acceso a las tareas del área.' using errcode = '42501';
  end if;
  select p.grupo_id into v_grupo from public.profiles p where p.id = auth.uid();
  v_empresas := public.auth_empresas_organizacion();

  if not exists (
    select 1 from public.tableros t
     where t.area = v_area and not t.archivado
       and (t.empresa_id = any (v_empresas)
            or (t.empresa_id is null and exists (select 1 from public.profiles c where c.id = t.creado_por and c.grupo_id = v_grupo)))
  ) then
    insert into public.tableros (nombre, descripcion, empresa_id, creado_por, area)
    values (v_nombre || ' · Actividades', 'Tareas del área de ' || lower(v_nombre), null, auth.uid(), v_area)
    returning tableros.id into v_id;
    insert into public.tablero_columnas (tablero_id, nombre, orden)
    values (v_id, 'Por hacer', 0), (v_id, 'En progreso', 1), (v_id, 'Hecho', 2);
  end if;

  return query
    select t.id, t.nombre, t.empresa_id, e.nombre::text, t.proyecto_id, coalesce(t.id = v_id, false)
      from public.tableros t
      left join public.empresas e on e.id = t.empresa_id
     where t.area = v_area and not t.archivado
       and (t.empresa_id = any (v_empresas)
            or (t.empresa_id is null and exists (select 1 from public.profiles c where c.id = t.creado_por and c.grupo_id = v_grupo)))
     order by t.empresa_id is not null, t.nombre;
end;
$$;
revoke all on function public.fn_tablero_area(text) from public, anon;
grant execute on function public.fn_tablero_area(text) to authenticated;
