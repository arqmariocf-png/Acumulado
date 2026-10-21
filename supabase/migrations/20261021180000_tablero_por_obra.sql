-- Cada obra con su tablero de seguimiento por default (21-oct-2026, Mario:
-- "a todas las obras ábrele el tablero por default"). Al 21-oct solo 8 de 144
-- obras activas tenían tablero; el resto mostraba "crear tablero" y solo los
-- encargados podían crearlo.
--
-- fn_proyecto_asegurar_tablero(obra): si la obra no tiene tablero, crea uno
-- con su nombre, la empresa de la obra, área 'operacion' y las columnas de
-- siempre (Por hacer / En progreso / Hecho). Quien lo crea: el usuario de la
-- sesión, si no el responsable de la obra, si no el admin de la organización
-- (lo que crea la sincronización del backoffice no tiene sesión).
-- Trigger después de dar de alta una obra y relleno de las que no tenían.
-- Ya aplicado en producción (tablero_por_obra).

create or replace function public.fn_proyecto_asegurar_tablero(p_proyecto uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obra public.proyectos;
  v_creador uuid;
  v_id uuid;
begin
  select * into v_obra from public.proyectos where id = p_proyecto;
  if v_obra.id is null or v_obra.empresa_id is null then
    return null;
  end if;
  select t.id into v_id from public.tableros t where t.proyecto_id = v_obra.id order by t.created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;
  v_creador := coalesce(
    auth.uid(),
    v_obra.responsable_id,
    (select p.id
       from public.profiles p
       join public.empresas e on e.grupo_id = p.grupo_id
      where e.id = v_obra.empresa_id and p.rol = 'admin' and p.activo
      order by p.created_at
      limit 1)
  );
  if v_creador is null then
    return null;
  end if;
  insert into public.tableros (nombre, empresa_id, proyecto_id, creado_por, area)
  values (v_obra.nombre, v_obra.empresa_id, v_obra.id, v_creador, 'operacion')
  returning id into v_id;
  insert into public.tablero_columnas (tablero_id, nombre, orden)
  values (v_id, 'Por hacer', 0), (v_id, 'En progreso', 1), (v_id, 'Hecho', 2);
  return v_id;
end;
$$;

revoke all on function public.fn_proyecto_asegurar_tablero(uuid) from public, anon, authenticated;

create or replace function public.proyectos_tablero_por_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_proyecto_asegurar_tablero(new.id);
  return new;
end;
$$;

drop trigger if exists proyectos_tablero_por_default on public.proyectos;
create trigger proyectos_tablero_por_default
  after insert on public.proyectos
  for each row execute function public.proyectos_tablero_por_default();

-- Relleno: las obras activas que no tenían tablero.
select public.fn_proyecto_asegurar_tablero(p.id)
  from public.proyectos p
 where p.activo
   and not exists (select 1 from public.tableros t where t.proyecto_id = p.id);
