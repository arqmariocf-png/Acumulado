-- Pruebas de aislamiento entre organizaciones (tenants) y del interruptor de
-- módulos -- ver supabase/migrations/20260923090001_grupos_modulos.sql y
-- 20260923090002_grupos_rls.sql.
--
-- No corre en el `npm test` de este repo (ese solo cubre los módulos puros de
-- _shared con node --test): esto necesita un Postgres con las migraciones
-- aplicadas. Contra un Postgres local con un shim mínimo de Supabase
-- (esquema auth con users + uid(), esquema storage, roles anon/authenticated/
-- service_role) se corre así:
--
--   psql -d <base_con_migraciones> -f supabase/tests/aislamiento_organizaciones.sql
--
-- Lo que verifica, en orden: (1) un corporativo de Loma sigue viendo sus 8
-- empresas y ninguna de ARSSA; (2) tesorería de ARSSA no ve movimientos,
-- cuentas ni reglas de Loma; (3) ARSSA solo tiene abierto el módulo con el que entró (proyectos);
-- (4) el admin de la organización maestra sí cruza organizaciones; (5) con el
-- módulo cerrado, RLS bloquea la escritura; (6) el admin de una organización
-- cliente no puede abrirse módulos solo; (7) cuando el maestro abre el
-- módulo, la escritura pasa; (8) lo que ARSSA escribe no lo ve Loma; (9) un
-- usuario no puede quedar con una empresa de otra organización; (10) cada
-- organización puede tener su propia regla con la misma palabra clave, sin
-- mandar grupo_id (lo pone el trigger) y sin ver las de la otra.

\set ON_ERROR_STOP on
-- ── Semilla de prueba ───────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin.loma@test'),
  ('22222222-2222-2222-2222-222222222222', 'corp.loma@test'),
  ('33333333-3333-3333-3333-333333333333', 'admin.arssa@test'),
  ('44444444-4444-4444-4444-444444444444', 'tesoreria.arssa@test');

-- el trigger handle_new_user ya creó los profiles en rol 'pendiente'
update public.profiles set nombre='Admin Loma', rol='admin', grupo_id=(select id from grupos where codigo='LOMA') where id='11111111-1111-1111-1111-111111111111';
update public.profiles set nombre='Corporativo Loma', rol='corporativo', grupo_id=(select id from grupos where codigo='LOMA') where id='22222222-2222-2222-2222-222222222222';
update public.profiles set nombre='Admin ARSSA', rol='admin', grupo_id=(select id from grupos where codigo='ARSSA') where id='33333333-3333-3333-3333-333333333333';

-- Empresa de ARSSA + su usuario de tesorería
insert into public.empresas (nombre, codigo, grupo_id)
values ('ARSSA Operadora', 'ARS', (select id from grupos where codigo='ARSSA'));

update public.profiles set nombre='Tesorería ARSSA', rol='empresa',
   grupo_id=(select id from grupos where codigo='ARSSA'),
   empresa_id=(select id from empresas where codigo='ARS')
 where id='44444444-4444-4444-4444-444444444444';

-- Movimiento de Loma y cuenta, para probar que ARSSA no lo ve
insert into public.cuentas_bancarias (empresa_id, banco, ultimos_4)
values ((select id from empresas where codigo='AEP'), 'BBVA', '1234');
insert into public.movimientos (empresa_id, cuenta_id, fecha_pago, cargo_total, saldo, created_by)
values ((select id from empresas where codigo='AEP'), (select id from cuentas_bancarias where ultimos_4='1234'),
        '2026-07-01', 50, 100, '22222222-2222-2222-2222-222222222222');

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

\echo '── 1. Corporativo de Loma: empresas visibles (esperado 8, ninguna ARS)'
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select count(*) as empresas_visibles, count(*) filter (where codigo='ARS') as ve_arssa from empresas;
select count(*) as movimientos_visibles from movimientos;
reset role;

\echo '── 2. Tesorería ARSSA: solo su empresa, cero movimientos de Loma'
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select count(*) as empresas_visibles, count(*) filter (where codigo='ARS') as ve_su_empresa from empresas;
select count(*) as movimientos_visibles from movimientos;
select count(*) as cuentas_visibles from cuentas_bancarias;
select count(*) as reglas_visibles from reglas_clasificacion;
reset role;

\echo '── 3. Admin ARSSA: módulos de su organización (solo proyectos abierto)'
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select m.clave, gm.habilitado from grupo_modulos gm join modulos m on m.clave = gm.modulo_clave
  order by m.orden;
select count(*) as grupos_visibles from grupos;
reset role;

\echo '── 4. Admin de Loma (organización maestra): cruza organizaciones'
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select count(*) as empresas_visibles, count(*) filter (where codigo='ARS') as ve_arssa from empresas;
select count(*) as grupos_visibles from grupos;
reset role;

\echo '── 5. ARSSA sin módulo de conciliación: no puede insertar movimientos'
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$
begin
  insert into public.cuentas_bancarias (empresa_id, banco, ultimos_4)
  values ((select id from public.empresas where codigo='ARS'), 'BBVA', '9999');
  raise exception 'FALLA: ARSSA pudo insertar con el módulo cerrado';
