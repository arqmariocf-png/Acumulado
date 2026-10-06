-- Confirmación de pagos, sobre todo en efectivo (Mario, 6-oct-2026: "una
-- pestaña para confirmar los pagos en efectivo para Laura Orta; dentro de las
-- órdenes de compra ella hace esas devoluciones y necesita confirmarlas" y
-- "en ese mismo paso subir el comprobante; un mismo comprobante cubre varias
-- órdenes de pago"). Quién y cuándo confirmó, aparte de `estatus = pagado`
-- (que en efectivo lo marca tesorería al entregar). La edge
-- pagos-comprobante confirma varios pagos de una vez y les liga el mismo
-- archivo.
--
-- Ya aplicado en producción.

alter table public.pagos_programados add column if not exists confirmado_en timestamptz;
alter table public.pagos_programados add column if not exists confirmado_por uuid references auth.users(id);
create index if not exists pagos_programados_confirmado_por_idx on public.pagos_programados (confirmado_por);
