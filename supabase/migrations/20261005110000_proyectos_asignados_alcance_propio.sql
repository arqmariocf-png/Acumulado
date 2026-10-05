-- Supervisores y roles básicos ven solo sus obras asignadas; excepción por
-- persona para manejar otra empresa (Mario, 5-oct-2026: "en las cuentas de
-- supervisores muéstrales únicamente sus proyectos asignados" y "asígnale el
-- acceso en exclusivo a Timo de las obras de Mario Contreras Farfán").
--
--   1. profiles.alcance_propio: la persona usa sus empresas de "Maneja
--      también" (profile_empresas) aunque su rol sea de una sola empresa
--      (roles_alcance.multiempresa = false). Solo la cambia un admin
--      (trigger, junto con todas_las_empresas, que antes cualquiera podía
--      prenderse a sí mismo por profiles_update_self).
--   2. Proyectos para roles básicos (operativo, administrativo, supervisor,
--      directivo): los que tienen como responsable o comprador, aquellos en
--      los que ya pidieron requisiciones (no pierden lo que están trabajando)
--      y, con alcance_propio, TODOS los de sus empresas de "Maneja también"
--      (Timoteo: CSC de principal, MCF asignada → ve las obras de MCF y en
--      CSC solo las suyas). Antes veían todo lo de su empresa (o todo el
--      grupo con todas_las_empresas).
--
-- Ya aplicado en producción.

alter table public.profiles add column if not exists alcance_propio boolean not null default false;

create or replace function public.profiles_guarda_alcance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.alcance_propio is distinct from old.alcance_propio
      or new.todas_las_empresas is distinct from old.todas_las_empresas)
     and auth.uid() is not null
     and public.auth_rol() <> 'admin' then
    raise exception 'Solo un administrador cambia las empresas que maneja una persona.'
      using errcode = '42501';
  end if;
  return new;
end
$$;
create or replace trigger profiles_guarda_alcance before update of alcance_propio, todas_las_empresas on public.profiles
  for each row execute function public.profiles_guarda_alcance();

-- Alcance: "Maneja también" cuenta si el rol es multiempresa O la persona
-- tiene alcance_propio. Mismo cuerpo que 20261002090000 con ese cambio.
create or replace function public.auth_empresas_alcance()
returns uuid[]
language sql
stable security definer
set search_path = public
as $$
  select coalesce(array_agg(e.id order by e.nombre), '{}'::uuid[])
  from public.profiles pr
  left join public.grupos g on g.id = pr.grupo_id
  left join public.roles_alcance ra on ra.rol = pr.rol
  join public.empresas e on (
    (pr.rol = 'admin' and coalesce(g.es_maestro, false))
    or (e.grupo_id = pr.grupo_id and (
          pr.rol = 'admin'
          or e.id = pr.empresa_id
          or (coalesce(ra.multiempresa, false) and pr.todas_las_empresas)
          or ((coalesce(ra.multiempresa, false) or pr.alcance_propio)
              and exists (select 1 from public.profile_empresas pe where pe.profile_id = pr.id and pe.empresa_id = e.id))))
  )
  where pr.id = auth.uid() and pr.rol <> 'pendiente' and not pr.espectador
$$;

create or replace function public.empresa_en_alcance(p_empresa_id uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    left join public.grupos g on g.id = pr.grupo_id
    left join public.roles_alcance ra on ra.rol = pr.rol
    join public.empresas e on e.id = p_empresa_id
    where pr.id = auth.uid()
      and pr.rol <> 'pendiente'
      and not pr.espectador
      and (
        (pr.rol = 'admin' and coalesce(g.es_maestro, false))
        or (e.grupo_id = pr.grupo_id and (
              pr.rol = 'admin'
              or e.id = pr.empresa_id
              or (coalesce(ra.multiempresa, false) and pr.todas_las_empresas)
              or ((coalesce(ra.multiempresa, false) or pr.alcance_propio)
                  and exists (select 1 from public.profile_empresas pe where pe.profile_id = pr.id and pe.empresa_id = e.id))
        ))
      )
  )
$$;

-- El selector de empresa del encabezado se muestra con 'multiempresa'.
create or replace function public.fn_mi_alcance()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'empresas', to_jsonb(public.auth_empresas_alcance()),
    'todas', public.auth_ve_todas_empresas(),
    'multiempresa', coalesce((select coalesce(ra.multiempresa, false) or pr.alcance_propio
                              from public.profiles pr left join public.roles_alcance ra on ra.rol = pr.rol
                              where pr.id = auth.uid()), false),
    'principal', public.auth_empresa_id()
  )
