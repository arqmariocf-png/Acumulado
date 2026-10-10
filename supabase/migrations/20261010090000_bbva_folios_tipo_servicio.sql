-- Christian (10-oct-2026): el control "BBVA MANTTO - KPIs.xlsm" cambió de
-- formato (encabezado en la fila 12, "Folio/UDA", y Obra Menor dentro de la
-- misma hoja con "Tipo de servicio"). Se guarda el tipo por folio.
--
-- Ya aplicado en producción.
alter table public.bbva_folios_control add column if not exists tipo_servicio text;
