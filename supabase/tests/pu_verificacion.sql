-- Verificación funcional del módulo de Precios Unitarios contra Postgres
-- real: matemática del costeo, explosión de básicos, circuito de firmas y
-- RLS por rol. Corre como superusuario pero cambia a `authenticated` para
-- cada actor, que es como llega el frontend.
\set ON_ERROR_STOP on
\timing off

grant usage on schema public to authenticated, anon;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ── Actores ──────────────────────────────────────────────────────────────
-- handle_new_user() ya crea el profile en 'pendiente'; aquí sólo se le
-- asigna rol y empresa, que es justo lo que hace un admin en la pantalla.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dg@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'super-csc@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'almacen@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'direccion@example.test'),
  ('55555555-5555-5555-5555-555555555555', 'super-vbb@example.test');

update public.profiles set nombre = 'Mario (DG)', rol = 'admin', empresa_id = null
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set nombre = 'Supervisor CSC', rol = 'responsable',
  empresa_id = (select id from public.empresas where codigo = 'CSC')
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set nombre = 'Alma (almacén)', rol = 'almacen', empresa_id = null
  where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set nombre = 'Laura (dirección)', rol = 'direccion',
  empresa_id = (select id from public.empresas where codigo = 'CSC')
  where id = '44444444-4444-4444-4444-444444444444';
update public.profiles set nombre = 'Supervisor VBB', rol = 'responsable',
  empresa_id = (select id from public.empresas where codigo = 'VBB')
  where id = '55555555-5555-5555-5555-555555555555';

insert into public.proyectos (id, nombre, empresa_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Obra Angelópolis',
        (select id from public.empresas where codigo = 'CSC'));

\echo '── 1. Catálogo de insumos (admin) ──────────────────────────────────'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.pu_insumos (id, codigo, descripcion, unidad, tipo) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'MAT-CEM-01', 'Cemento gris CPC 30R', 'TON', 'material'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'MO-ALB-01', 'Cuadrilla albañil + ayudante', 'JOR', 'mano_obra'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'MAT-ARE-01', 'Arena de río', 'M3', 'material');

insert into public.pu_insumo_precios (insumo_id, costo, fuente) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 3000.00, 'cotización agosto'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 800.00, 'tabulador 2026');
-- MAT-ARE-01 queda a propósito sin cotizar, para probar insumos_sin_precio.
commit;

select codigo, costo_vigente, fuente_costo from public.v_pu_insumos_vigentes order by codigo;

do $$
begin
  assert (select costo_vigente from public.v_pu_insumos_vigentes where codigo = 'MAT-CEM-01') = 3000,
    'el costo vigente del cemento debería ser 3000';
  assert (select costo_vigente from public.v_pu_insumos_vigentes where codigo = 'MAT-ARE-01') is null,
    'un insumo nunca cotizado debe salir sin costo, no en cero';
  assert (select costo_vigente from public.v_pu_insumos_vigentes where codigo = 'HERR-MENOR') is null,
    'la herramienta menor no lleva costo propio: es un % de la mano de obra';
end $$;

\echo '── 2. Una cotización nueva no borra la anterior, la sustituye ──────'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.pu_insumo_precios (insumo_id, costo, fuente)
values ('bbbbbbbb-0000-0000-0000-000000000001', 3200.00, 'factura septiembre');
commit;

