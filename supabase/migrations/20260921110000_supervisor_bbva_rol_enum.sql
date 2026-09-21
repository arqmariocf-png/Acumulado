-- Rol para los supervisores de la operación BBVA (Carlos Xilotl y Miguel
-- Pérez, 21-sep-2026): capturan únicamente el número de folio y su estatus
-- (pendiente / en ejecución / atendido) como indicador de cuadrillas. No ven
-- nada financiero ni el maestro completo de BBVA. Va en su propia migración
-- porque Postgres no permite usar un valor de enum recién agregado en la
-- misma transacción (igual que 'rh' y 'rh_documentos').
alter type public.app_rol add value 'supervisor_bbva';
