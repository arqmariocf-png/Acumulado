-- Dar de alta obras desde la app (9-nov-2026, Mario: "permite a Timo abrir
-- tableros y proyectos").
--
-- Hasta hoy ninguna pantalla creaba obras: llegaban del backoffice
-- (fn_proyectos_desde_backoffice) o por SQL, y la policy de insert solo
-- dejaba a admin/corporativo (y producción en su alcance). Timoteo
-- (administrativo de CSC con módulo proyectos y "maneja también" MCF) no
-- podía abrir una obra ni crear tableros fuera de CSC.
--
-- 1. Policy `proyectos_insert_empresa`: dirección, empresa, responsable y
--    los básicos con módulo proyectos (auth_opera_proyectos_empresa) dan de
--    alta obras en las empresas de su alcance (empresa principal + "maneja
--    también"), con módulo habilitado y suscripción al corriente.
-- 2. Trigger `proyectos_alta_responsable`: si quien da de alta es un rol
--    básico o responsable y no puso responsable, queda él mismo (así la ve
--    en "sus obras asignadas", como exige proyectos_select).
-- Los tableros ya los crea en cualquier empresa de su alcance
-- (auth_administra_tableros_de); la pantalla solo fijaba la principal.
--
-- Ya aplicado en producción (proyectos_alta_desde_la_app).

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proyectos' and policyname = 'proyectos_insert_empresa') then
    create policy proyectos_insert_empresa on public.proyectos for insert
      with check (
        ((select public.auth_rol_definer()) in ('direccion', 'empresa') or (select public.auth_opera_proyectos_empresa_definer()))
        and (select public.auth_suscripcion_permite_escribir_definer())
        and ((select public.auth_admin_global_definer()) or 'proyectos' = any ((select public.auth_modulos_habilitados())::text[]))
        and empresa_id = any ((select public.auth_empresas_alcance())::uuid[])
      );
  end if;
end $$;

create or replace function public.proyectos_alta_responsable()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_nombre text;
begin
  if v_uid is null or new.responsable_id is not null then
    return new;
  end if;
  select p.rol::text, p.nombre into v_rol, v_nombre from public.profiles p where p.id = v_uid;
  if v_rol in ('operativo', 'administrativo', 'supervisor', 'directivo', 'responsable') then
    new.responsable_id := v_uid;
    new.responsable_nombre := coalesce(new.responsable_nombre, v_nombre);
  end if;
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'proyectos_alta_responsable' and tgrelid = 'public.proyectos'::regclass) then
    create trigger proyectos_alta_responsable
      before insert on public.proyectos
      for each row execute function public.proyectos_alta_responsable();
  end if;
end $$;
