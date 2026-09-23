-- Diagnóstico (no es una prueba): qué policies siguen usando el patrón viejo
-- `auth_ve_todas_empresas()` sin pasar por empresa_en_alcance(). Ese patrón
-- devuelve true para TODAS las filas cuando el usuario es corporativo/admin,
-- así que en esas tablas un corporativo de una organización vería datos de
-- otra. Es la lista de lo que falta para cerrar la frontera.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and (coalesce(qual,'') || coalesce(with_check,'')) like '%auth_ve_todas_empresas%'
  and (coalesce(qual,'') || coalesce(with_check,'')) not like '%empresa_en_alcance%'
order by tablename, policyname;
