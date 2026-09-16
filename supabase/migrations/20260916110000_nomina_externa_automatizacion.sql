-- Sincronización automática de las APIs de Grupo Loma (mismo patrón que
-- disparar_recordatorios_diarios para push-enviar-recordatorios): pg_cron
-- llama a este wrapper cada hora, que lee el secreto de config_sistema en
-- tiempo real y dispara el edge function vía pg_net -- el secreto nunca
-- queda escrito en el repositorio ni en la definición del cron job.
--
-- El `cron.schedule(...)` en sí NO va en esta migración (mismo criterio que
-- el resto de la automatización de este proyecto): se activa una vez desde
-- el SQL editor, ya con pg_cron/pg_net confirmados en el proyecto real.
--   select cron.schedule('nomina-externa-sincronizar', '0 * * * *',
--     'select public.disparar_sincronizacion_nomina_externa();');
create or replace function public.disparar_sincronizacion_nomina_externa()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secreto text;
begin
  select valor into v_secreto from public.config_sistema where clave = 'cron_secret';
  if v_secreto is null then
    raise exception 'cron_secret no está configurado en config_sistema';
  end if;

  perform net.http_post(
    url := 'https://zdqahpzijkkcnfehbggs.supabase.co/functions/v1/nomina-externa-sincronizar',
    headers := jsonb_build_object('x-cron-secret', v_secreto, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;
