-- 24-nov-2026, Mario: "el módulo de carpintería dáselo a Fernanda, ella será
-- encargada de ese equipo de trabajo". Fernanda es `responsable` (MCF) y el
-- taller de carpintería vive en CSC (proyecto "TALLER CARPINTERIA"). Producción
-- estaba amarrada al rol `produccion` en 12 tablas; cambiarle el rol le
-- quitaría sus obras. Mismo molde que el permiso de RH por persona
-- (20261111090000): `permisos_modulo` 'produccion' vale para CUALQUIER rol
-- (antes solo lo leían auth_opera_planta/auth_ve_planta para los básicos), y
-- las policies que nombran 'produccion'::app_rol leen el rol por
-- auth_rol_produccion_definer(): el de siempre, salvo con el permiso.
-- Ya aplicada en producción como `permiso_produccion_por_persona`.

create or replace function public.auth_tiene_permiso_produccion()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.permisos_modulo pm where pm.profile_id = auth.uid() and pm.modulo = 'produccion');
$$;

create or replace function public.auth_rol_produccion()
returns public.app_rol language sql stable security definer set search_path = public as $$
  select case when r is not null and r <> 'pendiente' and public.auth_tiene_permiso_produccion() then 'produccion'::public.app_rol else r end
    from (select public.auth_rol() as r) x
$$;

create or replace function public.auth_rol_produccion_definer()
returns public.app_rol language sql stable security definer set search_path = public as $$
  select case when r is not null and r <> 'pendiente' and public.auth_tiene_permiso_produccion() then 'produccion'::public.app_rol else r end
    from (select public.auth_rol_definer() as r) x
$$;

-- Las policies de producción (y las de OC/OV/proyectos/clientes que dejan
-- entrar al rol produccion) leen el rol por la función nueva.
do $$
declare r record; v_using text; v_check text;
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and policyname not in ('frontera_organizacion', 'espectador_sin_datos', 'director_general', 'solo_consulta')
       and (coalesce(qual, '') ilike '%''produccion''::app_rol%' or coalesce(with_check, '') ilike '%''produccion''::app_rol%')
       and (coalesce(qual, '') like '%auth_rol_definer()%' or coalesce(with_check, '') like '%auth_rol_definer()%')
  loop
    v_using := replace(r.qual, 'auth_rol_definer() AS auth_rol_definer', 'auth_rol_produccion_definer() AS auth_rol_produccion_definer');
    v_check := replace(r.with_check, 'auth_rol_definer() AS auth_rol_definer', 'auth_rol_produccion_definer() AS auth_rol_produccion_definer');
    if r.cmd = 'INSERT' then
      execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, v_check);
    elsif r.cmd = 'SELECT' or r.cmd = 'DELETE' then
      execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, v_using);
    else
      execute format('alter policy %I on %I.%I using (%s) with check (%s)', r.policyname, r.schemaname, r.tablename, v_using, coalesce(v_check, v_using));
    end if;
  end loop;
end $$;

-- Fernanda: permiso producción, CSC en "Maneja también" con excepción de
-- alcance (su rol responsable no es multiempresa) y encargada del proyecto
-- del taller; el tablero del taller vuelve a estar activo para su equipo.
insert into public.permisos_modulo (profile_id, modulo)
select 'bd347249-9fb6-4bbf-aab3-b9e4714c8f4b', 'produccion'
 where exists (select 1 from public.profiles where id = 'bd347249-9fb6-4bbf-aab3-b9e4714c8f4b')
on conflict do nothing;
insert into public.profile_empresas (profile_id, empresa_id)
select 'bd347249-9fb6-4bbf-aab3-b9e4714c8f4b', e.id from public.empresas e where e.codigo = 'CSC'
  and exists (select 1 from public.profiles where id = 'bd347249-9fb6-4bbf-aab3-b9e4714c8f4b')
on conflict do nothing;
update public.profiles set alcance_propio = true where id = 'bd347249-9fb6-4bbf-aab3-b9e4714c8f4b';
update public.proyectos set responsable_id = 'bd347249-9fb6-4bbf-aab3-b9e4714c8f4b'
 where id = 'd2cabcb5-1ddc-4745-b97c-3e394a6b7c64' and responsable_id is null
   and exists (select 1 from public.profiles where id = 'bd347249-9fb6-4bbf-aab3-b9e4714c8f4b');
update public.tableros set archivado = false where id = 'acdd97d3-6681-4839-a2be-b7f95f927b5b';
