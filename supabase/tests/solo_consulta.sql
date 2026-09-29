-- Prueba del candado de solo consulta (20260929170000_solo_consulta_espectador.sql).
--
-- Lo que importa demostrar es que BLOQUEA:
--   1. una organización sin suscripción no escribe en NINGUNA tabla, ni en
--      las que no piden suscripción en sus policies (tableros, profiles);
--   2. un espectador de la maestra ve lo suyo pero no escribe;
--   3. nadie más que el admin de la maestra le quita la marca a alguien;
--   4. ninguna tabla de public queda sin el candado.
-- Y que no le quita nada a quien sí puede escribir.

\set ON_ERROR_STOP on

insert into public.grupos (nombre, codigo, marca_comercial) values ('Sin Pago', 'SINPAGO', 'Sin Pago');
insert into public.empresas (nombre, codigo, grupo_id)
values ('Sin Pago Operadora', 'SPO', (select id from public.grupos where codigo = 'SINPAGO'));

insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-000000000001', 'admin.sinpago@test'),
  ('dddddddd-0000-0000-0000-000000000002', 'corp.loma@test'),
  ('dddddddd-0000-0000-0000-000000000003', 'espectador.loma@test');

update public.profiles set nombre = 'Admin Sin Pago', rol = 'admin', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'SINPAGO')
 where id = 'dddddddd-0000-0000-0000-000000000001';
update public.profiles set nombre = 'Corporativo Loma', rol = 'corporativo', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA')
 where id = 'dddddddd-0000-0000-0000-000000000002';
insert into public.proyectos (empresa_id, nombre)
values ((select id from public.empresas where codigo = 'AEP'), 'Obra Loma previa');

update public.profiles set nombre = 'Espectador Loma', rol = 'corporativo', todas_las_empresas = true, espectador = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA')
 where id = 'dddddddd-0000-0000-0000-000000000003';

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

\echo '── 1. Organización sin suscripción: ve lo suyo, no escribe en nada'
set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', false);
do $$
begin
  if (select count(*) from public.empresas) <> 1 then
    raise exception 'FALLA: la organización sin pago dejó de ver su empresa';
  end if;

  begin
    insert into public.empresas (nombre, codigo) values ('Otra', 'OTR');
    raise exception 'FALLA: sin suscripción pudo crear una empresa';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set nombre = 'Cambiado' where id = auth.uid();
    raise exception 'FALLA: sin suscripción pudo editar su perfil';
  exception when insufficient_privilege then null;
  end;

  -- tableros no pide suscripción en sus policies: esto solo lo para el candado.
  begin
    insert into public.tableros (nombre) values ('Tablero sin pago');
    raise exception 'FALLA: sin suscripción pudo crear un tablero';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

\echo '── 2. Espectador de la maestra: ve, no escribe, no se quita la marca'
set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000003', false);
do $$
begin
  if (select count(*) from public.empresas) < 8 then
    raise exception 'FALLA: el espectador de Loma no ve las empresas de Loma';
  end if;
  if (select count(*) from public.proyectos) < 1 then
    raise exception 'FALLA: el espectador de Loma no ve los proyectos de Loma';
  end if;

  begin
    insert into public.proyectos (empresa_id, nombre)
    values ((select id from public.empresas where codigo = 'AEP'), 'Obra espectador');
    raise exception 'FALLA: el espectador pudo crear un proyecto';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set espectador = false where id = auth.uid();
    raise exception 'FALLA: el espectador se quitó la marca';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

\echo '── 3. Quien sí puede escribir sigue escribiendo'
set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000002', false);
do $$
begin
  insert into public.proyectos (empresa_id, nombre)
  values ((select id from public.empresas where codigo = 'AEP'), 'Obra Loma');

  begin
    update public.profiles set espectador = false where id = 'dddddddd-0000-0000-0000-000000000003';
    if found then
      raise exception 'FALLA: un corporativo le quitó la marca de espectador a alguien';
    end if;
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

\echo '── 4. Ninguna tabla de public sin candado'
do $$
declare
  faltan text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into faltan
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relispartition
    and c.relname not in ('push_subscripciones')
    and not exists (
      select 1 from pg_trigger tg
      where tg.tgrelid = c.oid and tg.tgname = 'solo_consulta' and not tg.tgisinternal
    );
  if faltan is not null then
    raise exception 'FALLA: tablas sin el trigger solo_consulta (agrégalo en la migración de la tabla nueva): %', faltan;
  end if;
end
$$;

\echo 'OK: solo consulta'