exception when insufficient_privilege then
  raise notice 'OK: RLS bloqueó la escritura con el módulo cerrado';
end $$;
reset role;

\echo '── 6. Admin ARSSA no puede abrir módulos (eso es de la organización maestra)'
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$
begin
  update public.grupo_modulos set habilitado = true
   where grupo_id = (select id from public.grupos where codigo='ARSSA');
  if found then raise exception 'FALLA: admin de cliente abrió su propio módulo'; end if;
  raise notice 'OK: el update no alcanzó ninguna fila (RLS)';
end $$;
reset role;

\echo '── 7. Admin maestro abre conciliación a ARSSA y entonces sí entra'
update public.grupo_modulos set habilitado = true, habilitado_at = now()
 where grupo_id = (select id from grupos where codigo='ARSSA') and modulo_clave = 'conciliacion';
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
insert into public.cuentas_bancarias (empresa_id, banco, ultimos_4)
  values ((select id from public.empresas where codigo='ARS'), 'BBVA', '9999');
select count(*) as cuentas_visibles_arssa from cuentas_bancarias;
reset role;

\echo '── 8. Loma no ve la cuenta nueva de ARSSA'
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select count(*) as cuentas_visibles_loma, count(*) filter (where ultimos_4='9999') as ve_cuenta_arssa from cuentas_bancarias;
reset role;

\echo '── 9. Un usuario no puede quedar con empresa de otra organización'
do $$
begin
  update public.profiles set empresa_id = (select id from public.empresas where codigo='AEP')
   where id = '44444444-4444-4444-4444-444444444444';
  raise exception 'FALLA: se permitió empresa de otra organización';
exception when raise_exception then
  if sqlerrm like 'FALLA%' then raise; end if;
  raise notice 'OK: %', sqlerrm;
end $$;

\echo '── 10. Cada organización tiene sus propias reglas, con la misma palabra clave'
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
-- no se manda grupo_id: lo pone el trigger set_grupo_id_del_usuario
insert into public.reglas_clasificacion (palabra_clave, etiqueta, orden)
values ('TRASPASO', 'N/A - TRASPASO ENTRE CUENTAS ARSSA', 10);
select count(*) as reglas_arssa from reglas_clasificacion;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select count(*) as reglas_loma, count(*) filter (where etiqueta like '%ARSSA%') as ve_regla_arssa
  from reglas_clasificacion;
reset role;

\echo '── 11. Sin pago, inventario se queda en solo lectura (consulta sí, captura no)'
-- Las policies de inventario se restituyeron después de la frontera
-- (20260925130000) y quedaron sin preguntar por el pago; 20260925140000 lo
-- cerró. Esto es lo que impide que se vuelva a abrir.
update public.grupo_modulos set habilitado = true, habilitado_at = now()
 where grupo_id = (select id from grupos where codigo='ARSSA') and modulo_clave = 'inventario';
update public.suscripciones set estado = 'suspendida'
 where grupo_id = (select id from grupos where codigo='ARSSA');

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select count(*) as productos_visibles_suspendida from public.productos;
do $$
begin
  insert into public.productos (empresa_id, sku, nombre)
  values ((select id from public.empresas where codigo='ARS'), 'X-1', 'Prueba');
  raise exception 'FALLA: una organización suspendida capturó en inventario';
exception when insufficient_privilege or raise_exception then
  if sqlerrm like 'FALLA%' then raise; end if;
  raise notice 'OK: RLS bloqueó la captura de inventario sin pago';
end $$;
reset role;

-- Y con el pago al corriente sí captura.
update public.suscripciones set estado = 'activa', periodo_fin = now() + interval '30 days'
 where grupo_id = (select id from grupos where codigo='ARSSA');
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
insert into public.productos (empresa_id, sku, nombre)
values ((select id from public.empresas where codigo='ARS'), 'X-1', 'Prueba');
select count(*) as productos_arssa_al_corriente from public.productos;
reset role;

\echo '── 12. El resumen de socio no cruza organizaciones, y "socio" solo lo otorga la maestra'
-- Un admin de organización cliente no puede hacerse socio de la maestra.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$
begin
  insert into public.socios_organizacion (profile_id, grupo_id)
  values ('33333333-3333-3333-3333-333333333333', (select id from public.grupos where es_maestro));
  raise exception 'FALLA: un admin cliente se otorgó a sí mismo socio de la maestra';
exception when insufficient_privilege or raise_exception then
  if sqlerrm like 'FALLA%' then raise; end if;
  raise notice 'OK: solo la organización maestra otorga socios';
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select jsonb_array_length(public.fn_socio_resumen()->'grupos') as grupos_que_ve_arssa,
       public.fn_socio_resumen()->'grupos'->0->>'codigo' as cual;
do $$
begin
  perform public.fn_kpis_empresa((select id from public.empresas where codigo='AEP'));
  raise exception 'FALLA: ARSSA calculó los KPIs de una empresa de Loma';
exception when insufficient_privilege or raise_exception then
  if sqlerrm like 'FALLA%' then raise; end if;
  raise notice 'OK: fn_kpis_empresa no es invocable por un usuario autenticado';
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select jsonb_array_length(public.fn_socio_resumen()->'grupos') as grupos_que_ve_el_maestro;
reset role;
