-- Prueba del módulo Legal (20261001110000_modulo_legal.sql).
-- Demuestra que BLOQUEA: sin el permiso 'legal' no se ven asuntos; otra
-- organización no ve nada; legal captura el crédito pero no lo autoriza; sin
-- crédito autorizado no se genera contrato.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('ffffffff-0000-0000-0000-000000000001', 'legal.loma@test'),
  ('ffffffff-0000-0000-0000-000000000002', 'rh.sin.legal@test'),
  ('ffffffff-0000-0000-0000-000000000003', 'direccion.loma@test'),
  ('ffffffff-0000-0000-0000-000000000004', 'corp.arssa.legal@test');

update public.profiles set nombre = 'Legal Loma', rol = 'corporativo', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'ffffffff-0000-0000-0000-000000000001';
update public.profiles set nombre = 'RH sin legal', rol = 'rh', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'ffffffff-0000-0000-0000-000000000002';
update public.profiles set nombre = 'Dirección Loma', rol = 'direccion', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'ffffffff-0000-0000-0000-000000000003';
update public.profiles set nombre = 'Corporativo ARSSA', rol = 'corporativo', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'ARSSA') where id = 'ffffffff-0000-0000-0000-000000000004';

insert into public.permisos_modulo (profile_id, modulo) values
  ('ffffffff-0000-0000-0000-000000000001', 'legal'),
  ('ffffffff-0000-0000-0000-000000000004', 'legal');

insert into public.clientes (empresa_id, razon_social, rfc)
values ((select id from public.empresas where codigo = 'AEP'), 'CLIENTE PRUEBA, S.A. DE C.V.', 'CPR010101AAA');

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

\echo '── 1. Legal da de alta un asunto con folio y bitácora'
set role authenticated;
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000001', false);
insert into public.legal_asuntos (empresa_id, tipo, titulo, contraparte)
values ((select id from public.empresas where codigo = 'AEP'), 'laboral', 'Demanda de prueba', 'Ex trabajador');
insert into public.legal_seguimiento (asunto_id, tipo, nota, proxima_fecha, proxima_actuacion)
select id, 'audiencia', 'Primera audiencia', current_date + 10, 'Audiencia de conciliación' from public.legal_asuntos;
do $$
declare a record;
begin
  select folio, proxima_fecha, proxima_actuacion into a from public.legal_asuntos;
  if a.folio not like 'LEG-AEP-%' then raise exception 'FALLA: folio inesperado %', a.folio; end if;
  if a.proxima_fecha is distinct from current_date + 10 then raise exception 'FALLA: la próxima fecha no pasó al asunto'; end if;
  if (select autor_nombre from public.legal_seguimiento) is distinct from 'Legal Loma' then raise exception 'FALLA: sin autor en la bitácora'; end if;
  raise notice 'OK: asunto % con próxima actuación "%"', a.folio, a.proxima_actuacion;
end $$;

\echo '── 2. RH sin el permiso no ve asuntos'
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000002', false);
do $$
begin
  if exists (select 1 from public.legal_asuntos) then raise exception 'FALLA: RH sin permiso legal ve asuntos'; end if;
  raise notice 'OK: sin permiso legal no se ven asuntos';
end $$;

\echo '── 3. Otra organización no ve nada, ni con permiso legal'
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000004', false);
do $$
begin
  if exists (select 1 from public.legal_asuntos) or exists (select 1 from public.clientes_credito) then
    raise exception 'FALLA: ARSSA ve asuntos o créditos de Loma';
  end if;
  raise notice 'OK: frontera de organización';
end $$;

\echo '── 4. Legal captura el crédito pero no lo autoriza'
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000001', false);
insert into public.clientes_credito (cliente_id, empresa_id, linea_credito, representante_nombre)
select id, empresa_id, 50000, 'JUAN PRUEBA' from public.clientes where rfc = 'CPR010101AAA';
do $$
begin
  begin
    update public.clientes_credito set autorizado = true where cliente_id = (select id from public.clientes where rfc = 'CPR010101AAA');
    raise exception 'FALLA: legal autorizó un crédito';
  exception when raise_exception then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'OK: legal no autoriza (%)', sqlerrm;
  end;
  begin
    insert into public.legal_contratos (empresa_id, cliente_id, monto)
    select empresa_id, id, 50000 from public.clientes where rfc = 'CPR010101AAA';
    raise exception 'FALLA: contrato sin crédito autorizado';
  exception when raise_exception then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'OK: sin autorización no hay contrato (%)', sqlerrm;
  end;
end $$;

\echo '── 5. Dirección autoriza y legal genera el contrato'
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000003', false);
update public.clientes_credito set autorizado = true where cliente_id = (select id from public.clientes where rfc = 'CPR010101AAA');
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000001', false);
insert into public.legal_contratos (empresa_id, cliente_id, monto)
select empresa_id, id, 50000 from public.clientes where rfc = 'CPR010101AAA';
do $$
declare v record;
begin
  select cc.autorizado_por_nombre, c.folio into v
    from public.clientes_credito cc join public.legal_contratos c on c.cliente_id = cc.cliente_id;
  if v.autorizado_por_nombre is distinct from 'Dirección Loma' then raise exception 'FALLA: no quedó quién autorizó'; end if;
  if v.folio not like 'CTO-AEP-%' then raise exception 'FALLA: folio de contrato %', v.folio; end if;
  raise notice 'OK: autorizado por % y contrato %', v.autorizado_por_nombre, v.folio;
end $$;

\echo '── 6. Expediente de la empresa: legal captura, RH sin permiso no ve'
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000001', false);
insert into public.legal_empresa_documentos (empresa_id, tipo, nombre, vence)
values ((select id from public.empresas where codigo = 'AEP'), 'opinion_sat', 'Opinión de cumplimiento SAT', current_date + 20);
insert into public.legal_empresa_observaciones (empresa_id, tipo, titulo, motivo)
values ((select id from public.empresas where codigo = 'AEP'), 'protocolizacion', 'Acta de asamblea 2026', 'Cambio de administrador único');
update public.legal_empresa_observaciones set estatus = 'protocolizada';
do $$
begin
  if (select subido_por_nombre from public.legal_empresa_documentos) is distinct from 'Legal Loma' then raise exception 'FALLA: sin quién subió'; end if;
  if (select resuelto_en from public.legal_empresa_observaciones) is distinct from current_date then raise exception 'FALLA: no quedó la fecha de protocolización'; end if;
  raise notice 'OK: documento con vencimiento y acta protocolizada';
end $$;
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000002', false);
do $$
begin
  if exists (select 1 from public.legal_empresa_documentos) or exists (select 1 from public.legal_empresa_observaciones) then
    raise exception 'FALLA: RH sin permiso legal ve el expediente legal';
  end if;
  raise notice 'OK: el expediente legal solo lo ve legal';
end $$;

reset role;
