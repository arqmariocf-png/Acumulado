-- ── Solo consulta: espectadores y organizaciones que no han pagado ──────
--
-- Mario (29-sep-2026, al dar de alta Estudio K): "los que no han pagado no
-- pueden manipular nada; genera un rol únicamente de espectador".
--
-- Hasta aquí "sin pago = solo lectura" dependía de que cada policy de
-- escritura llamara a auth_suscripcion_permite_escribir(), y 66 de las 99
-- tablas no lo hacían (checador, tareas, requisiciones, producción, PU,
-- pagos programados, profiles…). Igual que con la frontera de organización,
-- no se reescriben esas policies: se pone UN candado que se evalúa en todas
-- las tablas y que ninguna policy futura puede abrir.
--
-- Por qué trigger y no policy restrictiva: las funciones SECURITY DEFINER
-- (fn_oc_desde_lineas, fn_requisicion_etapa, fn_pu_*…) se saltan RLS, pero
-- no se saltan triggers, y auth.uid() sigue siendo quien llamó. Es a nivel
-- sentencia (FOR EACH STATEMENT): una sola consulta por INSERT/UPDATE/DELETE,
-- no una por renglón, así que una carga de miles de movimientos no paga nada.
--
-- Quién queda en solo consulta (auth_solo_consulta):
--   - un perfil marcado `espectador` (ve lo que su rol ve, no toca nada); o
--   - cualquiera de una organización cuya suscripción no permite escribir
--     (sin suscripción = no contratada, igual que suscripcion_permite_escribir).
-- Nunca el admin de la organización maestra, ni procesos sin usuario
-- (pg_cron, edge functions con la service_role: esas se cuidan en su código,
-- ver _shared/supabase-clients.ts).
--
-- "Espectador" es una marca sobre el perfil y no un valor más de app_rol a
-- propósito: con un rol nuevo, las ~370 policies de lectura que piden roles
-- concretos le mostrarían pantallas vacías. Con la marca, un admin de su
-- organización puesto como espectador ve todo lo de su organización y no
-- puede cambiar nada.

alter table public.profiles add column espectador boolean not null default false;

comment on column public.profiles.espectador is
  'Solo consulta: ve lo que su rol permite pero no captura, edita ni borra nada (trigger bloquear_solo_consulta en todas las tablas).';

create or replace function public.auth_solo_consulta()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth.uid() is not null
     and not public.auth_admin_global()
     and (
       coalesce((select p.espectador from public.profiles p where p.id = auth.uid()), false)
       or not public.suscripcion_permite_escribir(public.auth_grupo_id())
     )
$$;

comment on function public.auth_solo_consulta() is
  'true si quien llama no puede modificar nada: perfil espectador, u organización sin suscripción que permita escribir. La maestra nunca.';

create or replace function public.bloquear_solo_consulta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.auth_solo_consulta() then
    raise exception 'Cuenta de solo consulta: puedes ver la información, pero no capturar, editar ni borrar.'
      using errcode = '42501';
  end if;
  return null;
end
$$;

-- Todas las tablas de public, salvo las que no son "manipular datos":
-- push_subscripciones es el registro del navegador para recibir avisos.
do $$
declare
  t record;
  n integer := 0;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relispartition
      and c.relname not in ('push_subscripciones')
  loop
    execute format('drop trigger if exists solo_consulta on public.%I', t.relname);
    execute format(
      'create trigger solo_consulta before insert or update or delete on public.%I
         for each statement execute function public.bloquear_solo_consulta()',
      t.relname);
    n := n + 1;
  end loop;
  raise notice 'solo consulta: candado en % tablas', n;
end
$$;

-- Archivos subidos directo desde el navegador (logotipo de la organización).
-- Los demás buckets se escriben por edge function con la service_role.
create policy solo_consulta_insert on storage.objects as restrictive for insert
  to authenticated with check (not (select public.auth_solo_consulta()));
create policy solo_consulta_update on storage.objects as restrictive for update
  to authenticated using (not (select public.auth_solo_consulta()));
create policy solo_consulta_delete on storage.objects as restrictive for delete
  to authenticated using (not (select public.auth_solo_consulta()));

-- Quitarle la marca de espectador a alguien es darle permiso de escribir:
-- solo lo hace el admin de la organización maestra (el admin de un cliente
-- no se la puede quitar a su gente ni a sí mismo).
create or replace function public.profiles_guarda_espectador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.espectador is distinct from old.espectador
     and auth.uid() is not null
     and not public.auth_admin_global() then
    raise exception 'Solo el administrador de la plataforma cambia quién es espectador.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger profiles_guarda_espectador before update of espectador on public.profiles
  for each row execute function public.profiles_guarda_espectador();
