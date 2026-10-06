-- Actividades recurrentes y programadas desde los tableros (Mario, 6-oct-2026:
-- "dentro de las tareas y tableros poder dejar actividades recurrentes y
-- programaciones").
--
-- Frecuencias: 'semanal' (días de la semana ISO; los 7 = diaria), 'mensual'
-- (día del mes; si el mes es más corto, el último día) y 'unica' (una
-- fecha; después de crearse la tarjeta queda inactiva). Opcional
-- supervisor de la tarjeta. Las da de alta cualquiera que vea el tablero, a
-- su nombre; las cambia o borra quien la creó o un admin.
--
-- Ya aplicado en producción.

alter table public.actividades_recurrentes add column if not exists frecuencia text not null default 'semanal';
alter table public.actividades_recurrentes add column if not exists dia_mes int;
alter table public.actividades_recurrentes add column if not exists fecha_unica date;
alter table public.actividades_recurrentes add column if not exists supervisor_id uuid references public.profiles(id);
create index if not exists actividades_recurrentes_supervisor_idx on public.actividades_recurrentes (supervisor_id);

alter table public.actividades_recurrentes drop constraint if exists actividades_recurrentes_dias_semana_check;
alter table public.actividades_recurrentes drop constraint if exists actividades_recurrentes_frecuencia_check;
alter table public.actividades_recurrentes add constraint actividades_recurrentes_frecuencia_check check (
  (frecuencia = 'semanal' and dias_semana <@ array[1, 2, 3, 4, 5, 6, 7] and cardinality(dias_semana) > 0)
  or (frecuencia = 'mensual' and dia_mes is not null and dia_mes between 1 and 31)
  or (frecuencia = 'unica' and fecha_unica is not null));

-- Quien ve el tablero ve sus recurrentes; da de alta a su nombre; cambia o
-- borra quien la creó o un admin.
alter policy actividades_recurrentes_select on public.actividades_recurrentes
  using (asignado_a = (select auth.uid())
         or creado_por = (select auth.uid())
         or (select public.auth_rol_definer()) = any (array['admin', 'direccion', 'corporativo']::app_rol[])
         or exists (select 1 from public.tableros t where t.id = tablero_id));
alter policy actividades_recurrentes_write on public.actividades_recurrentes
  using ((select public.auth_rol_definer()) = 'admin'::app_rol or creado_por = (select auth.uid()))
  with check (((select public.auth_rol_definer()) = 'admin'::app_rol or creado_por = (select auth.uid()))
              and exists (select 1 from public.tableros t where t.id = tablero_id));

create or replace function public.fn_generar_actividades_recurrentes(p_fecha date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hoy date := coalesce(p_fecha, (now() at time zone 'America/Mexico_City')::date);
  v_ultimo int := extract(day from (date_trunc('month', v_hoy) + interval '1 month - 1 day'))::int;
  v_a public.actividades_recurrentes%rowtype;
  v_columna uuid;
  v_tarjeta uuid;
  v_n int := 0;
begin
  for v_a in
    select * from public.actividades_recurrentes a
    where a.activa
      and case a.frecuencia
            when 'semanal' then extract(isodow from v_hoy)::int = any (a.dias_semana)
            when 'mensual' then extract(day from v_hoy)::int = least(a.dia_mes, v_ultimo)
            when 'unica' then a.fecha_unica = v_hoy
            else false
          end
      and not exists (select 1 from public.actividades_recurrentes_generadas g where g.actividad_id = a.id and g.fecha = v_hoy)
  loop
    select c.id into v_columna from public.tablero_columnas c where c.tablero_id = v_a.tablero_id order by c.orden limit 1;
    if v_columna is null then continue; end if;
    insert into public.tarjetas (tablero_id, columna_id, titulo, descripcion, asignado_a, supervisor_id, creado_por, fecha_limite)
    values (v_a.tablero_id, v_columna,
            case when v_a.frecuencia = 'unica' then v_a.titulo else v_a.titulo || ' · ' || to_char(v_hoy, 'DD/MM') end,
            v_a.descripcion, v_a.asignado_a, v_a.supervisor_id, coalesce(v_a.creado_por, v_a.asignado_a), v_hoy)
    returning id into v_tarjeta;
    insert into public.actividades_recurrentes_generadas (actividad_id, fecha, tarjeta_id) values (v_a.id, v_hoy, v_tarjeta);
    if v_a.frecuencia = 'unica' then
      update public.actividades_recurrentes set activa = false where id = v_a.id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.fn_generar_actividades_recurrentes(date) from public, anon, authenticated;
