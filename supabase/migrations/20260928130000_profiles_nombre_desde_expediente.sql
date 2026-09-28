-- Nombre completo con los dos apellidos en todos los controles (Mario,
-- 28-sep-2026): el expediente de RH (personal.nombre) manda sobre el nombre
-- de la cuenta (profiles.nombre), que es lo que pintan los selectores, las
-- tarjetas y las gráficas. Se sincroniza al ligar la cuenta o al corregir
-- el nombre en el expediente, y se rellenó lo existente (8 cuentas que
-- traían solo un apellido o el correo). Ya aplicado en producción.
create or replace function public.sincronizar_nombre_profile_desde_personal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.profile_id is not null and nullif(trim(coalesce(new.nombre, '')), '') is not null then
    update public.profiles set nombre = trim(new.nombre) where id = new.profile_id and nombre is distinct from trim(new.nombre);
  end if;
  return new;
end;
$$;
drop trigger if exists personal_sincroniza_nombre_profile on public.personal;
create trigger personal_sincroniza_nombre_profile
  after insert or update of nombre, profile_id on public.personal
  for each row execute function public.sincronizar_nombre_profile_desde_personal();

update public.profiles p
set nombre = trim(pe.nombre)
from public.personal pe
where pe.profile_id = p.id and nullif(trim(coalesce(pe.nombre, '')), '') is not null and p.nombre is distinct from trim(pe.nombre);