do $$
begin
  assert (select costo_vigente from public.v_pu_insumos_vigentes where codigo = 'MAT-CEM-01') = 3200,
    'debe ganar la cotización más reciente';
  assert (select count(*) from public.pu_insumo_precios
          where insumo_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 2,
    'la cotización anterior sigue en el historial';
end $$;

\echo '── 3. Análisis básico (mortero) y concepto (muro), por el supervisor'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

insert into public.pu_analisis (id, empresa_id, proyecto_id, codigo, concepto, unidad, es_auxiliar, creado_por)
values
  ('cccccccc-0000-0000-0000-000000000001',
   (select id from public.empresas where codigo = 'CSC'),
   'aaaaaaaa-0000-0000-0000-000000000001',
   'BAS-MORT-15', 'Mortero cemento-arena 1:5', 'M3', true,
   '22222222-2222-2222-2222-222222222222'),
  ('cccccccc-0000-0000-0000-000000000002',
   (select id from public.empresas where codigo = 'CSC'),
   'aaaaaaaa-0000-0000-0000-000000000001',
   'MUR-TAB-01', 'Muro de tabique rojo recocido de 12 cm', 'M2', false,
   '22222222-2222-2222-2222-222222222222');

-- Mortero: 0.25 ton de cemento (3200) = 800.00 exacto.
insert into public.pu_analisis_items (analisis_id, orden, insumo_id, cantidad)
values ('cccccccc-0000-0000-0000-000000000001', 1, 'bbbbbbbb-0000-0000-0000-000000000001', 0.25);

-- Muro: mano de obra 1 jornada con rendimiento 8 m2/jornada  -> 0.125 * 800 = 100.00
insert into public.pu_analisis_items (analisis_id, orden, insumo_id, cantidad, rendimiento)
values ('cccccccc-0000-0000-0000-000000000002', 1, 'bbbbbbbb-0000-0000-0000-000000000002', 1, 8);

-- Muro: 0.02 m3 de mortero (básico a 800.00) -> 16.00
insert into public.pu_analisis_items (analisis_id, orden, analisis_hijo_id, cantidad)
values ('cccccccc-0000-0000-0000-000000000002', 2, 'cccccccc-0000-0000-0000-000000000001', 0.02);

-- Muro: herramienta menor, 3% de la mano de obra -> 0.03 * 100 = 3.00
insert into public.pu_analisis_items (analisis_id, orden, insumo_id, base_calculo, cantidad)
values ('cccccccc-0000-0000-0000-000000000002', 3,
        (select id from public.pu_insumos where codigo = 'HERR-MENOR'), 'pct_mano_obra', 0.03);
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select orden, codigo, tipo, base_calculo, aportacion, costo_unitario, importe, sin_precio
from public.v_pu_analisis_detalle
where analisis_id = 'cccccccc-0000-0000-0000-000000000002'
order by orden;

select codigo, costo_directo, importe_material, importe_mano_obra, importe_equipo,
       importe_basicos, precio_unitario, insumos_sin_precio
from public.v_pu_analisis_costeo
where analisis_id in ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002')
order by codigo;
commit;

do $$
declare
  v_cd numeric;
  v_pu numeric;
begin
  select costo_directo, precio_unitario into v_cd, v_pu
    from public.v_pu_analisis_costeo where analisis_id = 'cccccccc-0000-0000-0000-000000000002';
  -- 100.00 mano de obra + 16.00 básico + 3.00 herramienta
  assert v_cd = 119.00, format('costo directo esperado 119.00, salió %s', v_cd);
  -- Sin factor asignado el precio unitario es el costo directo pelón.
  assert v_pu = 119.00, format('sin factor el PU debe ser el costo directo, salió %s', v_pu);

  assert (select costo_directo from public.v_pu_analisis_costeo
          where analisis_id = 'cccccccc-0000-0000-0000-000000000001') = 800.00,
    'el básico debe costar 800.00';
  assert (select importe from public.v_pu_analisis_detalle
          where analisis_id = 'cccccccc-0000-0000-0000-000000000002' and tipo = 'auxiliar') = 16.00,
    'el básico entra al muro por 0.02 x 800 = 16.00';
  assert (select costo_unitario from public.v_pu_analisis_detalle
          where analisis_id = 'cccccccc-0000-0000-0000-000000000002' and base_calculo = 'pct_mano_obra') = 100.00,
    'el costo unitario del % es el subtotal de mano de obra del análisis';
end $$;

\echo '── 4. Cotizar el cemento vuelve a costear solo lo que está en borrador'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.pu_insumo_precios (insumo_id, costo, fuente)
values ('bbbbbbbb-0000-0000-0000-000000000001', 4000.00, 'alza de octubre');
commit;

do $$
declare v_cd numeric;
begin
  -- Mortero pasa de 800 a 1000; el muro trae 0.02 -> 20.00 en vez de 16.00.
  assert (select costo_directo from public.v_pu_analisis_costeo
          where analisis_id = 'cccccccc-0000-0000-0000-000000000001') = 1000.00,
    'el básico debe recostearse solo';
  select costo_directo into v_cd from public.v_pu_analisis_costeo
    where analisis_id = 'cccccccc-0000-0000-0000-000000000002';
  assert v_cd = 123.00, format('el muro debía recostearse a 123.00, salió %s', v_cd);
end $$;

\echo '── 5. Sólo entran básicos, y sin cerrar ciclos ─────────────────────'
-- Un concepto vendible no se puede meter dentro de otro análisis: perdería
-- su sobrecosto.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
    insert into public.pu_analisis_items (analisis_id, orden, analisis_hijo_id, cantidad)
    values ('cccccccc-0000-0000-0000-000000000001', 9, 'cccccccc-0000-0000-0000-000000000002', 1);
    raise exception 'NO DEBIÓ PASAR: se metió un concepto vendible como si fuera básico';
  exception when others then
    if sqlerrm like 'NO DEBIÓ PASAR%' then raise; end if;
    raise notice 'ok, rechazado: %', sqlerrm;
  end;
  reset role;
end $$;

-- Dos básicos: el mortero consume al habilitado; meter el mortero dentro del
-- habilitado cerraría el círculo y el costeo no terminaría nunca.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into public.pu_analisis (id, empresa_id, proyecto_id, codigo, concepto, unidad, es_auxiliar, creado_por)
values ('cccccccc-0000-0000-0000-000000000003',
        (select id from public.empresas where codigo = 'CSC'),
        'aaaaaaaa-0000-0000-0000-000000000001',
        'BAS-HAB-01', 'Habilitado de acero de refuerzo', 'TON', true,
        '22222222-2222-2222-2222-222222222222');
insert into public.pu_analisis_items (analisis_id, orden, analisis_hijo_id, cantidad)
values ('cccccccc-0000-0000-0000-000000000001', 8, 'cccccccc-0000-0000-0000-000000000003', 0.001);
commit;

do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
    insert into public.pu_analisis_items (analisis_id, orden, analisis_hijo_id, cantidad)
    values ('cccccccc-0000-0000-0000-000000000003', 1, 'cccccccc-0000-0000-0000-000000000001', 1);
    raise exception 'NO DEBIÓ PASAR: se aceptó un ciclo de básicos';
  exception when others then
    if sqlerrm like 'NO DEBIÓ PASAR%' then raise; end if;
    raise notice 'ok, rechazado: %', sqlerrm;
  end;
  reset role;
end $$;

-- El básico vacío que se acaba de anidar cuesta 0 y no ensucia el total.
do $$
begin
  assert (select costo_directo from public.v_pu_analisis_costeo
          where analisis_id = 'cccccccc-0000-0000-0000-000000000001') = 1000.00,
    'un básico anidado sin renglones no debe mover el costo';
end $$;

\echo '── 5b. Quitar un renglón en borrador ───────────────────────────────'
-- En un trigger de DELETE, NEW no está asignado: si el trigger lo tocara,
-- quitar un renglón desde la pantalla tronaría.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into public.pu_analisis_items (id, analisis_id, orden, insumo_id, cantidad)
values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 7,
        'bbbbbbbb-0000-0000-0000-000000000003', 0.5);

