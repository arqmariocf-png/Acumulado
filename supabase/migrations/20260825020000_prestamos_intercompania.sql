-- Préstamos entre empresas del grupo (categoría "N/A - PRESTAMO
-- INTERCOMPAÑIA" de reglas_clasificacion): hasta ahora el motor solo
-- marcaba el movimiento como resuelto sin registrar CUÁL de las otras 7
-- empresas es la contraparte del préstamo -- sin eso no se puede saber
-- quién le debe a quién entre las empresas del grupo.
--
-- empresa_contraparte_id se captura a mano desde Reportes Especiales
-- (categoría Préstamos) -- el motor de clasificación no puede inferirla del
-- estado de cuenta (el banco no dice "a nombre de qué empresa del grupo" es
-- la transferencia, solo el concepto "PRESTAMO").
alter table public.movimientos
  add column empresa_contraparte_id uuid references public.empresas (id);

comment on column public.movimientos.empresa_contraparte_id is 'Solo aplica a préstamos entre empresas del grupo (factura = ''N/A - PRESTAMO INTERCOMPAÑIA''): la otra empresa del grupo involucrada en el préstamo, capturada a mano en Reportes Especiales.';

-- Detalle de cada movimiento de préstamo intercompañía, con quién es
-- acreedor (prestó) y quién es deudor (recibió) ya resuelto según si el
-- movimiento fue cargo (esta empresa prestó) o abono (esta empresa
-- recibió) -- security_invoker = true, mismo motivo que el resto de las
-- vistas (no evadir RLS: un usuario de una sola empresa solo debe ver los
-- préstamos donde SU empresa participa, vía el RLS que ya tiene
-- movimientos).
create view public.v_prestamos_intercompania with (security_invoker = true) as
select
  m.id,
  m.empresa_id,
  e1.nombre as empresa_nombre,
  m.empresa_contraparte_id,
  e2.nombre as empresa_contraparte_nombre,
  m.fecha_pago,
  m.cargo_total,
  m.abono_total,
  coalesce(m.cargo_total, m.abono_total) as monto,
  case
    when m.empresa_contraparte_id is null then null
    when m.cargo_total is not null then m.empresa_id
    else m.empresa_contraparte_id
  end as acreedor_id,
  case
    when m.empresa_contraparte_id is null then null
    when m.cargo_total is not null then m.empresa_contraparte_id
    else m.empresa_id
  end as deudor_id
from public.movimientos m
join public.empresas e1 on e1.id = m.empresa_id
left join public.empresas e2 on e2.id = m.empresa_contraparte_id
where m.factura = 'N/A - PRESTAMO INTERCOMPAÑIA';

comment on view public.v_prestamos_intercompania is 'Movimientos clasificados como préstamo entre empresas del grupo, con acreedor_id/deudor_id ya resueltos (null si todavía no se captura empresa_contraparte_id) -- fuente para la página de Préstamos entre empresas.';
