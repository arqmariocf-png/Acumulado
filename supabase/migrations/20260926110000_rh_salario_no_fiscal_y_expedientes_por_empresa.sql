-- 26-sep-2026 (Mario):
-- 1) Contrataciones: salario FISCAL (sueldo_periodo, el único que va en el
--    contrato) y salario NO fiscal (sueldo_no_fiscal_periodo, nómina interna).
-- 2) Personal: indicador por empresa de expedientes completos vs en
--    regularización (con documentos obligatorios faltantes según
--    v_documentos_faltantes_personal). La empresa es la de la última
--    contratación; sin contratación se agrupan aparte.
-- Ya aplicado en producción.

alter table public.contrataciones add column if not exists sueldo_no_fiscal_periodo numeric(12, 2);
comment on column public.contrataciones.sueldo_periodo is 'Salario FISCAL por periodo (semana o quincena): es el único que aparece en el contrato.';
comment on column public.contrataciones.sueldo_no_fiscal_periodo is 'Salario NO fiscal por periodo. No va en el contrato; solo para nómina interna.';

create or replace view public.v_expedientes_por_empresa with (security_invoker = true) as
with ultima as (
  select distinct on (c.personal_id) c.personal_id, c.empresa_id
  from public.contrataciones c
  order by c.personal_id, c.fecha_inicio desc
),
faltantes as (
  select personal_id, count(*) as n from public.v_documentos_faltantes_personal group by personal_id
)
select coalesce(e.id, '00000000-0000-0000-0000-000000000000'::uuid) as empresa_id,
       coalesce(e.codigo, '—') as empresa_codigo,
       coalesce(e.nombre, 'Sin contratación') as empresa_nombre,
       count(*) as total,
       count(*) filter (where f.personal_id is null) as completos,
       count(*) filter (where f.personal_id is not null) as en_regularizacion
from public.personal p
left join ultima u on u.personal_id = p.id
left join public.empresas e on e.id = u.empresa_id
left join faltantes f on f.personal_id = p.id
where p.activo
group by e.id, e.codigo, e.nombre
order by e.nombre nulls last;

grant select on public.v_expedientes_por_empresa to authenticated;