-- Un insumo sin cotizar cuenta cero pero se reporta, en vez de esconderse:
-- un PU armado sobre insumos sin precio sale barato y mentiroso.
do $$
begin
  assert (select insumos_sin_precio from public.v_pu_analisis_costeo
          where analisis_id = 'cccccccc-0000-0000-0000-000000000002') = 1,
    'la arena sin cotizar debe reportarse';
  assert (select importe from public.v_pu_analisis_detalle
          where item_id = 'dddddddd-0000-0000-0000-000000000001') = 0,
    'y contar en cero';
  assert (select costo_directo from public.v_pu_analisis_costeo
          where analisis_id = 'cccccccc-0000-0000-0000-000000000002') = 123.00,
    'sin mover el costo directo';
end $$;

delete from public.pu_analisis_items where id = 'dddddddd-0000-0000-0000-000000000001';
commit;

do $$
begin
  assert not exists (select 1 from public.pu_analisis_items
                     where id = 'dddddddd-0000-0000-0000-000000000001'),
    'el renglón debió quedar borrado';
  assert (select costo_directo from public.v_pu_analisis_costeo
          where analisis_id = 'cccccccc-0000-0000-0000-000000000002') = 123.00,
    'quitar el renglón devuelve el costo directo a donde estaba';
end $$;

\echo '── 6. Circuito de firmas ───────────────────────────────────────────'
-- El supervisor no puede confirmar material: esa etapa es de almacén.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
    update public.pu_analisis set estado = 'material_confirmado'
      where id = 'cccccccc-0000-0000-0000-000000000002';
    raise exception 'NO DEBIÓ PASAR: un supervisor confirmó material';
  exception when others then
    if sqlerrm like 'NO DEBIÓ PASAR%' then raise; end if;
    raise notice 'ok, rechazado: %', sqlerrm;
  end;
  reset role;
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.pu_analisis
  set estado = 'en_revision_material', comentario_revision = 'listo para precios'
  where id = 'cccccccc-0000-0000-0000-000000000002';
commit;

-- Almacén pone precio y proveedor; el catálogo dice 800 pero se cerró en 850.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
update public.pu_analisis_items
  set costo_congelado = 850.00, proveedor = 'Cuadrilla Hnos. Pérez'
  where analisis_id = 'cccccccc-0000-0000-0000-000000000002'
    and insumo_id = 'bbbbbbbb-0000-0000-0000-000000000002';
