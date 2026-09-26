-- La pantalla de acceso tiene que decir de quién es la aplicación ANTES de
-- que nadie entre, y ahí todavía no hay sesión: `grupos` está cerrado a quien
-- no tiene rol, así que hoy el nombre estaba escrito a mano ("Grupo Loma") en
-- el título, en el login y en el manifiesto de la PWA. El resultado es que el
-- cliente instala en su teléfono una app que se llama como otra empresa.
--
-- Esta función es la excepción medida: devuelve SOLO la marca -- nombre y
-- ruta del logotipo, que ya vive en un bucket público -- de UNA organización
-- que se pide por código. No lista organizaciones (no se puede pescar quién
-- es cliente de la plataforma), no dice si está al corriente, no dice cuánta
-- gente tiene. Todo lo demás sigue necesitando sesión.

create or replace function public.fn_marca_publica(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'codigo', g.codigo,
           'nombre', coalesce(g.marca_comercial, g.nombre),
           'logo_path', g.logo_path
         )
  from public.grupos g
  where g.activo
    and lower(g.codigo) = lower(trim(coalesce(p_codigo, '')))
  limit 1
$$;

comment on function public.fn_marca_publica(text) is
  'Marca de una organización para la pantalla de acceso (sin sesión). Solo nombre visible y ruta del logotipo público; nada de suscripción, usuarios ni empresas.';

revoke all on function public.fn_marca_publica(text) from public;
grant execute on function public.fn_marca_publica(text) to anon, authenticated;
