-- Datos bancarios de proveedores aprendidos de los SPEI ya enviados (Mario,
-- 29-sep-2026: "estos pagos no tienen los datos bancarios; esto sí viene en
-- las OC"). Revisado: el backoffice (api_ocs_aut y api_ocs_det_aut) NO manda
-- banco, CLABE, cuenta ni RFC del proveedor -- solo Tipo_pago (la forma de
-- pago), que ya se muestra en Tesorería (20260929210000). Lo que sí tenemos:
-- los estados de cuenta traen, en cada SPEI enviado, CLABE, beneficiario,
-- RFC y banco. Dos formatos:
--   Santander: "... CTA/CLABE: 0126..., BXI SPEI BCO:012 BENEF:NOMBRE (DATO
--              NO VERIFICADO ...), CONCEPTO CVE RASTREO: ... RFC: XXX BANCO HORA LIQ"
--   BBVA:      "SPEI Enviado: | Institucion Receptora: BANCO | Beneficiario:
--              NOMBRE (Dato no verificado ...) | Cuenta Beneficiario: 0122...
--              RFC Beneficiario: XXX | ..."
--
-- Reglas:
--   * solo CLABE de 18 dígitos con dígito verificador válido (nunca tarjeta
--     ni cuenta corta);
--   * fuera los traspasos a empresas propias (nombre = una empresa);
--   * el SPEI corta el nombre a 40 caracteres: si el nombre cortado es
--     prefijo de UN solo proveedor de las OC, se usa el del proveedor;
--   * nunca pisa lo capturado a mano (origen 'captura'); lo aprendido
--     (origen 'spei') se actualiza con el SPEI más reciente.
-- Corre diario por pg_cron y se puede llamar a mano (solo service_role).
--
-- Ya aplicado en producción.

alter table public.proveedores_datos_bancarios
  add column if not exists origen text not null default 'captura';
do $$ begin
  alter table public.proveedores_datos_bancarios
    add constraint proveedores_datos_bancarios_origen_check check (origen in ('captura', 'spei', 'backoffice'));
exception when duplicate_object then null; end $$;

create or replace function public.fn_clabe_valida(p text)
returns boolean language sql immutable as $$
  select p ~ '^[0-9]{18}$'
     and (10 - (
           select sum(((substr(p, i, 1))::int * (array[3, 7, 1])[((i - 1) % 3) + 1]) % 10)
           from generate_series(1, 17) i
         ) % 10) % 10 = (substr(p, 18, 1))::int
$$;

create or replace function public.fn_banco_de_clabe(p text)
returns text language sql immutable as $$
  select case left(p, 3)
    when '002' then 'BANAMEX' when '012' then 'BBVA MEXICO' when '014' then 'SANTANDER'
    when '021' then 'HSBC' when '030' then 'BAJIO' when '036' then 'INBURSA'
    when '042' then 'MIFEL' when '044' then 'SCOTIABANK' when '058' then 'BANREGIO'
    when '059' then 'INVEX' when '062' then 'AFIRME' when '072' then 'BANORTE'
    when '106' then 'BANK OF AMERICA' when '127' then 'AZTECA' when '130' then 'COMPARTAMOS'
    when '137' then 'BANCOPPEL' when '138' then 'ABC CAPITAL' when '646' then 'STP'
    when '638' then 'NU MEXICO' when '722' then 'MERCADO PAGO' when '728' then 'SPIN BY OXXO'
    else null end
$$;

create or replace function public.fn_bancarios_desde_spei()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  with crudo as (
    select m.fecha_pago, m.empresa_id,
      coalesce(substring(m.nombre_razon_social from 'CTA/CLABE:\s*([0-9]{18})'),
               substring(m.nombre_razon_social from 'Cuenta Beneficiario:\s*([0-9]{18})')) as clabe,
      btrim(coalesce(substring(m.nombre_razon_social from 'BENEF:\s*(.*?)\s*\((?:DATO|Dato)'),
                     substring(m.nombre_razon_social from 'Beneficiario:\s*(.*?)\s*\((?:DATO|Dato)'))) as benef,
      coalesce(substring(m.nombre_razon_social from 'RFC Beneficiario:\s*([A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3})'),
               substring(m.nombre_razon_social from 'RFC:\s*([A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3})')) as rfc,
      btrim(substring(m.nombre_razon_social from 'Institucion Receptora:\s*([^|]+?)\s*\|')) as banco_texto
    from public.movimientos m
    where m.cargo_total > 0
      and (m.nombre_razon_social ~ 'CTA/CLABE:' or m.nombre_razon_social ~ 'Cuenta Beneficiario:')
  ),
  validos as (
    select c.*, public.fn_proveedor_clave(c.benef) as bc, e.grupo_id
    from crudo c
    join public.empresas e on e.id = c.empresa_id
    where c.clabe is not null and c.benef is not null and c.benef <> ''
      and public.fn_clabe_valida(c.clabe)
  ),
  externos as (
    select v.* from validos v
    where not exists (
      select 1 from public.empresas e2
      where public.fn_proveedor_clave(e2.nombre) like v.bc || '%'
         or v.bc like public.fn_proveedor_clave(e2.nombre) || '%'
    )
  ),
  -- Nombre completo del proveedor cuando el SPEI lo cortó.
  resueltos as (
    select x.*,
      coalesce(
        (select min(oc.proveedor) from public.ordenes_compra oc
          where length(x.bc) >= 20
            and public.fn_proveedor_clave(oc.proveedor) like x.bc || '%'
          having count(distinct public.fn_proveedor_clave(oc.proveedor)) = 1),
        x.benef) as nombre
    from externos x
  ),
  ultimo as (
    select distinct on (public.fn_proveedor_clave(r.nombre))
      public.fn_proveedor_clave(r.nombre) as clave, r.nombre, r.benef, r.clabe, r.rfc,
      coalesce(r.banco_texto, public.fn_banco_de_clabe(r.clabe)) as banco, r.fecha_pago, r.grupo_id
    from resueltos r
    order by public.fn_proveedor_clave(r.nombre), r.fecha_pago desc
  ),
  escritos as (
    insert into public.proveedores_datos_bancarios as t
      (clave, nombre, beneficiario, banco, clabe, rfc, notas, grupo_id, origen, updated_at)
    select u.clave, u.nombre, u.benef, u.banco, u.clabe, u.rfc,
           'Tomado del SPEI enviado el ' || to_char(u.fecha_pago, 'DD/MM/YYYY') || ' (estado de cuenta). Verificar antes de pagar.',
           u.grupo_id, 'spei', now()
    from ultimo u
    where u.clave is not null and u.clave <> ''
    on conflict (clave) do update set
      beneficiario = excluded.beneficiario, banco = excluded.banco, clabe = excluded.clabe,
      rfc = coalesce(excluded.rfc, t.rfc), notas = excluded.notas, updated_at = now()
    where t.origen = 'spei' and t.clabe is distinct from excluded.clabe
    returning 1
  )
  select count(*) into n from escritos;
  return n;
end;
$$;
revoke all on function public.fn_bancarios_desde_spei() from public, anon, authenticated;
grant execute on function public.fn_bancarios_desde_spei() to service_role;

-- Diario 13:07 UTC (después de que tesorería sube los estados de cuenta de la mañana).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'bancarios-desde-spei';
    perform cron.schedule('bancarios-desde-spei', '7 13 * * *', 'select public.fn_bancarios_desde_spei()');
  end if;
end $$;
