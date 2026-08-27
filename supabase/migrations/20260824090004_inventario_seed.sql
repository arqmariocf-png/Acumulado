-- Da de alta el almacén principal de cada una de las 8 empresas ya
-- sembradas en `empresas` (20260816090010_seed.sql), para que el módulo de
-- inventario tenga dónde registrar movimientos desde el primer día sin que
-- un admin tenga que crearlos a mano uno por uno.
insert into public.almacenes (empresa_id, nombre)
select id, 'Almacén principal'
from public.empresas
on conflict (empresa_id, nombre) do nothing;
