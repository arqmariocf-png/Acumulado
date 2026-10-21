-- Tablero de seguimiento únicamente para obras activas (21-oct-2026, Mario:
-- "únicamente obras activas"). El tablero sigue al estado de la obra:
--   * fn_proyecto_asegurar_tablero no crea tablero a una obra desactivada;
--   * al desactivar una obra se archivan sus tableros (salen de las listas de
--     tareas; tarjetas e historial se conservan);
--   * al reactivarla se desarchivan y, si nunca tuvo, se le crea.
-- Al aplicarla no había ninguna obra desactivada (las 144 estaban activas).
-- Ya aplicado en producción (tablero_solo_obras_activas).

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
  if v_obra.id is null or v_obra.empresa_id is null or not v_obra.activo then
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

create or replace function public.proyectos_tablero_sigue_activo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.activo is distinct from old.activo then
    update public.tableros set archivado = not new.activo
     where proyecto_id = new.id and archivado = new.activo;
    if new.activo then
      perform public.fn_proyecto_asegurar_tablero(new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists proyectos_tablero_sigue_activo on public.proyectos;
create trigger proyectos_tablero_sigue_activo
  after update of activo on public.proyectos
  for each row execute function public.proyectos_tablero_sigue_activo();