commit;

do $$
declare v_cd numeric;
begin
  assert (select costo_cerrado from public.v_pu_analisis_detalle
          where analisis_id = 'cccccccc-0000-0000-0000-000000000002' and tipo = 'mano_obra'),
    'el renglón debe quedar marcado como precio cerrado';
  assert (select precio_autorizado_en from public.v_pu_analisis_detalle
          where analisis_id = 'cccccccc-0000-0000-0000-000000000002' and tipo = 'mano_obra') is not null,
    'poner precio debe sellar fecha de autorización';
  -- mano de obra 850/8 = 106.25, herramienta 3% = 3.19 (redondeado), básico 20.00
  select costo_directo into v_cd from public.v_pu_analisis_costeo
    where analisis_id = 'cccccccc-0000-0000-0000-000000000002';
  assert v_cd = 129.44, format('costo directo esperado 129.44, salió %s', v_cd);
end $$;

-- Almacén NO puede cambiar cantidades, sólo precio y proveedor.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
    update public.pu_analisis_items set cantidad = 99
      where analisis_id = 'cccccccc-0000-0000-0000-000000000002'
        and insumo_id = 'bbbbbbbb-0000-0000-0000-000000000002';
    raise exception 'NO DEBIÓ PASAR: almacén cambió una cantidad';
  exception when others then
    if sqlerrm like 'NO DEBIÓ PASAR%' then raise; end if;
    raise notice 'ok, rechazado: %', sqlerrm;
  end;
  reset role;
end $$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
update public.pu_analisis set estado = 'material_confirmado', comentario_revision = 'precios de septiembre'
  where id = 'cccccccc-0000-0000-0000-000000000002';
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
update public.pu_analisis set estado = 'autorizado' where id = 'cccccccc-0000-0000-0000-000000000002';
commit;

-- Publicar sin factor asignado no se puede.
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
    update public.pu_analisis set estado = 'publicado' where id = 'cccccccc-0000-0000-0000-000000000002';
    raise exception 'NO DEBIÓ PASAR: se publicó sin factor de sobrecosto';
  exception when others then
    if sqlerrm like 'NO DEBIÓ PASAR%' then raise; end if;
    raise notice 'ok, rechazado: %', sqlerrm;
  end;
  reset role;
end $$;

\echo '── 7. Factor de sobrecosto y precio final ──────────────────────────'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.pu_analisis
  set factor_id = (select f.id from public.pu_factores f
                   join public.empresas e on e.id = f.empresa_id
                   where e.codigo = 'CSC' limit 1)
  where id = 'cccccccc-0000-0000-0000-000000000002';
update public.pu_analisis set estado = 'publicado' where id = 'cccccccc-0000-0000-0000-000000000002';
commit;

select codigo, costo_directo, importe_indirectos, importe_financiamiento, importe_utilidad,
       importe_cargos_adicionales, precio_unitario
from public.v_pu_analisis_costeo where analisis_id = 'cccccccc-0000-0000-0000-000000000002';

do $$
declare
  r record;
begin
  select * into r from public.v_pu_analisis_costeo
    where analisis_id = 'cccccccc-0000-0000-0000-000000000002';
  -- 129.44 CD, cascada 15% / 1% / 10% / 0.5%
  assert r.importe_indirectos = 19.42, format('indirectos: %s', r.importe_indirectos);
  assert r.importe_financiamiento = 1.49, format('financiamiento: %s', r.importe_financiamiento);
  assert r.importe_utilidad = 15.03, format('utilidad: %s', r.importe_utilidad);
  assert r.importe_cargos_adicionales = 0.83, format('cargos: %s', r.importe_cargos_adicionales);
  -- La tarjeta tiene que cuadrar sumada a mano.
  assert r.precio_unitario
    = r.costo_directo + r.importe_indirectos + r.importe_financiamiento
      + r.importe_utilidad + r.importe_cargos_adicionales,
    'el precio unitario no cuadra con la suma de sus renglones';
  assert r.precio_unitario = 166.21, format('precio unitario: %s', r.precio_unitario);

  -- Un básico nunca lleva sobrecosto, ni con factor de por medio.
  assert (select precio_unitario from public.v_pu_analisis_costeo
          where analisis_id = 'cccccccc-0000-0000-0000-000000000001') = 1000.00,
    'un básico se consume a costo directo';
end $$;

\echo '── 8. Bitácora completa y sólo por trigger ─────────────────────────'
select estado_anterior, estado_nuevo, actor_nombre, actor_rol, comentario
from public.pu_aprobaciones
where analisis_id = 'cccccccc-0000-0000-0000-000000000002'
order by created_at;

