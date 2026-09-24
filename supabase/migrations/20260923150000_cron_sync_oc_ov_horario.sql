-- Las OC recién autorizadas tardaban hasta un día en aparecer (Laura,
-- 23-sep-2026). La sincronización pasa de diaria a cada hora (minuto 15).
-- Ya aplicado en producción.
select cron.unschedule('sync-catalogo-oc-ov-diario') where exists (select 1 from cron.job where jobname = 'sync-catalogo-oc-ov-diario');
select cron.schedule('sync-catalogo-oc-ov-horario', '15 * * * *', $$select public.sincronizar_catalogo_oc_ov();$$)
where not exists (select 1 from cron.job where jobname = 'sync-catalogo-oc-ov-horario');
