-- Prueba de 20261021220000_deuda_financiera.sql y 20261021230000_deuda_programacion_pagos.sql:
-- dirección da de alta un crédito, sus pagos van a Programación de pagos y
-- vuelven (pagado en Tesorería → registrado en el crédito y al revés),
-- deshacer regresa el pago a pendiente, liquidar cancela lo pendiente; el
-- saldo se calcula; contabilidad solo consulta y almacén no ve nada.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-000000000001', 'direccion.deuda@test'),
  ('dddddddd-0000-0000-0000-000000000002', 'conta.deuda@test'),
  ('dddddddd-0000-0000-0000-000000000003', 'almacen.deuda@test');
update public.profiles set nombre = 'Dirección deuda', rol = 'direccion', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'dddddddd-0000-0000-0000-000000000001';
update public.profiles set nombre = 'Contabilidad deuda', rol = 'corporativo', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'dddddddd-0000-0000-0000-000000000002';
update public.profiles set nombre = 'Almacén deuda', rol = 'almacen', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'dddddddd-0000-0000-0000-000000000003';
insert into public.permisos_modulo (profile_id, modulo) values ('dddddddd-0000-0000-0000-000000000002', 'contabilidad');
update public.roles_alcance set multiempresa = true where rol in ('direccion', 'corporativo', 'almacen');

set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', false);

\echo '── 1. Alta del crédito: folio por empresa y saldo = monto'
insert into public.deuda_creditos (id, empresa_id, acreedor, monto, fecha_disposicion, tasa_anual, plazo_meses, primer_pago, destino)
values ('dddddddd-1111-0000-0000-000000000001', (select id from public.empresas where codigo = 'CSC'), '  BBVA   México ', 120000, '2026-10-01', 12, 12, '2026-11-01', 'Capital de trabajo');
do $$
declare v record;
begin
  select folio, acreedor, saldo into v from public.v_deuda_creditos where id = 'dddddddd-1111-0000-0000-000000000001';
  if v.folio <> 'DF-CSC-0001' or v.acreedor <> 'BBVA México' or v.saldo <> 120000 then
    raise exception 'FALLA: % / % / %', v.folio, v.acreedor, v.saldo;
  end if;
  raise notice 'OK: % saldo %', v.folio, v.saldo;
end $$;

\echo '── 2. Los pagos van a Programación de pagos (sin duplicar)'
do $$
declare n int;
begin
  n := public.fn_deuda_enviar_pagos('dddddddd-1111-0000-0000-000000000001',
    '[{"numero":1,"de":12,"fecha":"2026-11-01","capital":9461.85,"interes":1200,"iva":192,"total":10853.85},
      {"numero":2,"de":12,"fecha":"2026-12-01","capital":9556.47,"interes":1105.38,"iva":176.86,"total":10838.71}]');
  if n <> 2 then raise exception 'FALLA: % enviados', n; end if;
  n := public.fn_deuda_enviar_pagos('dddddddd-1111-0000-0000-000000000001',
    '[{"numero":1,"de":12,"fecha":"2026-11-01","capital":9461.85,"interes":1200,"iva":192,"total":10853.85}]');
  if n <> 0 then raise exception 'FALLA: reenviar duplicó (%)', n; end if;
  if (select count(*) from public.pagos_programados where deuda_credito_id = 'dddddddd-1111-0000-0000-000000000001' and tipo = 'prestamo') <> 2 then
    raise exception 'FALLA: no quedaron 2 pagos programados';
  end if;
  raise notice 'OK: 2 pagos en Programación';
end $$;

\echo '── 3. Tesorería paga el 1 → queda registrado en el crédito y baja el saldo'
update public.pagos_programados set estatus = 'pagado', pagado_en = '2026-11-01'
 where deuda_credito_id = 'dddddddd-1111-0000-0000-000000000001' and deuda_numero = 1;
do $$
declare v record;
begin
  select saldo, numeros_pagados into v from public.v_deuda_creditos where id = 'dddddddd-1111-0000-0000-000000000001';
  if v.saldo <> 110538.15 or v.numeros_pagados <> '{1}' then raise exception 'FALLA: saldo % pagados %', v.saldo, v.numeros_pagados; end if;
  raise notice 'OK: saldo %', v.saldo;
end $$;

\echo '── 4. Registrar el 2 en el crédito → su pago programado queda pagado; deshacer lo regresa'
insert into public.deuda_pagos (credito_id, fecha, capital, interes, iva_interes, numero)
values ('dddddddd-1111-0000-0000-000000000001', '2026-12-01', 9556.47, 1105.38, 176.86, 2);
do $$
begin
  if (select estatus from public.pagos_programados where deuda_credito_id = 'dddddddd-1111-0000-0000-000000000001' and deuda_numero = 2) <> 'pagado' then
    raise exception 'FALLA: el programado 2 no quedó pagado';
  end if;
  raise notice 'OK: programado 2 pagado';
end $$;
delete from public.deuda_pagos where credito_id = 'dddddddd-1111-0000-0000-000000000001' and numero = 2;
do $$
begin
  if (select estatus from public.pagos_programados where deuda_credito_id = 'dddddddd-1111-0000-0000-000000000001' and deuda_numero = 2) <> 'pendiente' then
    raise exception 'FALLA: deshacer no regresó el programado 2 a pendiente';
  end if;
  raise notice 'OK: deshacer regresa a pendiente';
end $$;

\echo '── 5. Tesorería no regresa a pendiente un pago ya registrado en el crédito'
do $$
begin
  begin
    update public.pagos_programados set estatus = 'pendiente'
     where deuda_credito_id = 'dddddddd-1111-0000-0000-000000000001' and deuda_numero = 1;
    raise exception 'FALLA: se regresó a pendiente';
  exception when raise_exception then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'OK: bloqueado (%)', sqlerrm;
  end;
end $$;

\echo '── 6. Liquidar cancela lo pendiente'
update public.deuda_creditos set estatus = 'liquidado' where id = 'dddddddd-1111-0000-0000-000000000001';
do $$
declare v text;
begin
  select string_agg(deuda_numero || ':' || estatus, ' ' order by deuda_numero) into v
    from public.pagos_programados where deuda_credito_id = 'dddddddd-1111-0000-0000-000000000001';
  if v <> '1:pagado 2:cancelado' then raise exception 'FALLA: %', v; end if;
  raise notice 'OK: %', v;
end $$;

\echo '── 7. Contabilidad consulta pero no captura; almacén no ve'
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000002', false);
do $$
begin
  if (select count(*) from public.v_deuda_creditos) <> 1 then raise exception 'FALLA: contabilidad no ve el crédito'; end if;
  begin
    insert into public.deuda_creditos (empresa_id, acreedor, monto, fecha_disposicion)
    values ((select id from public.empresas where codigo = 'CSC'), 'X', 1, '2026-01-01');
    raise exception 'FALLA: contabilidad capturó';
  exception when insufficient_privilege then
    raise notice 'OK: contabilidad solo consulta';
  end;
end $$;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000003', false);
do $$
begin
  if exists (select 1 from public.v_deuda_creditos) or exists (select 1 from public.deuda_pagos) then
    raise exception 'FALLA: almacén ve deuda';
  end if;
  raise notice 'OK: almacén no ve deuda';
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
