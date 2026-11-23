-- "Quita ARSSA y Estudio K de mis empresas, que ya no aparezcan" (23-nov-2026,
-- Mario). El admin de la organización maestra ve en `auth_empresas_alcance()`
-- las empresas de TODAS las organizaciones, activas o no, así que la empresa
-- EK (Estudio K) salía en sus selectores y ARSSA en la vista de socio.
--  1. Las dos organizaciones quedan `grupos.activo = false` y la empresa EK
--     `activo = false` (nada se borra: si vuelven, se reactivan en Admin ›
--     Organizaciones y Admin › Empresas).
--  2. `auth_empresas_alcance()` ya no trae al admin maestro las empresas de
--     organizaciones inactivas (dentro de su propia organización no cambia).
--     fn_socio_resumen ya filtraba `g.activo`.
-- Ya aplicado en producción como `organizaciones_inactivas_fuera_del_alcance`.

update public.grupos set activo = false where codigo in ('ARSSA', 'EK') and activo;
update public.empresas e set activo = false
  from public.grupos g where g.id = e.grupo_id and g.codigo = 'EK' and e.activo;

create or replace function public.auth_empresas_alcance()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(e.id order by e.nombre), '{}'::uuid[])
  from public.profiles pr
  left join public.grupos g on g.id = pr.grupo_id
  left join public.roles_alcance ra on ra.rol = pr.rol
  join public.empresas e on (
    (pr.rol = 'admin' and coalesce(g.es_maestro, false)
       and (e.grupo_id = pr.grupo_id or exists (select 1 from public.grupos ge where ge.id = e.grupo_id and ge.activo)))
    or (e.grupo_id = pr.grupo_id and (
          pr.rol = 'admin'
          or e.id = pr.empresa_id
          or (coalesce(ra.multiempresa, false) and pr.todas_las_empresas)
          or ((coalesce(ra.multiempresa, false) or pr.alcance_propio)
              and exists (select 1 from public.profile_empresas pe where pe.profile_id = pr.id and pe.empresa_id = e.id))))
  )
  where pr.id = auth.uid() and pr.rol <> 'pendiente' and not pr.espectador
$$;
