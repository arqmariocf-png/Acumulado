-- Obras privadas visibles para sus encargados (27-nov-2026, Mario: "a
-- Jonathan da la opción de hacer requisiciones de todos los proyectos de VWM
-- y Audi"). Seis obras de VWM son privadas de Mario (`proyectos.privado` con
-- `propietario_id`): la restrictiva `proyecto_privado` solo dejaba verlas al
-- dueño, así que asignar a Jonathan como encargado no bastaba (la validación
-- de la requisición, que corre con su RLS, no encontraba la obra). Ahora una
-- obra privada la ve también quien está en `proyecto_encargados` de esa obra;
-- para los demás sigue oculta.
--
-- La parte 0 deja en el repo lo que ya existía en producción y ninguna
-- migración creaba (obras privadas, ~9-nov-2026): columnas, función y las
-- restrictivas `proyecto_privado` en las tablas de la obra. Es idempotente:
-- en producción no cambia nada; desde cero lo crea.
--
-- Ya aplicado en producción (proyecto_privado_ve_encargado y
-- proyecto_privado_ve_encargado_2_accesible).

-- 0. Base de obras privadas (estaba solo en producción) ---------------------
alter table public.proyectos
  add column if not exists privado boolean not null default false,
  add column if not exists propietario_id uuid references auth.users(id);

-- 1. Quién es encargado de qué obra (una vez por consulta en la policy) ------
create or replace function public.auth_proyectos_encargado()
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(pe.proyecto_id), '{}'::uuid[])
  from public.proyecto_encargados pe
  where pe.profile_id = auth.uid();
$$;

revoke all on function public.auth_proyectos_encargado() from public, anon;
grant execute on function public.auth_proyectos_encargado() to authenticated;

-- 2. Las tablas de la obra: una obra privada la ven su dueño y sus encargados.
-- El costeo del director general sigue siendo solo de admin por sus propias
-- policies.
create or replace function public.auth_proyecto_accesible(p_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_id is null or not exists (
    select 1 from public.proyectos
    where id = p_id and privado and propietario_id is distinct from auth.uid()
      and not exists (
        select 1 from public.proyecto_encargados pe
        where pe.proyecto_id = p_id and pe.profile_id = auth.uid()));
$$;

do $$
declare
  t text;
  tablas text[] := array[
    'comprobaciones_gasto', 'cxc_documentos', 'epp_asignaciones', 'epp_solicitudes',
    'herramienta_movimientos', 'herramienta_solicitudes', 'herramientas',
    'obra_presupuesto', 'ordenes_produccion', 'proyecto_bitacora_ia',
    'proyecto_controles', 'proyecto_costeo', 'proyecto_costeo_directos',
    'proyecto_costeo_imss', 'proyecto_planos', 'proyecto_presupuesto_cliente',
    'pu_analisis', 'remisiones_produccion', 'requisiciones', 'tableros'];
begin
  foreach t in array tablas loop
    if to_regclass('public.' || t) is not null
       and not exists (select 1 from pg_policies
                       where schemaname = 'public' and tablename = t and policyname = 'proyecto_privado') then
      execute format(
        'create policy proyecto_privado on public.%I as restrictive for all to public
           using (public.auth_proyecto_accesible(proyecto_id))
           with check (public.auth_proyecto_accesible(proyecto_id))', t);
    end if;
  end loop;

  -- 3. La obra misma.
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'proyectos' and policyname = 'proyecto_privado') then
    create policy proyecto_privado on public.proyectos as restrictive for all to public
      using ((not privado) or (propietario_id = (select auth.uid()))
             or (id = any ((select public.auth_proyectos_encargado())::uuid[])))
      with check ((not privado) or (propietario_id = (select auth.uid()))
             or (id = any ((select public.auth_proyectos_encargado())::uuid[])));
  else
    alter policy proyecto_privado on public.proyectos
      using ((not privado) or (propietario_id = (select auth.uid()))
             or (id = any ((select public.auth_proyectos_encargado())::uuid[])))
      with check ((not privado) or (propietario_id = (select auth.uid()))
             or (id = any ((select public.auth_proyectos_encargado())::uuid[])));
  end if;
end $$;
