-- ── Logotipo por organización ───────────────────────────────────────────
--
-- Cada cliente entra a "su" aplicación: su marca y su logotipo en el
-- encabezado, no el de otro. El archivo vive en un bucket PÚBLICO a
-- propósito -- un logotipo no es información reservada y así la imagen se
-- sirve por URL directa sin firmar nada en cada carga de página.
--
-- Lo que sí está acotado es quién lo SUBE: solo un admin, y solo dentro de
-- la carpeta de su propia organización (el primer folder de la ruta es el
-- grupo_id, mismo criterio que el bucket de planos).

alter table public.grupos add column logo_path text;

comment on column public.grupos.logo_path is
  'Ruta dentro del bucket público `branding` (ej. "<grupo_id>/logo.png"). El frontend arma la URL pública con esa ruta; NULL = sin logotipo, se muestra solo el nombre.';

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

-- El bucket es público, así que la lectura no necesita policy. La escritura
-- sí: sin esto cualquier usuario autenticado podría reemplazar el logotipo
-- de cualquier organización.
create policy branding_insert on storage.objects for insert
  with check (
    bucket_id = 'branding'
    and public.auth_rol() = 'admin'
    and public.grupo_en_alcance(public.grupo_de_ruta(name))
  );

create policy branding_update on storage.objects for update
  using (
    bucket_id = 'branding'
    and public.auth_rol() = 'admin'
    and public.grupo_en_alcance(public.grupo_de_ruta(name))
  )
  with check (
    bucket_id = 'branding'
    and public.auth_rol() = 'admin'
    and public.grupo_en_alcance(public.grupo_de_ruta(name))
  );

create policy branding_delete on storage.objects for delete
  using (
    bucket_id = 'branding'
    and public.auth_rol() = 'admin'
    and public.grupo_en_alcance(public.grupo_de_ruta(name))
  );
