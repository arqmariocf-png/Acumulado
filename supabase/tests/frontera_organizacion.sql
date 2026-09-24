-- Prueba de la frontera de organización en TODO el esquema
-- (20260924110000_frontera_organizacion.sql).
--
-- El caso que importa: un CORPORATIVO, que por diseño "ve todas las empresas",
-- no debe ver las de otra organización. Es el rol con el que se abría la fuga,
-- porque `auth_ve_todas_empresas()` le devolvía true para todas las filas.
--
-- Al final hay una aserción estructural: ninguna tabla de negocio puede quedar
-- sin frontera. Si alguien agrega una tabla nueva y se le olvida, esto falla y
-- lo obliga a decidir -- que es lo único que evita que la fuga vuelva cuando
-- otra sesión agregue el siguiente módulo.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000001', 'corp.loma@test'),
  ('cccccccc-0000-0000-0000-000000000002', 'corp.arssa@test');

update public.profiles set nombre='Corporativo Loma', rol='corporativo',
  grupo_id=(select id from public.grupos where codigo='LOMA')
 where id='cccccccc-0000-0000-0000-000000000001';
update public.profiles set nombre='Corporativo ARSSA', rol='corporativo',
  grupo_id=(select id from public.grupos where codigo='ARSSA')
 where id='cccccccc-0000-0000-0000-000000000002';

insert into public.empresas (nombre, codigo, grupo_id)
values ('ARSSA Operadora', 'ARS', (select id from public.grupos where codigo='ARSSA'));

-- Datos de Loma en los módulos que antes no tenían frontera.
insert into public.proyectos (empresa_id, nombre)
values ((select id from public.empresas where codigo='AEP'), 'Obra Loma');

insert into public.pu_insumos (codigo, descripcion, unidad, tipo, grupo_id)
values ('INS-LOMA', 'Cemento gris', 'TON', 'material', (select id from public.grupos where codigo='LOMA'));

insert into public.pu_factores (empresa_id, nombre)
values ((select id from public.empresas where codigo='AEP'), 'Factor Loma');

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

\echo '── 1. El corporativo de Loma SIGUE viendo lo suyo (la frontera no le quita nada)'
set role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000001', false);
do $$
declare
  n_proyectos integer;
  n_insumos integer;
  n_factores integer;
  n_empresas integer;
begin
  select count(*) into n_proyectos from public.proyectos;
  select count(*) into n_insumos from public.pu_insumos;
  select count(*) into n_factores from public.pu_factores;
  select count(*) into n_empresas from public.empresas;

  if n_proyectos < 1 then raise exception 'FALLA: la frontera le quitó sus proyectos a Loma'; end if;
  if n_insumos < 1 then raise exception 'FALLA: la frontera le quitó su catálogo de insumos a Loma'; end if;
  if n_factores < 1 then raise exception 'FALLA: la frontera le quitó sus factores a Loma'; end if;
  if n_empresas <> 8 then raise exception 'FALLA: Loma ve % empresas, deberían ser sus 8', n_empresas; end if;

  raise notice 'OK: Loma sigue viendo sus 8 empresas, sus proyectos, insumos y factores';
end $$;
reset role;

\echo '── 2. El corporativo de ARSSA no ve NADA de Loma, aunque su rol vea "todas las empresas"'
set role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000002', false);
do $$
declare
  n_proyectos integer;
  n_insumos integer;
  n_factores integer;
  n_empresas integer;
begin
  select count(*) into n_proyectos from public.proyectos;
  select count(*) into n_insumos from public.pu_insumos;
  select count(*) into n_factores from public.pu_factores;
  select count(*) into n_empresas from public.empresas;

  if n_proyectos <> 0 then raise exception 'FALLA: vio % proyectos de Loma', n_proyectos; end if;
  if n_insumos <> 0 then raise exception 'FALLA: vio % insumos de Loma', n_insumos; end if;
  if n_factores <> 0 then raise exception 'FALLA: vio % factores de Loma', n_factores; end if;
  if n_empresas <> 1 then raise exception 'FALLA: vio % empresas, solo debería ver la suya', n_empresas; end if;

  raise notice 'OK: proyectos, insumos y factores de Loma invisibles; solo ve su empresa';
end $$;

\echo '── 3. Tampoco puede escribir en una empresa de Loma'
do $$
begin
  insert into public.proyectos (empresa_id, nombre)
  values ((select id from public.empresas where codigo='AEP'), 'Intento');
  raise exception 'FALLA: escribió un proyecto en una empresa de Loma';
exception when insufficient_privilege or not_null_violation then
  raise notice 'OK: RLS bloqueó la escritura en una empresa de otra organización';
end $$;
reset role;

\echo '── 4. Ninguna tabla de negocio se queda sin frontera de organización'
do $$
declare
  sin_frontera text;
begin
  -- Lista blanca: catálogos de la PLATAFORMA, iguales para todos los
  -- clientes. Si agregas una tabla aquí, que sea porque de verdad no lleva
  -- datos de ningún cliente.
  select string_agg(t.tablename, ', ' order by t.tablename) into sin_frontera
  from pg_tables t
  where t.schemaname = 'public'
    and t.rowsecurity
    and t.tablename not in ('grupos', 'modulos', 'planes', 'plan_escalones', 'config_sistema',
                            'eventos_pasarela', 'empresas', 'profiles', 'suscripciones', 'pagos',
                            'audit_log', 'grupo_modulos')
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = t.tablename
        and p.policyname = 'frontera_organizacion'
    );

  if sin_frontera is not null then
    raise exception 'FALLA: estas tablas no tienen policy frontera_organizacion: %', sin_frontera;
  end if;
  raise notice 'OK: todas las tablas de negocio tienen frontera de organización';
end $$;
