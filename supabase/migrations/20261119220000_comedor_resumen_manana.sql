-- Resumen de las comidas de mañana (19-nov-2026, Mario: "para revisar las
-- comidas de mañana"): todos los días a las 18:00 MX (00:00 UTC) un push a
-- `comedor_config.aviso_pedidos_a` con cuántos se anotaron para mañana y qué
-- platillos (los pedidos vivos: 'pedido' o 'entregado'); la liga abre
-- Comedor › Cocina en el día de mañana (`/comedor?tab=cocina&fecha=…`).
-- `fn_comedor_resumen_manana()` corre sin usuario (pg_cron) y por
-- organización con config; también la puede llamar un admin para probar.
-- Ya aplicada en producción como `comedor_resumen_manana`.

create or replace function public.fn_comedor_resumen_manana()
returns integer language plpgsql security definer set search_path = public as $$
declare
  c record;
  v_manana date := (now() at time zone 'America/Mexico_City')::date + 1;
  v_n integer;
  v_platillos text;
  v_cuerpo text;
  v_enviados integer := 0;
begin
  if auth.uid() is not null and not public.auth_admin_global() then
    raise exception 'Solo procesos o el administrador.' using errcode = '42501';
  end if;
  for c in select cf.grupo_id, cf.aviso_pedidos_a from public.comedor_config cf where coalesce(array_length(cf.aviso_pedidos_a, 1), 0) > 0 loop
    select count(*) into v_n
      from public.comedor_pedidos p join public.empresas e on e.id = p.empresa_id
     where e.grupo_id = c.grupo_id and p.fecha = v_manana and p.estado in ('pedido', 'entregado');
    select string_agg(x.n || ' × ' || x.nombre, ', ' order by x.n desc, x.nombre) into v_platillos
      from (select l.nombre, sum(l.cantidad) n
              from public.comedor_pedido_lineas l
              join public.comedor_pedidos p on p.id = l.pedido_id
              join public.empresas e on e.id = p.empresa_id
             where e.grupo_id = c.grupo_id and p.fecha = v_manana and p.estado in ('pedido', 'entregado')
             group by l.nombre) x;
    if v_n = 0 then
      v_cuerpo := 'Nadie se ha anotado todavía para mañana ' || to_char(v_manana, 'DD/MM') || '.';
    else
      v_cuerpo := v_n || ' persona(s) para mañana ' || to_char(v_manana, 'DD/MM') || ': ' || coalesce(v_platillos, 'sin platillos') || '.';
    end if;
    perform public.fn_push_aviso(c.aviso_pedidos_a, 'Comidas de mañana', v_cuerpo, '/comedor?tab=cocina&fecha=' || to_char(v_manana, 'YYYY-MM-DD'));
    v_enviados := v_enviados + 1;
  end loop;
  return v_enviados;
end $$;
revoke all on function public.fn_comedor_resumen_manana() from public, anon;
grant execute on function public.fn_comedor_resumen_manana() to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'comedor-resumen-manana') then
      perform cron.unschedule('comedor-resumen-manana');
    end if;
    -- 00:00 UTC = 18:00 en México (UTC-6 fijo).
    perform cron.schedule('comedor-resumen-manana', '0 0 * * *', 'select public.fn_comedor_resumen_manana();');
  end if;
end $$;