do $$
begin
  assert (select count(*) from public.pu_aprobaciones
          where analisis_id = 'cccccccc-0000-0000-0000-000000000002') = 4,
    'deben quedar las 4 firmas del circuito';
  assert (select actor_nombre from public.pu_aprobaciones
          where analisis_id = 'cccccccc-0000-0000-0000-000000000002'
            and estado_nuevo = 'material_confirmado') = 'Alma (almacén)',
    'la firma de almacén debe conservar el nombre de quien firmó';
  -- Dirección autorizó sin escribir comentario: no debe heredar el de almacén.
  assert (select comentario from public.pu_aprobaciones
          where analisis_id = 'cccccccc-0000-0000-0000-000000000002'
            and estado_nuevo = 'autorizado') is null,
    'un comentario no se arrastra a la firma siguiente';
  assert (select comentario from public.pu_aprobaciones
          where analisis_id = 'cccccccc-0000-0000-0000-000000000002'
            and estado_nuevo = 'material_confirmado') = 'precios de septiembre',
    'la firma de almacén conserva su propio comentario';

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
    insert into public.pu_aprobaciones (analisis_id, estado_anterior, estado_nuevo)
    values ('cccccccc-0000-0000-0000-000000000002', 'borrador', 'publicado');
    raise exception 'NO DEBIÓ PASAR: se pudo escribir una firma a mano';
  exception when others then
    if sqlerrm like 'NO DEBIÓ PASAR%' then raise; end if;
    raise notice 'ok, rechazado: %', sqlerrm;
  end;
  reset role;
end $$;

\echo '── 9. Publicados y aislamiento entre empresas ──────────────────────'
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as publicados_ve_supervisor_csc from public.v_pu_publicados;
commit;

do $$
declare v_otros integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
  select count(*) into v_otros from public.pu_analisis;
  assert v_otros = 0, format('un supervisor de VBB no debe ver los PU de CSC (vio %s)', v_otros);
  select count(*) into v_otros from public.v_pu_analisis_detalle;
  assert v_otros = 0, 'ni sus renglones';
  reset role;
end $$;

\echo '── 10. Un análisis publicado ya no se toca ─────────────────────────'
do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
    update public.pu_analisis_items set cantidad = 5
      where analisis_id = 'cccccccc-0000-0000-0000-000000000002' and base_calculo = 'pct_mano_obra';
    raise exception 'NO DEBIÓ PASAR: se editó un renglón de un PU publicado';
  exception when others then
    if sqlerrm like 'NO DEBIÓ PASAR%' then raise; end if;
    raise notice 'ok, rechazado: %', sqlerrm;
  end;
  reset role;
end $$;

\echo '── 11. Un borrador se puede tirar; uno firmado no ──────────────────'
-- Al borrar el análisis, sus renglones se van en cascada y el trigger de
-- edición los ve sin padre: tiene que dejarlos pasar, no trabarse.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into public.pu_analisis (id, empresa_id, proyecto_id, codigo, concepto, unidad, creado_por)
values ('cccccccc-0000-0000-0000-000000000004',
        (select id from public.empresas where codigo = 'CSC'),
        'aaaaaaaa-0000-0000-0000-000000000001',
        'TIRAR-01', 'Análisis capturado por error', 'PZA',
        '22222222-2222-2222-2222-222222222222');
insert into public.pu_analisis_items (analisis_id, orden, insumo_id, cantidad)
values ('cccccccc-0000-0000-0000-000000000004', 1, 'bbbbbbbb-0000-0000-0000-000000000001', 1);
delete from public.pu_analisis where id = 'cccccccc-0000-0000-0000-000000000004';
commit;

do $$
begin
  assert not exists (select 1 from public.pu_analisis where id = 'cccccccc-0000-0000-0000-000000000004'),
    'el borrador debió borrarse';
  assert not exists (select 1 from public.pu_analisis_items
                     where analisis_id = 'cccccccc-0000-0000-0000-000000000004'),
    'y arrastrar sus renglones';

  -- El publicado se da de baja, no se borra: ya tiene firmas encima.
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
    delete from public.pu_analisis where id = 'cccccccc-0000-0000-0000-000000000002';
    if exists (select 1 from public.pu_analisis where id = 'cccccccc-0000-0000-0000-000000000002') then
      raise notice 'ok, RLS no dejó borrar un PU publicado';
    else
      raise exception 'NO DEBIÓ PASAR: se borró un PU publicado';
    end if;
  end;
  reset role;
end $$;

\echo 'TODAS LAS VERIFICACIONES PASARON'
