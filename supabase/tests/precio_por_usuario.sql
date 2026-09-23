-- Pruebas del cobro por usuario con escalones de volumen (migración
-- 20260923090007_precio_por_usuario.sql).
--
-- El cálculo vive en dos lados -- la base y el módulo puro
-- _shared/pagos/precios.ts -- porque uno cobra y el otro enseña el número en
-- pantalla. Estas pruebas fijan los mismos casos que precios.test.ts: si
-- alguien cambia un criterio en un lado y no en el otro, algo revienta aquí.
--
--   psql -d <base_con_migraciones> -f supabase/tests/precio_por_usuario.sql

\set ON_ERROR_STOP on

\echo '── 1. El escalón aplica a TODOS los usuarios (paquete, no tarifa marginal)'
select
  public.precio_unitario_centavos('estandar', 1) as u1,
  public.precio_unitario_centavos('estandar', 4) as u4,
  public.precio_unitario_centavos('estandar', 5) as u5,
  public.precio_unitario_centavos('estandar', 9) as u9,
  public.precio_unitario_centavos('estandar', 10) as u10,
  public.precio_unitario_centavos('estandar', 20) as u20,
  public.precio_unitario_centavos('estandar', 500) as u500;

do $$
begin
  -- 5 usuarios = 5 × $1,300 = $6,500, no 4 × $1,500 + 1 × $1,300
  if public.precio_unitario_centavos('estandar', 5) * 5 <> 650000 then
    raise exception 'FALLA: el escalón no se aplicó a todos los usuarios';
  end if;
  -- cero usuarios cotiza al precio de lista
  if public.precio_unitario_centavos('estandar', 0) <> 150000 then
    raise exception 'FALLA: cero usuarios no cotizó al precio de lista';
  end if;
  raise notice 'OK: 5 usuarios = $6,500 y cero usuarios cotiza a precio de lista';
end $$;

\echo '── 2. Solo se cobran usuarios activos con rol asignado'
insert into public.empresas (nombre, codigo, grupo_id)
values ('ARSSA Operadora', 'ARS', (select id from public.grupos where codigo='ARSSA'));

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aldo@arssa.test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dos@arssa.test'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'tres@arssa.test'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'pendiente@arssa.test'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'inactivo@arssa.test');

update public.profiles set rol='admin', grupo_id=(select id from grupos where codigo='ARSSA')
 where id='aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set rol='corporativo', grupo_id=(select id from grupos where codigo='ARSSA')
 where id='aaaaaaaa-0000-0000-0000-000000000002';
update public.profiles set rol='direccion', grupo_id=(select id from grupos where codigo='ARSSA')
 where id='aaaaaaaa-0000-0000-0000-000000000003';
-- el 4 se queda en 'pendiente' (nadie lo ha autorizado)
update public.profiles set rol='corporativo', activo=false, grupo_id=(select id from grupos where codigo='ARSSA')
 where id='aaaaaaaa-0000-0000-0000-000000000005';

do $$
declare n integer;
begin
  -- Se usa la interna: esta sesión es el dueño de la base, sin JWT, y la
  -- versión pública responde 0 a quien no está dentro de la organización.
  n := public.usuarios_facturables_interno((select id from public.grupos where codigo='ARSSA'));
  if n <> 3 then
    raise exception 'FALLA: se facturaron % usuarios, se esperaban 3 (el pendiente y el inactivo no cuentan)', n;
  end if;
  raise notice 'OK: 5 dados de alta, 3 facturables (el pendiente y el desactivado no cuentan)';
end $$;

\echo '── 3. La vista arma el desglose que ve el cliente (3 × $1,500 = $4,500)'
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select usuarios_facturables, precio_unitario_centavos, total_mensual_centavos
from public.v_suscripcion
where grupo_id = (select id from grupos where codigo='ARSSA');
reset role;

\echo '── 4. Dar de baja a alguien baja la factura (2 × $1,500 = $3,000)'
update public.profiles set activo = false where id='aaaaaaaa-0000-0000-0000-000000000003';
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select usuarios_facturables, total_mensual_centavos from public.v_suscripcion
 where grupo_id = (select id from grupos where codigo='ARSSA');
reset role;

\echo '   Y autorizar al pendiente la sube de nuevo (3 × $1,500 = $4,500)'
update public.profiles set rol='empresa',
  grupo_id=(select id from grupos where codigo='ARSSA'),
  empresa_id=(select id from empresas where grupo_id=(select id from grupos where codigo='ARSSA') limit 1)
 where id='aaaaaaaa-0000-0000-0000-000000000004';
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select usuarios_facturables, total_mensual_centavos from public.v_suscripcion
 where grupo_id = (select id from grupos where codigo='ARSSA');
reset role;

\echo '── 5. Un admin de organización cliente no puede editarse los precios'
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
begin
  update public.plan_escalones set precio_unitario_centavos = 1 where plan_clave = 'estandar';
  if found then raise exception 'FALLA: un admin de cliente se cambió el precio'; end if;
  raise notice 'OK: el update no alcanzó ninguna fila (RLS)';
end $$;
select count(*) as escalones_visibles from public.plan_escalones;
reset role;

\echo '── 6. El conteo de usuarios de OTRA organización no se puede consultar'
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
declare ajeno integer;
begin
  ajeno := public.usuarios_facturables((select id from public.grupos where codigo='LOMA'));
  if ajeno <> 0 then
    raise exception 'FALLA: un admin de ARSSA leyó % usuarios de Loma', ajeno;
  end if;
  raise notice 'OK: el conteo de otra organización responde 0, no la cifra real';
end $$;
do $$
begin
  perform public.usuarios_facturables_interno((select id from public.grupos where codigo='LOMA'));
  raise exception 'FALLA: la función interna quedó expuesta a usuarios autenticados';
exception when insufficient_privilege then
  raise notice 'OK: la función interna no es invocable por un usuario autenticado';
end $$;
reset role;
