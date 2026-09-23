-- El catálogo de OC/OS y OV llevaba un mes sin sincronizarse (último
-- 25-ago-2026; Mario pidió actualizarlo el 23-sep). Se programa la
-- sincronización diaria a las 05:00 de Puebla (11:00 UTC) con pg_cron,
-- usando la misma función del botón manual. Ya aplicado en producción
-- con cron.schedule; este archivo lo deja documentado.
select cron.schedule('sync-catalogo-oc-ov-diario', '0 11 * * *', $$select public.sincronizar_catalogo_oc_ov();$$)
where not exists (select 1 from cron.job where jobname = 'sync-catalogo-oc-ov-diario');
