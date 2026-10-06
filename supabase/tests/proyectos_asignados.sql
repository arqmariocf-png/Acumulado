-- Prueba de 20261005110000_proyectos_asignados_alcance_propio.sql:
-- un supervisor (aun con todas_las_empresas) ve solo sus obras asignadas y
-- las que ya tienen requisiciones suyas; un administrativo con alcance_propio
-- ve todas las obras de su empresa de "Maneja también" y en su principal
-- solo las asignadas; nadie se prende el alcance a sí mismo.

\set ON_ERROR_STOP on

update public.roles_alcance set multiempresa = true where rol = 'supervisor';
update public.roles_alcance set multiempresa = false where rol = 'administrativo';

insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-000000000001', 'supervisor.prueba@test'),
  ('dddddddd-0000-0000-0000-000000000002', 'timo.prueba@test'),
  ('dddddddd-0000-0000-0000-000000000003', 'empresa.prueba@test');
update public.profiles set nombre = 'Supervisor prueba', rol = 'supervisor', todas_las_empresas = true,
  empresa_id = (select id from public.empresas where codigo = 'ERG'),
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'dddddddd-0000-0000-0000-000000000001';
update public.profiles set nombre = 'Timo prueba', rol = 'administrativo',
  empresa_id = (select id from public.empresas where codigo = 'CSC'),
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'dddddddd-0000-0000-0000-000000000002';
update public.profiles set nombre = 'Empresa prueba', rol = 'empresa',
  empresa_id = (select id from public.empresas where codigo = 'ERG'),
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'dddddddd-0000-0000-0000-000000000003';
insert into public.permisos_modulo (profile_id, modulo)
values ('dddddddd-0000-0000-0000-000000000001', 'proyectos'), ('dddddddd-0000-0000-0000-000000000002', 'proyectos');
insert into public.profile_empresas (profile_id, empresa_id)
values ('dddddddd-0000-0000-0000-000000000002', (select id from public.empresas where codigo = 'MCF'));

insert into public.proyectos (id, nombre, empresa_id, responsable_id, comprador_id) values
  ('dddddddd-1111-0000-0000-000000000001', 'ERG asignada', (select id from public.empresas where codigo = 'ERG'), 'dddddddd-0000-0000-0000-000000000001', null),
  ('dddddddd-1111-0000-0000-000000000002', 'ERG ajena', (select id from public.empresas where codigo = 'ERG'), null, null),
  ('dddddddd-1111-0000-0000-000000000003', 'ERG con su requisición', (select id from public.empresas where codigo = 'ERG'), null, null),
  ('dddddddd-1111-0000-0000-000000000004', 'AEP ajena', (select id from public.empresas where codigo = 'AEP'), null, null),
  ('dddddddd-1111-0000-0000-000000000005', 'CSC de Timo', (select id from public.empresas where codigo = 'CSC'), null, 'dddddddd-0000-0000-0000-000000000002'),
  ('dddddddd-1111-0000-0000-000000000006', 'CSC ajena', (select id from public.empresas where codigo = 'CSC'), null, null),
  ('dddddddd-1111-0000-0000-000000000007', 'MCF sin asignar', (select id from public.empresas where codigo = 'MCF'), null, null);
insert into public.requisiciones (id, proyecto_id, empresa_id, solicitado_por) values
  ('dddddddd-2222-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000003',
   (select id from public.empresas where codigo = 'ERG'), 'dddddddd-0000-0000-0000-000000000001'),
  ('dddddddd-2222-0000-0000-000000000002', 'dddddddd-1111-0000-0000-000000000002',
   (select id from public.empresas where codigo = 'ERG'), 'dddddddd-0000-0000-0000-000000000003');

set role authenticated;

