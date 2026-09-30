-- Director general (Mario, 30-sep-2026): "genera un rol de director general
-- ya que debo tener opción de editar absolutamente todo lo que hay en el
-- sistema". No es un valor nuevo de app_rol (371 policies y decenas de
-- funciones comparan roles): es el admin de la organización MAESTRA
-- (auth_admin_global), que ya cruza la frontera de organizaciones y nunca
-- cae en solo consulta. Aquí se le da lectura y escritura en TODAS las
-- tablas de public con RLS, con una policy permisiva "director_general"
-- (se suma con OR a las del módulo). Antes había tablas donde ni el admin
-- escribía (partidas de OC/OV, checador, bitácoras de requisiciones y
-- tarjetas, producción, comedor, precios unitarios…).
--
-- Fuera a propósito: config_sistema (secretos: nunca al navegador),
-- audit_log, eventos_pasarela (pasarela de pago) y push_subscripciones
-- (dispositivos de cada persona). Los triggers de integridad (no borrar lo
-- ya resuelto, no devolver más de lo entregado, etc.) siguen aplicando.
-- Toda tabla nueva la recibe al volver a correr fn_director_general_policies().
--
-- Ya aplicado en producción.

create or replace function public.fn_director_general_policies()
returns integer language plpgsql security definer set search_path = public as $$
declare
  t record;
  n integer := 0;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname not in ('config_sistema', 'audit_log', 'eventos_pasarela', 'push_subscripciones')
  loop
    execute format('drop policy if exists director_general on public.%I', t.relname);
    execute format($p$create policy director_general on public.%I for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()))$p$, t.relname);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t.relname);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.fn_director_general_policies() from public, anon, authenticated;

select public.fn_director_general_policies();
