-- Platillos fijos: siempre en el menú (20-nov-2026, Mario: "estos dos menús
-- estarán siempre" —Desayuno ejecutivo y Menú ejecutivo—). Un platillo con
-- `fijo = true` entra solo al menú de cada día: `fn_comedor_menu_fijo(dias)`
-- inserta en `comedor_menu` lo que falte desde hoy (hora de México) y los
-- siguientes `dias` (14 por defecto), sin cupo; pg_cron
-- `comedor-menu-fijo` lo corre todos los días a las 00:10 MX (06:10 UTC).
-- Cocina puede seguir quitando un platillo de un día en concreto (vuelve a
-- entrar al día siguiente si sigue fijo) y los no fijos se marcan a mano como
-- siempre. El trigger `comedor_platillos_fijo` llena el menú en cuanto se
-- marca un platillo como fijo, para no esperar al cron.
-- Ya aplicada en producción como `comedor_menu_fijo`.

alter table public.comedor_platillos add column if not exists fijo boolean not null default false;

create or replace function public.fn_comedor_menu_fijo(p_dias integer default 14)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_n integer;
begin
  if auth.uid() is not null and not (public.auth_admin_global() or public.auth_opera_comedor()) then
    raise exception 'Solo cocina, el administrador o los procesos.' using errcode = '42501';
  end if;
  if coalesce(p_dias, 0) < 1 or p_dias > 60 then raise exception 'Días entre 1 y 60.'; end if;
  insert into public.comedor_menu (empresa_id, fecha, platillo_id)
  select pl.empresa_id, d::date, pl.id
    from public.comedor_platillos pl
    cross join generate_series(v_hoy, v_hoy + (p_dias - 1), interval '1 day') d
   where pl.fijo and pl.activo
     and not exists (select 1 from public.comedor_menu m where m.platillo_id = pl.id and m.fecha = d::date);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.fn_comedor_menu_fijo(integer) from public, anon;
grant execute on function public.fn_comedor_menu_fijo(integer) to authenticated, service_role;

/** Al marcar un platillo como fijo (o reactivarlo siendo fijo) se llena el menú de una vez. */
create or replace function public.comedor_platillos_fijo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.fijo and new.activo and (tg_op = 'INSERT' or not old.fijo or not old.activo) then
    perform public.fn_comedor_menu_fijo(14);
  end if;
  return new;
end $$;
drop trigger if exists comedor_platillos_fijo on public.comedor_platillos;
create trigger comedor_platillos_fijo after insert or update of fijo, activo on public.comedor_platillos
  for each row execute function public.comedor_platillos_fijo();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'comedor-menu-fijo') then
      perform cron.unschedule('comedor-menu-fijo');
    end if;
    -- 06:10 UTC = 00:10 en México (UTC-6 fijo).
    perform cron.schedule('comedor-menu-fijo', '10 6 * * *', 'select public.fn_comedor_menu_fijo(14);');
  end if;
end $$;

-- Los dos platillos de Mario quedan fijos (el trigger llena el menú).
update public.comedor_platillos set fijo = true
 where activo and nombre in ('Desayuno ejecutivo', 'Menú ejecutivo')
   and empresa_id in (select e.id from public.empresas e join public.grupos g on g.id = e.grupo_id where g.codigo = 'LOMA');
