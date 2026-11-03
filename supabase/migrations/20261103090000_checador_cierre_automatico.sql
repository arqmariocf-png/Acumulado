-- Cierre automático de la jornada (3-nov-2026, Mario: "en tema de checador,
-- pongamos como regla 11:59 de la noche: si no checaron salida se cierra en
-- automático la jornada regular para no alargar horas inciertas").
--
-- Regla: a las 23:59 (hora de México) a quien tenga entrada del día y no
-- haya marcado salida se le registra una SALIDA automática a la hora en que
-- terminaba su jornada regular: última entrada + horas diarias de su perfil
-- de jornada (horas_semana ÷ dias_semana; sin perfil, el perfil base: 48 h
-- en 6 días = 8 h) + el tiempo de comida que marcó (si salió a comer y no
-- regresó, también se cierra la comida 1 h después, automática), sin pasar
-- de las 23:59 de ese día. Queda señalada (`automatica = true`, nota) para
-- que RH la distinga; si después llega la salida real de ese día (offline
-- o manual de RH), el trigger anula la automática.
-- Ya aplicado en producción.

alter table public.checador_registros add column if not exists automatica boolean not null default false;

-- Cierra las jornadas abiertas de un día (hora de México). Devuelve cuántas
-- salidas automáticas registró. La llama pg_cron sin usuario; con sesión solo
-- RH o admin (por si hay que correrlo a mano para un día).
create or replace function public.fn_checador_cerrar_jornadas(p_dia date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_dia date := coalesce(p_dia, ((now() at time zone 'America/Mexico_City') - interval '30 minutes')::date);
  v_ini timestamptz := (v_dia::timestamp at time zone 'America/Mexico_City');
  v_fin timestamptz := ((v_dia + 1)::timestamp at time zone 'America/Mexico_City');
  v_tope timestamptz := ((v_dia::timestamp + interval '23 hours 59 minutes') at time zone 'America/Mexico_City');
  v_base_horas numeric;
  r record;
  v_horas numeric;
  v_comida interval;
  v_comida_fin timestamptz;
  v_salida timestamptz;
  n integer := 0;
begin
  if auth.uid() is not null and public.auth_rol() not in ('admin', 'rh') then
    raise exception 'Solo RH o admin cierran jornadas a mano' using errcode = '42501';
  end if;
  if v_tope > now() then
    raise exception 'El día % todavía no termina (hora de México)', v_dia;
  end if;

  select pj.horas_semana / pj.dias_semana into v_base_horas from public.perfiles_jornada pj where pj.es_base limit 1;
  v_base_horas := coalesce(v_base_horas, 8);

  for r in
    select m.profile_id,
      max(m.created_at) filter (where m.tipo = 'entrada') as ultima_entrada,
      min(m.created_at) filter (where m.tipo = 'comida_inicio') as comida_inicio,
      max(m.created_at) filter (where m.tipo = 'comida_fin') as comida_fin,
      (array_agg(m.tipo order by m.created_at desc))[1] as ultimo_tipo,
      (select pj.horas_semana / pj.dias_semana
         from public.personal pe join public.perfiles_jornada pj on pj.id = pe.perfil_jornada_id
        where pe.profile_id = m.profile_id and pe.activo
        order by pe.created_at desc limit 1) as horas_dia
    from public.checador_registros m
    where m.anulada_en is null
      and m.created_at >= v_ini and m.created_at < v_fin
    group by m.profile_id
    having bool_or(m.tipo = 'entrada')
  loop
    if r.ultimo_tipo = 'salida' then continue; end if;
    v_horas := coalesce(r.horas_dia, v_base_horas);
    v_comida := interval '0';
    if r.ultimo_tipo = 'comida_inicio' then
      -- Salió a comer y no regresó: se cierra la comida 1 h después.
      v_comida_fin := least(r.comida_inicio + interval '1 hour', v_tope);
      insert into public.checador_registros (profile_id, tipo, created_at, marcada_en, automatica, ajustada_en, ajuste_nota)
      values (r.profile_id, 'comida_fin', v_comida_fin, v_comida_fin, true, now(),
              'Cierre automático a las 23:59: salió a comer y no marcó el regreso; se cerró 1 h después.');
      v_comida := v_comida_fin - r.comida_inicio;
    elsif r.comida_inicio is not null and r.comida_fin is not null and r.comida_fin > r.comida_inicio then
      v_comida := r.comida_fin - r.comida_inicio;
    end if;
    v_salida := least(r.ultima_entrada + (v_horas * interval '1 hour') + v_comida, v_tope);
    v_salida := greatest(v_salida, r.ultima_entrada + interval '1 minute');
    insert into public.checador_registros (profile_id, tipo, created_at, marcada_en, automatica, ajustada_en, ajuste_nota)
    values (r.profile_id, 'salida', v_salida, v_salida, true, now(),
            format('Cierre automático a las 23:59: no marcó salida; se cerró la jornada regular de %s h (entrada %s%s).',
                   rtrim(rtrim(to_char(v_horas, 'FM999.99'), '0'), '.'),
                   to_char(r.ultima_entrada at time zone 'America/Mexico_City', 'HH24:MI'),
                   case when v_comida > interval '0' then ' + ' || trim(to_char(extract(epoch from v_comida) / 60, 'FM9999')) || ' min de comida' else '' end));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.fn_checador_cerrar_jornadas(date) from public;
grant execute on function public.fn_checador_cerrar_jornadas(date) to authenticated, service_role;

-- Si después llega la marca real (offline sincronizada o manual de RH) del
-- mismo tipo y día, la automática se anula para no dejar dos salidas.
create or replace function public.checador_registros_anula_automatica()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.automatica or new.tipo not in ('salida', 'comida_fin') then return new; end if;
  update public.checador_registros a
     set anulada_en = now(), anulada_nota = 'Se anuló el cierre automático: llegó la marca real de las '
         || to_char(new.created_at at time zone 'America/Mexico_City', 'HH24:MI') || '.'
   where a.profile_id = new.profile_id and a.tipo = new.tipo and a.automatica and a.anulada_en is null
     and a.id <> new.id
     and (a.created_at at time zone 'America/Mexico_City')::date = (new.created_at at time zone 'America/Mexico_City')::date;
  return new;
end;
$$;
drop trigger if exists checador_registros_anula_automatica on public.checador_registros;
create trigger checador_registros_anula_automatica
  after insert on public.checador_registros
  for each row execute function public.checador_registros_anula_automatica();

-- La vista de RH trae la marca.
create or replace view public.v_checador_marcas with (security_invoker = false) as
select r.id, r.profile_id, coalesce(pe.nombre, p.nombre) as nombre, r.tipo, r.created_at, r.lat, r.lng, r.precision_m,
  r.foto_path is not null as tiene_foto, r.dispositivo,
  r.ubicacion_id, u.nombre as ubicacion_nombre, u.tipo as ubicacion_tipo,
  r.marcada_en, r.sincronizada_offline, r.manual,
  r.hora_original, r.ajustada_en, r.ajuste_nota, pa.nombre as ajustada_por_nombre,
  r.anulada_en is not null as anulada, r.anulada_nota,
  r.automatica
from public.checador_registros r
join public.profiles p on p.id = r.profile_id
left join public.personal pe on pe.profile_id = r.profile_id
left join public.checador_ubicaciones u on u.id = r.ubicacion_id
left join public.profiles pa on pa.id = r.ajustada_por
where public.auth_ve_checador_de(r.profile_id);

-- 23:59 de México = 05:59 UTC (México ya no cambia de horario). Cierra el
-- día que termina y repasa el anterior por si una corrida no alcanzó.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'checador-cierre-jornadas';
    perform cron.schedule('checador-cierre-jornadas', '59 5 * * *',
      $c$select public.fn_checador_cerrar_jornadas(((now() at time zone 'America/Mexico_City') - interval '30 minutes')::date - 1),
                public.fn_checador_cerrar_jornadas();$c$);
  end if;
end $$;
