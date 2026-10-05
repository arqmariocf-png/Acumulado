-- Prueba de 20261005100000_requisicion_entrega_obra.sql: recibir en bodega
-- ya no completa la requisición; envío parcial a obra, confirmación de quien
-- pidió, parte que se queda en bodega, y quién puede marcar qué.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'alma.prueba@test'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'residente.prueba@test');
update public.profiles set nombre = 'Alma prueba', rol = 'almacen', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'eeeeeeee-0000-0000-0000-000000000001';
update public.profiles set nombre = 'Residente prueba', rol = 'supervisor',
  empresa_id = (select id from public.empresas where codigo = 'AEP'),
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'eeeeeeee-0000-0000-0000-000000000002';

insert into public.proyectos (id, nombre, empresa_id)
values ('eeeeeeee-1111-0000-0000-000000000001', 'Obra prueba entrega', (select id from public.empresas where codigo = 'AEP'));
insert into public.requisiciones (id, proyecto_id, empresa_id, solicitado_por)
values ('eeeeeeee-2222-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001',
        (select id from public.empresas where codigo = 'AEP'), 'eeeeeeee-0000-0000-0000-000000000002');
insert into public.requisicion_lineas (id, requisicion_id, descripcion, cantidad_solicitada, unidad_medida) values
  ('eeeeeeee-3333-0000-0000-000000000001', 'eeeeeeee-2222-0000-0000-000000000001', 'Loseta', 10, 'm2'),
  ('eeeeeeee-3333-0000-0000-000000000002', 'eeeeeeee-2222-0000-0000-000000000001', 'Pegazulejo', 4, 'bulto');

\echo '── 1. Alma recibe todo en bodega: la requisición queda en bodega, no completa'
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
insert into public.requisicion_linea_eventos (requisicion_linea_id, tipo, cantidad) values
  ('eeeeeeee-3333-0000-0000-000000000001', 'pedido', 10),
  ('eeeeeeee-3333-0000-0000-000000000001', 'en_bodega', 10),
  ('eeeeeeee-3333-0000-0000-000000000002', 'en_bodega', 4);
do $$
declare v record;
begin
  select etapa into v from public.requisiciones where id = 'eeeeeeee-2222-0000-0000-000000000001';
  if v.etapa <> 'en_bodega' then raise exception 'FALLA: etapa % (esperaba en_bodega)', v.etapa; end if;
  select * into v from public.v_requisicion_avance where requisicion_id = 'eeeeeeee-2222-0000-0000-000000000001';
  if v.avance_pct <> 50 then raise exception 'FALLA: avance % (esperaba 50)', v.avance_pct; end if;
  raise notice 'OK: en bodega con avance %%%', v.avance_pct;
end $$;

\echo '── 2. Almacén no puede confirmar lo recibido en obra'
do $$
begin
  begin
    insert into public.requisicion_linea_eventos (requisicion_linea_id, tipo, cantidad) values ('eeeeeeee-3333-0000-0000-000000000001', 'entregado', 10);
    raise exception 'FALLA: almacén confirmó obra';
  exception when raise_exception then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'OK: %', sqlerrm;
  end;
end $$;

\echo '── 3. Envío parcial, no se manda más de lo que hay en bodega, y una parte se queda en bodega'
insert into public.requisicion_linea_eventos (requisicion_linea_id, tipo, cantidad) values
  ('eeeeeeee-3333-0000-0000-000000000001', 'enviado_obra', 6),
  ('eeeeeeee-3333-0000-0000-000000000002', 'queda_bodega', 4);
do $$
begin
  begin
    insert into public.requisicion_linea_eventos (requisicion_linea_id, tipo, cantidad) values ('eeeeeeee-3333-0000-0000-000000000001', 'enviado_obra', 5);
    raise exception 'FALLA: se envió más de lo que hay en bodega';
  exception when raise_exception then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'OK: %', sqlerrm;
  end;
  if (select etapa from public.requisiciones where id = 'eeeeeeee-2222-0000-0000-000000000001') <> 'en_transito' then
    raise exception 'FALLA: esperaba en_transito';
  end if;
  raise notice 'OK: en tránsito';
end $$;

\echo '── 4. Quien pidió confirma 5 en obra y reporta 1 faltante; Alma reenvía 5 y se confirman'
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000002', false);
insert into public.requisicion_linea_eventos (requisicion_linea_id, tipo, cantidad, nota) values
  ('eeeeeeee-3333-0000-0000-000000000001', 'entregado', 5, null),
  ('eeeeeeee-3333-0000-0000-000000000001', 'faltante', 1, 'Una caja no llegó');
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false);
insert into public.requisicion_linea_eventos (requisicion_linea_id, tipo, cantidad) values ('eeeeeeee-3333-0000-0000-000000000001', 'enviado_obra', 4);
do $$
declare v record;
begin
  select * into v from public.v_requisicion_linea_entrega where requisicion_linea_id = 'eeeeeeee-3333-0000-0000-000000000001';
  if v.en_bodega <> 0 or v.en_transito <> 4 or v.final <> 5 then
    raise exception 'FALLA: bodega % tránsito % final %', v.en_bodega, v.en_transito, v.final;
  end if;
  raise notice 'OK: bodega 0, tránsito 4, en obra 5 (el faltante queda por reponer)';
end $$;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000002', false);
insert into public.requisicion_linea_eventos (requisicion_linea_id, tipo, cantidad) values
  ('eeeeeeee-3333-0000-0000-000000000001', 'entregado', 4),
  ('eeeeeeee-3333-0000-0000-000000000001', 'directo_obra', 1);
do $$
declare v record;
begin
  select etapa into v from public.requisiciones where id = 'eeeeeeee-2222-0000-0000-000000000001';
  if v.etapa <> 'recibida' then raise exception 'FALLA: etapa % (esperaba recibida)', v.etapa; end if;
  select * into v from public.v_requisicion_avance where requisicion_id = 'eeeeeeee-2222-0000-0000-000000000001';
  if v.avance_pct <> 100 or v.en_obra <> 2 then raise exception 'FALLA: avance % en obra %', v.avance_pct, v.en_obra; end if;
  raise notice 'OK: completada al 100%% con las 2 partidas cumplidas';
end $$;

select set_config('request.jwt.claim.sub', '', false);
