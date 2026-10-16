-- Supervisores con precios unitarios (16-oct-2026, Mario: "a todos los
-- supervisores habilitarles el módulo de precios unitarios"). Para un rol
-- básico el módulo se abre con el permiso por persona 'precios'
-- (`auth_tiene_modulo('precios')` en `auth_puede_escribir_pu` /
-- `auth_participa_pu`, y `ProtectedRoute modulo="precios"` en la app).
-- Se da a los supervisores activos y, por trigger, a quien pase a rol
-- supervisor después (quitarlo luego a alguien en particular sigue siendo
-- desde RH → Accesos). Ya aplicado en producción.

insert into public.permisos_modulo (profile_id, modulo)
select p.id, 'precios' from public.profiles p
 where p.rol = 'supervisor' and p.activo
on conflict (profile_id, modulo) do nothing;

create or replace function public.profiles_supervisor_precios()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol = 'supervisor' and (tg_op = 'INSERT' or old.rol is distinct from new.rol) then
    insert into public.permisos_modulo (profile_id, modulo) values (new.id, 'precios')
    on conflict (profile_id, modulo) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_supervisor_precios on public.profiles;
create trigger profiles_supervisor_precios after insert or update of rol on public.profiles
  for each row execute function public.profiles_supervisor_precios();
