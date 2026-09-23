-- Pruebas del módulo de suscripción ("gracia y luego solo lectura") y del
-- módulo de Proyectos -- ver supabase/migrations/20260923090003..6.
--
-- Mismo entorno que aislamiento_organizaciones.sql (Postgres con las
-- migraciones aplicadas y un shim mínimo de Supabase); se corre igual:
--
--   psql -d <base_con_migraciones> -f supabase/tests/suscripcion_y_proyectos.sql
--
-- Qué verifica: (1) ARSSA en prueba sí captura proyectos; (2) planos y
-- cotizaciones cuelgan del proyecto y respetan la frontera; (3) el importe
-- y los totales de la cotización se calculan, no se capturan; (4) al
-- suspenderse la suscripción se deja de capturar PERO se sigue leyendo;
-- (5) la administración de la cuenta NO se bloquea (si no, no podrían
-- actualizar su tarjeta para ponerse al corriente); (6) el periodo de
-- gracia deja escribir hasta su fecha y no después; (7) la organización
-- maestra nunca se bloquea; (8) el cliente no puede editarse su propia
-- suscripción para "activarse" solo.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin.loma@test'),
  ('55555555-5555-5555-5555-555555555555', 'admin.arssa@test'),
  ('66666666-6666-6666-6666-666666666666', 'proyectos.arssa@test');

update public.profiles set nombre='Admin Loma', rol='admin',
  grupo_id=(select id from grupos where codigo='LOMA') where id='11111111-1111-1111-1111-111111111111';
update public.profiles set nombre='Admin ARSSA', rol='admin',
  grupo_id=(select id from grupos where codigo='ARSSA') where id='55555555-5555-5555-5555-555555555555';
update public.profiles set nombre='Proyectos ARSSA', rol='corporativo',
  grupo_id=(select id from grupos where codigo='ARSSA') where id='66666666-6666-6666-6666-666666666666';

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

\echo '── 1. ARSSA en prueba: captura proyecto, plano y cotización'
set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);

insert into public.proyectos (clave, nombre, cliente, estatus)
values ('P-001', 'Casa habitación Lomas', 'Familia Pérez', 'en_diseno');

insert into public.planos (proyecto_id, clave, nombre, disciplina, revision, subido_por)
values ((select id from proyectos where clave='P-001'), 'A-01', 'Planta baja', 'arquitectonico', 'A',
        '66666666-6666-6666-6666-666666666666');

insert into public.cotizaciones (proyecto_id, folio, cliente, estatus)
values ((select id from proyectos where clave='P-001'), 'COT-001', 'Familia Pérez', 'borrador');

insert into public.cotizacion_partidas (cotizacion_id, orden, concepto, unidad, cantidad, precio_unitario) values
  ((select id from cotizaciones where folio='COT-001'), 1, 'Proyecto arquitectónico', 'M2', 180, 350),
  ((select id from cotizaciones where folio='COT-001'), 2, 'Planos estructurales', 'LOTE', 1, 25000);

select count(*) as proyectos, (select count(*) from planos) as planos from proyectos;

\echo '── 2. Totales calculados (180*350 + 25000 = 88,000 + IVA 16% = 102,080)'
select partidas, subtotal, iva, total from v_cotizacion_totales where folio='COT-001';
reset role;

\echo '── 3. Se suspende la suscripción de ARSSA (se acabó la gracia)'
update public.suscripciones set estado='suspendida', periodo_fin = now() - interval '10 days', gracia_hasta = now() - interval '3 days'
 where grupo_id = (select id from grupos where codigo='ARSSA');

set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);

\echo '   3a. Sigue LEYENDO lo suyo'
select count(*) as proyectos_visibles from proyectos;
select count(*) as planos_visibles from planos;
select partidas, total from v_cotizacion_totales where folio='COT-001';

\echo '   3b. Ya no CAPTURA'
do $$
begin
  insert into public.proyectos (clave, nombre) values ('P-002', 'Proyecto nuevo');
  raise exception 'FALLA: capturó con la suscripción suspendida';
exception when insufficient_privilege then
  raise notice 'OK: RLS bloqueó el alta de proyecto con la suscripción suspendida';
end $$;

do $$
begin
  update public.proyectos set nombre = 'Cambiado' where clave = 'P-001';
  if found then raise exception 'FALLA: actualizó con la suscripción suspendida'; end if;
  raise notice 'OK: el update no alcanzó ninguna fila';
end $$;
reset role;

\echo '── 4. La administración de la cuenta NO se bloquea (tienen que poder pagar)'
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
insert into public.empresas (nombre, codigo, grupo_id)
values ('ARSSA Diseño', 'ARSD', (select id from grupos where codigo='ARSSA'));
select count(*) as empresas_arssa from empresas;
select estado, puede_escribir from v_suscripcion;
reset role;

\echo '── 5. El cliente no puede activarse la suscripción solo'
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
do $$
begin
  update public.suscripciones set estado = 'activa'
   where grupo_id = (select id from public.grupos where codigo='ARSSA');
  if found then raise exception 'FALLA: el cliente se activó la suscripción solo'; end if;
  raise notice 'OK: el update no alcanzó ninguna fila (RLS)';
end $$;
reset role;

\echo '── 6. En periodo de gracia sí escribe, hasta su fecha'
update public.suscripciones set estado='periodo_gracia', gracia_hasta = now() + interval '3 days'
 where grupo_id = (select id from grupos where codigo='ARSSA');
set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
insert into public.proyectos (clave, nombre) values ('P-002', 'Proyecto en gracia');
select count(*) as proyectos from proyectos;
reset role;

update public.suscripciones set gracia_hasta = now() - interval '1 minute'
 where grupo_id = (select id from grupos where codigo='ARSSA');
set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
do $$
begin
  insert into public.proyectos (clave, nombre) values ('P-003', 'Fuera de gracia');
  raise exception 'FALLA: capturó con la gracia vencida';
exception when insufficient_privilege then
  raise notice 'OK: RLS bloqueó la captura con la gracia vencida';
end $$;
reset role;

\echo '── 7. La organización maestra nunca se bloquea por suscripción'
update public.suscripciones set estado='suspendida' where grupo_id = (select id from grupos where codigo='LOMA');
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.auth_suscripcion_permite_escribir() as maestra_puede_escribir;
reset role;
