-- Prueba de 20261118110000_requisiciones_horario_y_candado.sql: fuera del
-- horario un supervisor no manda requisiciones (dirección sí); quien pidió
-- edita solo el mismo día; una de días anteriores queda cerrada; admin y
-- corporativo siguen editando.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'super.horario@test'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'direccion.horario@test'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'corporativo.horario@test');
update public.profiles set nombre = 'Super horario', rol = 'supervisor',
  empresa_id = (select id from public.empresas where codigo = 'CSC'),
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'eeeeeeee-0000-0000-0000-000000000001';
update public.profiles set nombre = 'Dirección horario', rol = 'direccion', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'eeeeeeee-0000-0000-0000-000000000002';
update public.profiles set nombre = 'Corporativo horario', rol = 'corporativo', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'eeeeeeee-0000-0000-0000-000000000003';
insert into public.proyectos (id, nombre, empresa_id, responsable_id) values
  ('eeeeeeee-1111-0000-0000-000000000001', 'Obra horario', (select id from public.empresas where codigo = 'CSC'), 'eeeeeeee-0000-0000-0000-000000000001');

\echo '── 1. Horario sembrado y abierto todo el día para la prueba'
update public.requisiciones_horario set dias_semana = '{1,2,3,4,5,6,7}', hora_desde = '00:00', hora_hasta = '23:59'
  where grupo_id = (select id from public.grupos where codigo = 'LOMA');
do $$
begin
  if not public.fn_requisiciones_horario_abierto((select id from public.grupos where codigo = 'LOMA'), now()) then
    raise exception 'FALLA: el horario debería estar abierto';
  end if;
  raise notice 'OK: horario abierto (%)', public.fn_requisiciones_horario_texto((select id from public.grupos where codigo = 'LOMA'));
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);

\echo '── 2. Con horario abierto el supervisor pide y edita el mismo día'
insert into public.requisiciones (id, proyecto_id, empresa_id, solicitado_por) values
  ('eeeeeeee-2222-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001',
   (select id from public.empresas where codigo = 'CSC'), 'eeeeeeee-0000-0000-0000-000000000001');
insert into public.requisicion_lineas (id, requisicion_id, descripcion, cantidad_solicitada, unidad_medida) values
  ('eeeeeeee-3333-0000-0000-000000000001', 'eeeeeeee-2222-0000-0000-000000000001', 'Cemento', 10, 'bulto');
update public.requisiciones set comentario = 'editada hoy' where id = 'eeeeeeee-2222-0000-0000-000000000001';
do $$
begin
  if (select comentario from public.requisiciones where id = 'eeeeeeee-2222-0000-0000-000000000001') <> 'editada hoy' then
    raise exception 'FALLA: no pudo editar la requisición de hoy';
  end if;
  raise notice 'OK: pide y edita el mismo día';
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '── 3. Cerrar el horario: el supervisor ya no manda ni edita; corporativo sí manda'
update public.requisiciones_horario set hora_desde = '00:00', hora_hasta = '00:01'
  where grupo_id = (select id from public.grupos where codigo = 'LOMA');
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
do $$
begin
  begin
    insert into public.requisiciones (proyecto_id, empresa_id, solicitado_por) values
      ('eeeeeeee-1111-0000-0000-000000000001', (select id from public.empresas where codigo = 'CSC'), 'eeeeeeee-0000-0000-0000-000000000001');
    raise exception 'FALLA: mandó fuera de horario';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'OK: fuera de horario no manda (%)', sqlerrm;
  end;
end $$;
update public.requisiciones set comentario = 'editada cerrado' where id = 'eeeeeeee-2222-0000-0000-000000000001';
do $$
begin
  if (select comentario from public.requisiciones where id = 'eeeeeeee-2222-0000-0000-000000000001') = 'editada cerrado' then
    raise exception 'FALLA: editó con el horario cerrado';
  end if;
  raise notice 'OK: con horario cerrado no edita';
end $$;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000003', false);
insert into public.requisiciones (id, proyecto_id, empresa_id, solicitado_por) values
  ('eeeeeeee-2222-0000-0000-000000000002', 'eeeeeeee-1111-0000-0000-000000000001',
   (select id from public.empresas where codigo = 'CSC'), 'eeeeeeee-0000-0000-0000-000000000003');
do $$
begin
  if public.fn_requisiciones_horario_aplica('direccion') or public.fn_requisiciones_horario_aplica('almacen') then
    raise exception 'FALLA: el horario no debe aplicar a dirección ni almacén';
  end if;
  raise notice 'OK: corporativo manda fuera de horario; dirección y almacén no se sujetan';
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '── 4. Una requisición de ayer queda cerrada para quien la pidió; corporativo sí la edita'
update public.requisiciones_horario set dias_semana = '{1,2,3,4,5,6,7}', hora_desde = '00:00', hora_hasta = '23:59'
  where grupo_id = (select id from public.grupos where codigo = 'LOMA');
update public.requisiciones set created_at = now() - interval '1 day' where id = 'eeeeeeee-2222-0000-0000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
update public.requisiciones set comentario = 'editada ayer' where id = 'eeeeeeee-2222-0000-0000-000000000001';
update public.requisicion_lineas set cantidad_solicitada = 99 where id = 'eeeeeeee-3333-0000-0000-000000000001';
do $$
begin
  if (select comentario from public.requisiciones where id = 'eeeeeeee-2222-0000-0000-000000000001') = 'editada ayer' then
    raise exception 'FALLA: editó una requisición de ayer';
  end if;
  if (select cantidad_solicitada from public.requisicion_lineas where id = 'eeeeeeee-3333-0000-0000-000000000001') = 99 then
    raise exception 'FALLA: cambió un renglón de ayer';
  end if;
  if public.fn_requisicion_editable_por_solicitante('eeeeeeee-2222-0000-0000-000000000001') then
    raise exception 'FALLA: la función la da por editable';
  end if;
  raise notice 'OK: la de ayer quedó cerrada para quien la pidió';
end $$;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000003', false);
update public.requisiciones set comentario = 'corporativo edita' where id = 'eeeeeeee-2222-0000-0000-000000000001';
do $$
begin
  if (select comentario from public.requisiciones where id = 'eeeeeeee-2222-0000-0000-000000000001') <> 'corporativo edita' then
    raise exception 'FALLA: corporativo no pudo editar la de ayer';
  end if;
  raise notice 'OK: corporativo sigue editando';
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