\echo '── 1. Supervisor con todas las empresas: solo asignada y la de su requisición'
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', false);
do $$
declare v text;
begin
  select string_agg(nombre, ', ' order by nombre) into v from public.proyectos where id::text like 'dddddddd-1111%';
  if v is distinct from 'ERG asignada, ERG con su requisición' then raise exception 'FALLA: supervisor ve %', v; end if;
  if exists (select 1 from public.requisiciones where id = 'dddddddd-2222-0000-0000-000000000002') then
    raise exception 'FALLA: supervisor ve la requisición de una obra ajena';
  end if;
  raise notice 'OK: supervisor ve %', v;
end $$;

\echo '── 2. Nadie se prende el alcance a sí mismo'
do $$
begin
  begin
    update public.profiles set alcance_propio = true where id = 'dddddddd-0000-0000-0000-000000000001';
    raise exception 'FALLA: el supervisor se prendió alcance_propio';
  exception when insufficient_privilege then
    raise notice 'OK: %', sqlerrm;
  end;
end $$;

\echo '── 3. Timo sin alcance propio: solo su obra asignada, MCF fuera del alcance'
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000002', false);
do $$
declare v text;
begin
  select string_agg(nombre, ', ' order by nombre) into v from public.proyectos where id::text like 'dddddddd-1111%';
  if v is distinct from 'CSC de Timo' then raise exception 'FALLA: Timo ve %', v; end if;
  if (select public.empresa_en_alcance((select id from public.empresas where codigo = 'MCF'))) then
    raise exception 'FALLA: MCF en alcance sin alcance_propio';
  end if;
  raise notice 'OK: Timo ve %', v;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set alcance_propio = true where id = 'dddddddd-0000-0000-0000-000000000002';
set role authenticated;

\echo '── 4. Timo con alcance propio: todas las de MCF, en CSC solo la suya, y pide en MCF'
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000002', false);
do $$
declare v text;
begin
  select string_agg(nombre, ', ' order by nombre) into v from public.proyectos where id::text like 'dddddddd-1111%';
  if v is distinct from 'CSC de Timo, MCF sin asignar' then raise exception 'FALLA: Timo ve %', v; end if;
  if not (select (public.fn_mi_alcance() ->> 'multiempresa')::boolean) then
    raise exception 'FALLA: fn_mi_alcance no marca multiempresa';
  end if;
  raise notice 'OK: Timo ve %', v;
end $$;
insert into public.requisiciones (proyecto_id, empresa_id, solicitado_por)
values ('dddddddd-1111-0000-0000-000000000007', (select id from public.empresas where codigo = 'MCF'), 'dddddddd-0000-0000-0000-000000000002');

\echo '── 5. El rol empresa sigue viendo todas las de su empresa'
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000003', false);
do $$
declare n int;
begin
  select count(*) into n from public.proyectos where id::text like 'dddddddd-1111%';
  if n <> 3 then raise exception 'FALLA: empresa ve % (esperaba 3 de ERG)', n; end if;
  raise notice 'OK: empresa ve sus 3 obras de ERG';
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '── 6. Responsable de checador: ve las marcas de todos los de su organización'
insert into auth.users (id, email) values ('dddddddd-0000-0000-0000-000000000009', 'checador.prueba@test');
update public.profiles set nombre = 'Checador prueba', rol = 'administrativo',
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'dddddddd-0000-0000-0000-000000000009';
do $$
begin
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000009', false);
  if public.auth_ve_checador_de('dddddddd-0000-0000-0000-000000000001') then
    raise exception 'FALLA: sin permiso ve el checador ajeno';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  insert into public.permisos_modulo (profile_id, modulo) values ('dddddddd-0000-0000-0000-000000000009', 'checador');
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000009', false);
  if not public.auth_ve_checador_de('dddddddd-0000-0000-0000-000000000001') then
    raise exception 'FALLA: con permiso no ve el checador de su organización';
  end if;
  perform set_config('request.jwt.claim.sub', '', false);
  raise notice 'OK: responsable de checador ve a su organización';
end $$;
