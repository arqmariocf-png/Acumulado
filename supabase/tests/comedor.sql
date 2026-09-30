-- Prueba del módulo Comedor (20260930150000_modulo_comedor.sql).
-- Demuestra que BLOQUEA: otra organización no ve el menú ni pedidos; sin
-- expediente activo no se pide; un trabajador no ve pedidos ajenos; solo la
-- cocina entrega; nómina descuenta solo lo entregado.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'trabajador.aep@test'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'otro.trabajador@test'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'cocina@test'),
  ('eeeeeeee-0000-0000-0000-000000000004', 'rh.loma@test'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'corp.arssa@test'),
  ('eeeeeeee-0000-0000-0000-000000000006', 'sin.expediente@test');

update public.profiles set nombre = 'Trabajador AEP', rol = 'operativo', grupo_id = (select id from public.grupos where codigo = 'LOMA'),
  empresa_id = (select id from public.empresas where codigo = 'AEP') where id = 'eeeeeeee-0000-0000-0000-000000000001';
update public.profiles set nombre = 'Otro Trabajador', rol = 'operativo', grupo_id = (select id from public.grupos where codigo = 'LOMA'),
  empresa_id = (select id from public.empresas where codigo = 'AEP') where id = 'eeeeeeee-0000-0000-0000-000000000002';
update public.profiles set nombre = 'Cocina', rol = 'operativo', grupo_id = (select id from public.grupos where codigo = 'LOMA'),
  empresa_id = (select id from public.empresas where codigo = 'COM') where id = 'eeeeeeee-0000-0000-0000-000000000003';
update public.profiles set nombre = 'RH Loma', rol = 'rh', grupo_id = (select id from public.grupos where codigo = 'LOMA'),
  todas_las_empresas = true where id = 'eeeeeeee-0000-0000-0000-000000000004';
update public.profiles set nombre = 'Corporativo ARSSA', rol = 'corporativo', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'ARSSA') where id = 'eeeeeeee-0000-0000-0000-000000000005';
update public.profiles set nombre = 'Sin Expediente', rol = 'operativo', grupo_id = (select id from public.grupos where codigo = 'LOMA'),
  empresa_id = (select id from public.empresas where codigo = 'AEP') where id = 'eeeeeeee-0000-0000-0000-000000000006';

insert into public.permisos_modulo (profile_id, modulo) values ('eeeeeeee-0000-0000-0000-000000000003', 'comedor');
insert into public.personal (nombre, profile_id, activo, grupo_id, fecha_ingreso) values
  ('Trabajador AEP', 'eeeeeeee-0000-0000-0000-000000000001', true, (select id from public.grupos where codigo = 'LOMA'), current_date - 30),
  ('Otro Trabajador', 'eeeeeeee-0000-0000-0000-000000000002', true, (select id from public.grupos where codigo = 'LOMA'), current_date - 30);

insert into public.comedor_platillos (empresa_id, nombre, precio) values
  ((select id from public.empresas where codigo = 'COM'), 'Comida corrida', 65),
  ((select id from public.empresas where codigo = 'COM'), 'Agua del día', 15);
insert into public.comedor_menu (empresa_id, fecha, platillo_id)
select p.empresa_id, current_date + 1, p.id from public.comedor_platillos p;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

\echo '── 1. El trabajador pide para mañana y ve su total'
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
select public.fn_comedor_pedir(current_date + 1, jsonb_build_array(
  jsonb_build_object('platillo_id', (select id from public.comedor_platillos where nombre = 'Comida corrida'), 'cantidad', 1),
  jsonb_build_object('platillo_id', (select id from public.comedor_platillos where nombre = 'Agua del día'), 'cantidad', 2)));
do $$
declare t numeric;
begin
  select total into t from public.v_comedor_pedidos where profile_id = 'eeeeeeee-0000-0000-0000-000000000001';
  if t is distinct from 95 then raise exception 'FALLA: el total debía ser 95 y es %', t; end if;
  raise notice 'OK: pedido de 95 (65 + 2 × 15)';
end $$;

\echo '── 2. Otro trabajador no ve pedidos ajenos'
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000002', false);
do $$
begin
  if exists (select 1 from public.comedor_pedidos where profile_id = 'eeeeeeee-0000-0000-0000-000000000001') then
    raise exception 'FALLA: un trabajador vio el pedido de otro';
  end if;
  begin
    perform public.fn_comedor_entregar((select id from public.comedor_pedidos limit 1), true);
    raise exception 'FALLA: un trabajador marcó una entrega';
  exception when insufficient_privilege then raise notice 'OK: solo la cocina entrega';
  end;
  raise notice 'OK: no ve pedidos ajenos';
end $$;

\echo '── 3. Sin expediente activo no se pide'
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000006', false);
do $$
begin
  perform public.fn_comedor_pedir(current_date + 1, jsonb_build_array(jsonb_build_object('platillo_id', (select id from public.comedor_platillos where nombre = 'Agua del día'), 'cantidad', 1)));
  raise exception 'FALLA: pidió sin expediente';
exception when raise_exception then
  if sqlerrm like 'FALLA%' then raise; end if;
  raise notice 'OK: sin expediente no pide (%)', left(sqlerrm, 60);
end $$;

\echo '── 4. Otra organización no ve el menú ni los pedidos'
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', false);
do $$
begin
  if exists (select 1 from public.comedor_platillos) or exists (select 1 from public.comedor_pedidos) or exists (select 1 from public.comedor_menu) then
    raise exception 'FALLA: ARSSA vio el comedor de Loma';
  end if;
  raise notice 'OK: ARSSA no ve nada del comedor';
end $$;

\echo '── 5. La cocina entrega; nómina descuenta solo lo entregado'
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000002', false);
select public.fn_comedor_pedir(current_date + 1, jsonb_build_array(jsonb_build_object('platillo_id', (select id from public.comedor_platillos where nombre = 'Agua del día'), 'cantidad', 1)));
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000003', false);
select public.fn_comedor_entregar((select id from public.comedor_pedidos where profile_id = 'eeeeeeee-0000-0000-0000-000000000001'), true);
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000004', false);
do $$
declare n int;
begin
  n := public.fn_comedor_aplicar_descuento(current_date, current_date + 7, (select id from public.empresas where codigo = 'AEP'), 'Nómina prueba');
  if n <> 1 then raise exception 'FALLA: debía aplicar 1 pedido entregado y aplicó %', n; end if;
  raise notice 'OK: nómina aplicó solo el entregado';
end $$;

\echo '── 6. Ya descontado no se regresa a pedido'
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000003', false);
do $$
begin
  perform public.fn_comedor_entregar((select id from public.comedor_pedidos where profile_id = 'eeeeeeee-0000-0000-0000-000000000001'), false);
  raise exception 'FALLA: se reabrió un pedido ya descontado';
exception when raise_exception then
  if sqlerrm like 'FALLA%' then raise; end if;
  raise notice 'OK: lo descontado queda cerrado';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
