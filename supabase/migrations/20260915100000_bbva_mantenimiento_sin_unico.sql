-- La carga automática (bbva-importar-folios) crea un snapshot nuevo en cada
-- subida, nunca actualiza uno existente -- el unique(fecha_corte, region)
-- original asumía como mucho un corte por día, pero el equipo puede subir
-- el maestro corregido más de una vez el mismo día. "Más reciente" ahora se
-- decide por creado_en, no por fecha_corte.
alter table public.bbva_mantenimiento_snapshots drop constraint bbva_mantenimiento_snapshots_fecha_corte_region_key;
