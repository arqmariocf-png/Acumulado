-- Tareas: lo de fondo solo lo cambia quien asignó la tarea y "eliminar" ya
-- no borra (Mario, 6-oct-2026: "deja una opción de ver las tareas
-- eliminadas o archivadas, y solamente quien la asigna la puede modificar o
-- archivar de fondo; los archivos y notas sí son modificables por todos").
--
-- De fondo = título, responsable principal, supervisor, corresponsables,
-- tablero, archivar y eliminar: solo quien la creó (creado_por) o un admin.
-- Cualquiera que vea la tarjeta sigue pudiendo moverla de columna (avance),
-- editar la descripción, subir archivos y comentar. La fecha compromiso
-- sigue con su propia regla (tarjetas_fecha_guard).
-- Eliminar = archivada + eliminada_en/_por: se puede ver y restaurar desde
-- el tablero ("Ver archivadas y eliminadas").
--
-- Ya aplicado en producción.

alter table public.tarjetas add column if not exists eliminada_en timestamptz;
alter table public.tarjetas add column if not exists eliminada_por uuid references public.profiles(id);
create index if not exists tarjetas_eliminada_por_idx on public.tarjetas (eliminada_por);

create or replace function public.tarjetas_guarda_fondo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.eliminada_en is not null and old.eliminada_en is null then
    new.archivada := true;
    new.eliminada_por := coalesce(v_uid, new.eliminada_por);
  elsif new.eliminada_en is null and old.eliminada_en is not null then
    new.eliminada_por := null;
  end if;
  -- Procesos sin usuario (cron), quien la asignó y el admin: todo.
  if v_uid is null or v_uid = old.creado_por or public.auth_rol() = 'admin' then
    return new;
  end if;
  if new.titulo is distinct from old.titulo
     or new.asignado_a is distinct from old.asignado_a
     or new.supervisor_id is distinct from old.supervisor_id
     or new.corresponsables is distinct from old.corresponsables
     or new.tablero_id is distinct from old.tablero_id
     or new.archivada is distinct from old.archivada
     or new.eliminada_en is distinct from old.eliminada_en then
    raise exception 'Solo quien asignó la tarea (%) puede cambiar el título o los responsables, archivarla o eliminarla. La descripción, los archivos y los comentarios sí los puede cambiar cualquiera.',
      coalesce((select nombre from public.profiles where id = old.creado_por), 'quien la creó')
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tarjetas_guarda_fondo on public.tarjetas;
create trigger tarjetas_guarda_fondo before update on public.tarjetas
  for each row execute function public.tarjetas_guarda_fondo();
