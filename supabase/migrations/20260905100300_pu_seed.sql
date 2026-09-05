-- Semilla mínima de Precios Unitarios: lo que el módulo necesita para no
-- arrancar en un estado en el que no se puede hacer nada.

-- Herramienta menor y equipo de seguridad son los dos renglones que
-- prácticamente todo análisis lleva, y los dos se cobran como porcentaje de
-- la mano de obra -- por eso no tienen costo en el catálogo: su costo ES el
-- subtotal de mano de obra del análisis donde se escriben. Sin al menos uno
-- de alta, la pestaña "% de mano de obra" de Agregar renglón sale vacía.
insert into public.pu_insumos (codigo, descripcion, unidad, tipo) values
  ('HERR-MENOR', 'Herramienta menor', '% MO', 'herramienta'),
  ('EQ-SEGURIDAD', 'Equipo de seguridad', '% MO', 'equipo')
on conflict (codigo) do nothing;

-- Un factor por empresa, para que dirección general tenga de dónde partir en
-- vez de la pantalla en blanco.
--
-- ATENCIÓN: los porcentajes son un PUNTO DE PARTIDA, no los del grupo --
-- nadie los ha confirmado todavía (ver "Pendientes conocidos" en README.md).
-- No se aplican solos: un análisis nace sin factor, un admin tiene que
-- asignárselo a mano, y publicar sin factor está prohibido por el trigger de
-- flujo. Cambiarlos NO es editar esta fila: se crea un factor nuevo con otra
-- vigencia, para que un PU ya firmado no cambie de precio solo.
insert into public.pu_factores (
  empresa_id, nombre, indirectos_pct, financiamiento_pct, utilidad_pct, cargos_adicionales_pct, vigente_desde
)
select e.id, 'Base 2026 (por confirmar con Dirección General)', 0.1500, 0.0100, 0.1000, 0.0050, date '2026-01-01'
from public.empresas e
on conflict (empresa_id, nombre) do nothing;
