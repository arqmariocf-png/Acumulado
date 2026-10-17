-- Prueba de 20261017090000_herramienta_equipo.sql: almacén da de alta piezas
-- con folio, el supervisor pide para SU obra (no para una que no ve),
-- almacén surte la solicitud, la pieza queda a cargo del supervisor en la
-- obra y regresa al almacén; quien no opera no da de alta.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-000000000001', 'alma.herr@test'),
  ('dddddddd-0000-0000-0000-000000000002', 'super.herr@test'),
  ('dddddddd-0000-0000-0000-000000000003', 'otro.herr@test');
update public.profiles set nombre = 'Alma herramienta', rol = 'almacen', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'dddddddd-0000-0000-0000-000000000001';
update public.profiles set nombre = 'Super herramienta', rol = 'supervisor', empresa_id = (select id from public.empresas where codigo = 'CSC'),
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'dddddddd-0000-0000-0000-000000000002';
update public.profiles set nombre = 'Otro supervisor', rol = 'supervisor', empresa_id = (select id from public.empresas where codigo = 'CSC'),
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'dddddddd-0000-0000-0000-000000000003';
insert into public.proyectos (id, nombre, empresa_id, responsable_id) values
  ('dddddddd-1111-0000-0000-000000000001', 'Obra herramienta', (select id from public.empresas where codigo = 'CSC'), 'dddddddd-0000-0000-0000-000000000002');

-- En Supabase authenticated usa auth.uid() desde funciones invoker.
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', false);

\echo '── 1. Almacén da de alta dos rotomartillos iguales: un folio por pieza'
do $$
declare v text[];
begin
  perform public.fn_herramienta_alta((select id from public.empresas where codigo = 'CSC'),
    '{"nombre": "Rotomartillo", "categoria": "electrica", "marca": "Bosch", "costo": "3500"}'::jsonb, 2);
  select array_agg(folio order by folio) into v from public.herramientas;
  if v <> array['HE-CSC-0001', 'HE-CSC-0002'] then raise exception 'FALLA: folios %', v; end if;
  if (select count(*) from public.herramienta_movimientos where tipo = 'alta') <> 2 then raise exception 'FALLA: sin bitácora de alta'; end if;
  raise notice 'OK: %', v;
end $$;

\echo '── 2. El supervisor pide para su obra; otro supervisor no puede pedir ahí'
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000002', false);
do $$
declare v_id uuid; v record;
begin
  if exists (select 1 from public.herramientas) then raise exception 'FALLA: el supervisor ve herramienta del almacén sin tenerla'; end if;
  v_id := public.fn_herramienta_solicitar('dddddddd-1111-0000-0000-000000000001',
    '[{"descripcion": "Rotomartillo", "cantidad": 1}]'::jsonb, current_date, current_date + 7, 'Para el colado');
  select folio, estado, solicitante_nombre into v from public.herramienta_solicitudes where id = v_id;
  if v.folio <> 'SH-CSC-0001' or v.estado <> 'pendiente' or v.solicitante_nombre <> 'Super herramienta' then
    raise exception 'FALLA: solicitud % % %', v.folio, v.estado, v.solicitante_nombre;
  end if;
  raise notice 'OK: % pendiente', v.folio;
  begin
    perform public.fn_herramienta_alta((select id from public.empresas where codigo = 'CSC'), '{"nombre": "Pala"}'::jsonb, 1);
    raise exception 'FALLA: el supervisor dio de alta herramienta';
  exception when insufficient_privilege then
    raise notice 'OK: supervisor no da de alta (%)', sqlerrm;
  end;
end $$;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000003', false);
do $$
begin
  begin
    perform public.fn_herramienta_solicitar('dddddddd-1111-0000-0000-000000000001', '[{"descripcion": "Pala"}]'::jsonb, null, null, null);
    raise exception 'FALLA: pidió para una obra que no ve';
  exception when insufficient_privilege then
    raise notice 'OK: obra ajena (%)', sqlerrm;
  end;
  if exists (select 1 from public.herramienta_solicitudes) then raise exception 'FALLA: ve la solicitud de otro'; end if;
end $$;

\echo '── 3. Almacén surte el renglón: la pieza queda a cargo del supervisor en la obra'
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', false);
do $$
declare v record;
begin
  perform public.fn_herramienta_asignar(array[(select id from public.herramientas where folio = 'HE-CSC-0001')],
    null, null, null, null, 'Sale con estuche', (select id from public.herramienta_solicitud_lineas limit 1));
  select h.estado, h.proyecto_id, h.responsable_id, h.responsable_nombre, h.devolver_el, s.estado as sol, l.surtido into v
    from public.herramientas h, public.herramienta_solicitudes s, public.herramienta_solicitud_lineas l
   where h.folio = 'HE-CSC-0001' and l.solicitud_id = s.id;
  if v.estado <> 'asignada' or v.proyecto_id <> 'dddddddd-1111-0000-0000-000000000001'
     or v.responsable_id <> 'dddddddd-0000-0000-0000-000000000002' or v.devolver_el <> current_date + 7
     or v.sol <> 'surtida' or v.surtido <> 1 then
    raise exception 'FALLA: % % % % %', v.estado, v.responsable_nombre, v.devolver_el, v.sol, v.surtido;
  end if;
  raise notice 'OK: asignada a % y solicitud surtida', v.responsable_nombre;
  begin
    perform public.fn_herramienta_estado((select id from public.herramientas where folio = 'HE-CSC-0002'), 'baja', '');
    raise exception 'FALLA: baja sin motivo';
  exception when raise_exception then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'OK: %', sqlerrm;
  end;
end $$;

\echo '── 4. El supervisor ve lo que tiene a su cargo; el otro no'
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000002', false);
do $$
begin
  if (select count(*) from public.herramientas) <> 1 then raise exception 'FALLA: el supervisor no ve su herramienta'; end if;
  raise notice 'OK: el supervisor ve su rotomartillo';
end $$;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000003', false);
do $$
begin
  if exists (select 1 from public.herramientas) or exists (select 1 from public.herramienta_movimientos) then
    raise exception 'FALLA: otro supervisor ve herramienta ajena';
  end if;
  raise notice 'OK: otro supervisor no ve nada';
end $$;

\echo '── 5. Regresa al almacén en condición regular'
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', false);
do $$
declare v record;
begin
  perform public.fn_herramienta_devolver(array[(select id from public.herramientas where folio = 'HE-CSC-0001')], 'regular', 'Sin broca', false);
  select estado, condicion, proyecto_id into v from public.herramientas where folio = 'HE-CSC-0001';
  if v.estado <> 'disponible' or v.condicion <> 'regular' or v.proyecto_id is not null then
    raise exception 'FALLA: % % %', v.estado, v.condicion, v.proyecto_id;
  end if;
  raise notice 'OK: disponible, condición regular';
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
