-- Prueba de 20261118090000_encargados_obra_confirmar_entrega.sql: un
-- supervisor encargado de varias obras las ve y pide requisiciones en ellas;
-- "ya lo recibí en obra" cierra los renglones; quien no es de la obra no
-- confirma; el recordatorio solo toca requisiciones con material.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('ffffffff-0000-0000-0000-000000000001', 'super.encargado@test'),
  ('ffffffff-0000-0000-0000-000000000002', 'ajeno.encargado@test'),
  ('ffffffff-0000-0000-0000-000000000003', 'direccion.encargado@test');
update public.profiles set nombre = 'Super encargado', rol = 'supervisor',
  empresa_id = (select id from public.empresas where codigo = 'ERG'),
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'ffffffff-0000-0000-0000-000000000001';
update public.profiles set nombre = 'Ajeno', rol = 'supervisor',
  empresa_id = (select id from public.empresas where codigo = 'ERG'),
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'ffffffff-0000-0000-0000-000000000002';
update public.profiles set nombre = 'Dirección prueba', rol = 'direccion', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'ffffffff-0000-0000-0000-000000000003';

insert into public.proyectos (id, nombre, empresa_id) values
  ('ffffffff-1111-0000-0000-000000000001', 'Obra encargada A', (select id from public.empresas where codigo = 'CSC')),
  ('ffffffff-1111-0000-0000-000000000002', 'Obra encargada B', (select id from public.empresas where codigo = 'MCF')),
  ('ffffffff-1111-0000-0000-000000000003', 'Obra ajena', (select id from public.empresas where codigo = 'CSC'));

-- El candado de horario (20261118110000) bloquea a quien pide en obra fuera
-- de lun-sáb 08:00-18:00 MX; la validación corre a cualquier hora.
update public.requisiciones_horario set dias_semana = '{1,2,3,4,5,6,7}', hora_desde = '00:00', hora_hasta = '23:59'
  where grupo_id = (select id from public.grupos where codigo = 'LOMA');

set role authenticated;

\echo '── 1. Dirección asigna al supervisor a dos obras de empresas distintas'
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000003', false);
insert into public.proyecto_encargados (proyecto_id, profile_id) values
  ('ffffffff-1111-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001'),
  ('ffffffff-1111-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001');
do $$
begin
  if (select count(*) from public.proyecto_encargados where profile_id = 'ffffffff-0000-0000-0000-000000000001') <> 2 then
    raise exception 'FALLA: dirección no asignó las dos obras';
  end if;
  if (select count(*) from public.fn_encargados_personas()) < 2 then raise exception 'FALLA: dirección no lista personas'; end if;
  raise notice 'OK: dirección asignó dos obras';
end $$;

\echo '── 2. El supervisor ve solo sus dos obras y pide en ellas'
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000001', false);
do $$
declare v text;
begin
  select string_agg(nombre, ', ' order by nombre) into v from public.proyectos where id::text like 'ffffffff-1111%';
  if v is distinct from 'Obra encargada A, Obra encargada B' then raise exception 'FALLA: supervisor ve %', v; end if;
  raise notice 'OK: supervisor ve %', v;
end $$;
insert into public.requisiciones (id, proyecto_id, empresa_id, solicitado_por) values
  ('ffffffff-2222-0000-0000-000000000001', 'ffffffff-1111-0000-0000-000000000002',
   (select id from public.empresas where codigo = 'MCF'), 'ffffffff-0000-0000-0000-000000000001');
insert into public.requisicion_lineas (id, requisicion_id, descripcion, cantidad_solicitada, unidad_medida) values
  ('ffffffff-3333-0000-0000-000000000001', 'ffffffff-2222-0000-0000-000000000001', 'Cemento', 10, 'bulto'),
  ('ffffffff-3333-0000-0000-000000000002', 'ffffffff-2222-0000-0000-000000000001', 'Arena', 3, 'm3');
do $$
begin
  begin
    insert into public.requisiciones (proyecto_id, empresa_id, solicitado_por) values
      ('ffffffff-1111-0000-0000-000000000003', (select id from public.empresas where codigo = 'CSC'), 'ffffffff-0000-0000-0000-000000000001');
    raise exception 'FALLA: pidió en una obra ajena';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'OK: en obra ajena no pide (%)', sqlerrm;
  end;
end $$;

\echo '── 3. Un ajeno no confirma; el supervisor sí, y la requisición queda recibida'
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000002', false);
do $$
begin
  begin
    perform public.fn_requisicion_confirmar_obra('ffffffff-2222-0000-0000-000000000001', null);
    raise exception 'FALLA: un ajeno confirmó';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'OK: ajeno bloqueado (%)', sqlerrm;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000001', false);
do $$
declare n int; v_etapa text; v_obra numeric;
begin
  select public.fn_requisicion_confirmar_obra('ffffffff-2222-0000-0000-000000000001', 'Lo trajo el proveedor') into n;
  if n <> 2 then raise exception 'FALLA: cerró % renglones (esperaba 2)', n; end if;
  select etapa into v_etapa from public.requisiciones where id = 'ffffffff-2222-0000-0000-000000000001';
  if v_etapa <> 'recibida' then raise exception 'FALLA: etapa % (esperaba recibida)', v_etapa; end if;
  select sum(recibido_obra) into v_obra from public.v_requisicion_linea_entrega where requisicion_id = 'ffffffff-2222-0000-0000-000000000001';
  if v_obra <> 13 then raise exception 'FALLA: recibido en obra % (esperaba 13)', v_obra; end if;
  -- Repetir no duplica nada.
  select public.fn_requisicion_confirmar_obra('ffffffff-2222-0000-0000-000000000001', null) into n;
  if n <> 0 then raise exception 'FALLA: al repetir cerró % renglones', n; end if;
  raise notice 'OK: confirmada en obra, etapa recibida, sin duplicar';
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '── 4. El recordatorio no toca requisiciones recibidas ni recién creadas'
do $$
declare n int;
begin
  select public.fn_requisiciones_recordar_entregas() into n;
  if exists (select 1 from public.requisiciones where id = 'ffffffff-2222-0000-0000-000000000001' and recordatorio_entrega_en is not null) then
    raise exception 'FALLA: recordó una requisición ya recibida';
  end if;
  raise notice 'OK: recordatorio corre (% avisos) sin tocar la recibida', n;
end $$;
