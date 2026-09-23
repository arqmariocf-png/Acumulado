-- Agrega el tipo de contrato a contrataciones (pedido explícito del
-- usuario, 4 opciones confirmadas):
--   confidencialidad        -> Convenio de confidencialidad
--   laboral_determinado     -> Contrato laboral por tiempo determinado
--   laboral_indeterminado   -> Contrato laboral por tiempo indeterminado
--   prestacion_servicios    -> Contrato de prestación de servicios
--
-- Default 'laboral_determinado' porque es el comportamiento que la tabla ya
-- tenía implícito (duracion_dias/fecha_fin obligatorios, como un contrato
-- por tiempo determinado real) -- así ninguna fila existente queda con un
-- tipo que no reflejaba lo que ya se estaba capturando.
--
-- NO se toca duracion_dias/fecha_fin (siguen obligatorios para TODOS los
-- tipos, incluido laboral_indeterminado): esta migración solo agrega la
-- clasificación que se pidió. Si más adelante se necesita que un contrato
-- por tiempo indeterminado no tenga fecha de fin, es un cambio de esquema
-- aparte (duracion_dias tendría que volverse opcional), pendiente de
-- confirmar con el usuario antes de tocarlo.
alter table public.contrataciones
  add column tipo_contrato text not null default 'laboral_determinado'
    check (tipo_contrato in ('confidencialidad', 'laboral_determinado', 'laboral_indeterminado', 'prestacion_servicios'));

comment on column public.contrataciones.tipo_contrato is 'Clasificación del contrato: confidencialidad, laboral_determinado, laboral_indeterminado, o prestacion_servicios.';
