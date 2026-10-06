-- Prueba de 20261006100000_epp_rh.sql: RH entrega EPP a una persona con cargo
-- a una obra, pide a compras lo que no hay, la vigencia se calcula, lo
-- perdido propone descuento, y solo RH (y almacén en lectura) lo ve.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000001', 'raul.prueba@test'),
  ('cccccccc-0000-0000-0000-000000000002', 'alma.epp@test'),
  ('cccccccc-0000-0000-0000-000000000003', 'super.epp@test');
update public.profiles set nombre = 'Raúl prueba', rol = 'rh', rh_nivel = 'administrativo', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'cccccccc-0000-0000-0000-000000000001';
update public.profiles set nombre = 'Alma EPP', rol = 'almacen', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'cccccccc-0000-0000-0000-000000000002';
update public.profiles set nombre = 'Super EPP', rol = 'supervisor', empresa_id = (select id from public.empresas where codigo = 'CSC'),
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'cccccccc-0000-0000-0000-000000000003';
insert into public.personal (id, nombre, grupo_id, fecha_ingreso)
values ('cccccccc-4444-0000-0000-000000000001', 'Trabajador EPP', (select id from public.grupos where codigo = 'LOMA'), '2026-01-01');
insert into public.proyectos (id, nombre, empresa_id)
values ('cccccccc-1111-0000-0000-000000000001', 'Obra EPP', (select id from public.empresas where codigo = 'CSC'));

set role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000001', false);

\echo '── 1. RH da de alta la entrega; folio y empresa salen de la obra'
insert into public.epp_asignaciones (id, proyecto_id, personal_id)
values ('cccccccc-2222-0000-0000-000000000001', 'cccccccc-1111-0000-0000-000000000001', 'cccccccc-4444-0000-0000-000000000001');
insert into public.epp_asignacion_lineas (id, asignacion_id, descripcion, talla, cantidad, costo_unitario, vigencia_meses, origen) values
  ('cccccccc-3333-0000-0000-000000000001', 'cccccccc-2222-0000-0000-000000000001', 'Casco', null, 1, 150, 12, 'bodega'),
  ('cccccccc-3333-0000-0000-000000000002', 'cccccccc-2222-0000-0000-000000000001', 'Botas dieléctricas', '27', 1, 900, 6, 'compra');
do $$
declare v record;
begin
  select a.folio, e.codigo into v from public.epp_asignaciones a join public.empresas e on e.id = a.empresa_id
   where a.id = 'cccccccc-2222-0000-0000-000000000001';
  if v.folio <> 'EPP-CSC-0001' or v.codigo <> 'CSC' then raise exception 'FALLA: folio % empresa %', v.folio, v.codigo; end if;
  raise notice 'OK: %', v.folio;
end $$;

\echo '── 2. Pedir a compras: requisición en la obra con solo lo que se compra'
do $$
declare v_req uuid; v_n int; v_desc text;
begin
  v_req := public.fn_epp_pedir_compra('cccccccc-2222-0000-0000-000000000001');
  select count(*), min(descripcion) into v_n, v_desc from public.requisicion_lineas where requisicion_id = v_req;
  if v_n <> 1 or v_desc <> 'EPP: Botas dieléctricas talla 27' then raise exception 'FALLA: % renglones (%)', v_n, v_desc; end if;
  if (select proyecto_id from public.requisiciones where id = v_req) <> 'cccccccc-1111-0000-0000-000000000001' then
    raise exception 'FALLA: la requisición no quedó en la obra';
  end if;
  raise notice 'OK: requisición con "%"', v_desc;
end $$;

\echo '── 3. Entrega con vigencia y pérdida con descuento'
update public.epp_asignacion_lineas set estado = 'entregado', entregado_en = '2026-10-06' where id = 'cccccccc-3333-0000-0000-000000000001';
update public.epp_asignacion_lineas set estado = 'perdido' where id = 'cccccccc-3333-0000-0000-000000000002';
do $$
declare v record;
begin
  select vence_el into v from public.epp_asignacion_lineas where id = 'cccccccc-3333-0000-0000-000000000001';
  if v.vence_el <> '2027-10-06' then raise exception 'FALLA: vence %', v.vence_el; end if;
  select descuento_monto into v from public.epp_asignacion_lineas where id = 'cccccccc-3333-0000-0000-000000000002';
  if v.descuento_monto <> 900 then raise exception 'FALLA: descuento %', v.descuento_monto; end if;
  raise notice 'OK: vence 2027-10-06 y descuento 900';
end $$;
update public.epp_asignacion_lineas set descuento_aplicado_en = '2026-10-15' where id = 'cccccccc-3333-0000-0000-000000000002';
do $$
begin
  begin
    update public.epp_asignacion_lineas set descuento_monto = 1 where id = 'cccccccc-3333-0000-0000-000000000002';
    raise exception 'FALLA: se cambió un descuento ya aplicado';
  exception when raise_exception then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'OK: %', sqlerrm;
  end;
end $$;

\echo '── 4. Almacén lo ve pero no lo cambia; un supervisor no lo ve'
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000002', false);
do $$
declare n int;
begin
  select count(*) into n from public.epp_asignacion_lineas;
  if n <> 2 then raise exception 'FALLA: almacén ve % líneas', n; end if;
  update public.epp_asignacion_lineas set nota = 'x' where id = 'cccccccc-3333-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: almacén modificó EPP'; end if;
  raise notice 'OK: almacén solo lectura';
end $$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false);
do $$
begin
  if exists (select 1 from public.epp_asignaciones) then raise exception 'FALLA: el supervisor ve EPP'; end if;
  begin
    perform public.fn_epp_pedir_compra('cccccccc-2222-0000-0000-000000000001');
    raise exception 'FALLA: el supervisor pidió compra';
  exception when insufficient_privilege then
    raise notice 'OK: supervisor sin acceso (%)', sqlerrm;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