$$;

-- Proyectos que un rol básico ve además de los que tiene asignados.
-- Se usa como `id = any((select auth_proyectos_propios())::uuid[])`: una vez
-- por consulta, sin leer requisiciones desde la policy (evita recursión).
create or replace function public.auth_proyectos_propios()
returns uuid[]
language sql
stable security definer
set search_path = public
as $$
  select coalesce(array_agg(x.id), '{}'::uuid[])
  from public.proyectos x
  join public.profiles pr on pr.id = auth.uid()
  where not pr.espectador and pr.rol <> 'pendiente'
    and (exists (select 1 from public.requisiciones r where r.proyecto_id = x.id and r.solicitado_por = pr.id)
         or (pr.alcance_propio
             and exists (select 1 from public.profile_empresas pe where pe.profile_id = pr.id and pe.empresa_id = x.empresa_id)))
$$;
revoke all on function public.auth_proyectos_propios() from public, anon;
grant execute on function public.auth_proyectos_propios() to authenticated;

drop policy if exists proyectos_select on public.proyectos;
create policy proyectos_select on public.proyectos for select to authenticated
  using (
    (select public.auth_rol_definer()) <> 'pendiente'
    and ((select public.auth_admin_global_definer()) or 'proyectos' = any ((select public.auth_modulos_habilitados())::text[]))
    and (
      (not ((select public.auth_rol_definer()) = any ('{operativo,administrativo,supervisor,directivo}'::public.app_rol[]))
       and ((select public.auth_ve_todas_empresas_definer())
            or ((select public.auth_rol_definer()) = any ('{empresa,direccion}'::public.app_rol[])
                and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
            or ((select public.auth_opera_proyectos_empresa_definer())
                and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))))
      or responsable_id = (select auth.uid())
      or comprador_id = (select auth.uid())
      or id = any ((select public.auth_proyectos_propios())::uuid[])
    )
  );

-- Comprobación de gastos: los básicos ya no ven todas las obras activas de su
-- empresa por esta vía; las suyas les llegan por proyectos_select.
drop policy if exists proyectos_select_gastos on public.proyectos;
create policy proyectos_select_gastos on public.proyectos for select to authenticated
  using (
    (select public.auth_puede_comprobar_gasto_definer())
    and not ((select public.auth_rol_definer()) = any ('{operativo,administrativo,supervisor,directivo}'::public.app_rol[]))
    and ((select public.auth_admin_global_definer()) or 'proyectos' = any ((select public.auth_modulos_habilitados())::text[]))
    and activo
    and empresa_id = any ((select public.auth_empresas_alcance())::uuid[])
  );

-- Requisiciones: lo mismo. Los básicos ven las suyas, las de sus obras
-- asignadas y las de las obras de auth_proyectos_propios(); ya no todas las
-- de su empresa.
drop policy if exists requisiciones_select on public.requisiciones;
create policy requisiciones_select on public.requisiciones for select to authenticated
  using (
    (select public.auth_rol_definer()) <> 'pendiente'
    and (
      (select public.auth_ve_todas_empresas_definer())
        and not ((select public.auth_rol_definer()) = any ('{operativo,administrativo,supervisor,directivo}'::public.app_rol[]))
      or ((select public.auth_rol_definer()) = any ('{empresa,direccion,almacen}'::public.app_rol[])
          and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
      or ((select public.auth_opera_proyectos_empresa_definer())
          and not ((select public.auth_rol_definer()) = any ('{operativo,administrativo,supervisor,directivo}'::public.app_rol[]))
          and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
      or solicitado_por = (select auth.uid())
      or proyecto_id = any ((select public.auth_proyectos_propios())::uuid[])
      or exists (select 1 from public.proyectos p
                  where p.id = requisiciones.proyecto_id
                    and (p.responsable_id = (select auth.uid()) or p.comprador_id = (select auth.uid())))
    )
  );

-- Timoteo Colapala (administrativo, empresa principal CSC, MCF en "Maneja
-- también"): obras de MCF.
update public.profiles set alcance_propio = true
 where id = '825ea06e-5f7d-425e-8ee1-996c56961d0d'
   and exists (select 1 from public.profile_empresas pe where pe.profile_id = profiles.id);
