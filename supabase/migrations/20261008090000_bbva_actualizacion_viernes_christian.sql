-- Christian actualiza el sistema de BBVA Mantenimiento cada viernes (Mario,
-- 8-oct-2026: "Christian programa la actualización de sistema de BBVA
-- mantenimiento los viernes con notificación").
--
-- Actividad recurrente semanal (viernes) en el tablero "BBVA Mantenimiento ·
-- Actividades" (CSC): la tarjeta se crea a las 7:30 con fecha límite ese día
-- y el recordatorio de las 8:00 le llega al celular. Se cierra sola cuando
-- sube el concentrado (insert en bbva_mantenimiento_snapshots), como la de
-- Adquira de Belén. `cierre_evento` es columna aparte para no tocar el check
-- de `cierre_automatico`.
--
-- Ya aplicado en producción.

alter table public.actividades_recurrentes add column if not exists cierre_evento text check (cierre_evento in ('bbva_concentrado'));

create or replace function public.fn_cerrar_actividades_bbva_concentrado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tarjetas t
     set columna_id = (select c.id from public.tablero_columnas c where c.tablero_id = t.tablero_id order by c.orden desc limit 1)
    from public.actividades_recurrentes_generadas g
    join public.actividades_recurrentes a on a.id = g.actividad_id
   where g.tarjeta_id = t.id
     and a.cierre_evento = 'bbva_concentrado'
     and g.fecha >= (now() at time zone 'America/Mexico_City')::date - 6
     and t.columna_id <> (select c.id from public.tablero_columnas c where c.tablero_id = t.tablero_id order by c.orden desc limit 1);
  return null;
end;
$$;
revoke all on function public.fn_cerrar_actividades_bbva_concentrado() from public, anon, authenticated;
drop trigger if exists bbva_concentrado_cierra_actividad on public.bbva_mantenimiento_snapshots;
create trigger bbva_concentrado_cierra_actividad after insert on public.bbva_mantenimiento_snapshots
  for each statement execute function public.fn_cerrar_actividades_bbva_concentrado();

do $$
declare v_tablero uuid; v_mario uuid := 'e0268126-4fa1-4415-8553-b9cff72b1db7'; v_chr uuid := 'd82bc7a4-94cf-4797-aada-873434282e56'; v_csc uuid := '6f5a3ec0-8e10-4bcf-ba09-c38e12098bbf';
begin
  if not exists (select 1 from public.profiles where id = v_chr) or not exists (select 1 from public.empresas where id = v_csc) then return; end if;
  select id into v_tablero from public.tableros where nombre = 'BBVA Mantenimiento · Actividades' and empresa_id = v_csc;
  if v_tablero is null then
    insert into public.tableros (empresa_id, nombre, descripcion, creado_por)
    values (v_csc, 'BBVA Mantenimiento · Actividades', 'Actividades recurrentes del mantenimiento BBVA (Christian).', v_mario)
    returning id into v_tablero;
    insert into public.tablero_columnas (tablero_id, nombre, orden) values (v_tablero, 'Por hacer', 0), (v_tablero, 'En progreso', 1), (v_tablero, 'Hecho', 2);
  end if;
  if not exists (select 1 from public.actividades_recurrentes where tablero_id = v_tablero and cierre_evento = 'bbva_concentrado') then
    insert into public.actividades_recurrentes (empresa_id, tablero_id, titulo, descripcion, asignado_a, dias_semana, frecuencia, cierre_evento, creado_por)
    values (v_csc, v_tablero, 'Actualizar el sistema de BBVA Mantenimiento',
            'Cada viernes: sube el control/concentrado de folios en Mantenimiento → BBVA (/mantenimiento/bbva) con el corte de la semana. La tarjeta se cierra sola al subirlo.',
            v_chr, '{5}', 'semanal', 'bbva_concentrado', v_mario);
  end if;
end $$;
