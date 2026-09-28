-- Cuentas por pagar por proveedor y líneas de crédito (Laura, 28-sep-2026):
-- el "primer candado" al revisar OC. Los nombres de proveedor vienen
-- distintos en OC ("MAQUI PRINT SA DE CV"), CFDI ("MAQUI PRINT") y bancos:
-- se agrupan por una clave normalizada sin razón social ni puntuación
-- (fn_proveedor_clave). Pagado = complementos de pago + cargos bancarios
-- cuyo nombre coincide; si el banco trae otro nombre no se detecta y el
-- "por pagar" sale alto (se dice en pantalla). Ya aplicado en producción.
create or replace function public.fn_proveedor_clave(p_nombre text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(regexp_replace(regexp_replace(
    upper(translate(coalesce(p_nombre, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')),
    '[^A-Z0-9 ]', ' ', 'g'),
    '\m(S ?A ?B?|S ?A ?P ?I|S ?DE ?R ?L|S ?C|S ?A|DE|C ?V|SRL|SAPI|SAB|SA|CV|RL|SC|MI|R ?L)\M', ' ', 'g'),
    ' +', ' ', 'g')), '')
$$;

create table if not exists public.proveedores_credito (
  clave text primary key,
  nombre text not null,
  linea_credito numeric(14,2) not null default 0,
  dias_credito integer not null default 0,
  notas text,
  grupo_id uuid references public.grupos (id),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
create or replace function public.proveedores_credito_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.grupo_id is null then select grupo_id into new.grupo_id from public.profiles where id = auth.uid(); end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists proveedores_credito_defaults on public.proveedores_credito;
create trigger proveedores_credito_defaults before insert or update on public.proveedores_credito
  for each row execute function public.proveedores_credito_defaults();
alter table public.proveedores_credito enable row level security;
drop policy if exists frontera_organizacion on public.proveedores_credito;
create policy frontera_organizacion on public.proveedores_credito as restrictive for all
  using (grupo_id is null or public.grupo_en_alcance(grupo_id)) with check (grupo_id is null or public.grupo_en_alcance(grupo_id));
drop policy if exists proveedores_credito_select on public.proveedores_credito;
create policy proveedores_credito_select on public.proveedores_credito
  for select using (public.auth_rol() in ('admin', 'corporativo', 'direccion', 'empresa', 'almacen'));
drop policy if exists proveedores_credito_write on public.proveedores_credito;
create policy proveedores_credito_write on public.proveedores_credito
  for all using (public.auth_rol() in ('admin', 'corporativo', 'direccion')) with check (public.auth_rol() in ('admin', 'corporativo', 'direccion'));

-- Con security_invoker: cada quien ve lo que sus policies de OC, CFDI y
-- movimientos le dejan (Laura, dirección, ve todas las empresas).
create or replace view public.v_cxp_proveedores with (security_invoker = true) as
with oc as (
  select public.fn_proveedor_clave(proveedor) clave, min(proveedor) nombre, count(*) n_oc, sum(total) comprometido,
         max(fecha_creacion) ultima_oc, array_agg(distinct empresa_id) empresas
  from public.ordenes_compra where public.fn_proveedor_clave(proveedor) is not null and public.fn_proveedor_clave(proveedor) <> 'TOTAL'
  group by 1
), fac as (
  select public.fn_proveedor_clave(contraparte) clave, min(contraparte) nombre,
         count(*) filter (where not coalesce(es_complemento_pago, false)) n_facturas,
         sum(total) filter (where not coalesce(es_complemento_pago, false)) facturado,
         sum(total) filter (where coalesce(es_complemento_pago, false)) pagado_complementos,
         max(fecha) filter (where not coalesce(es_complemento_pago, false)) ultima_factura,
         array_agg(distinct empresa_id) empresas
  from public.cfdi where tipo = 'recibido' and public.fn_proveedor_clave(contraparte) is not null
  group by 1
), pag as (
  select public.fn_proveedor_clave(nombre_razon_social) clave, sum(cargo_total) pagado_bancos, max(fecha_pago) ultimo_pago
  from public.movimientos where cargo_total > 0 and public.fn_proveedor_clave(nombre_razon_social) is not null
  group by 1
)
select coalesce(oc.clave, fac.clave) as clave,
       coalesce(cr.nombre, fac.nombre, oc.nombre) as proveedor,
       coalesce(oc.n_oc, 0) as n_oc,
       coalesce(oc.comprometido, 0) as comprometido,
       coalesce(fac.n_facturas, 0) as n_facturas,
       coalesce(fac.facturado, 0) as facturado,
       coalesce(fac.pagado_complementos, 0) + coalesce(pag.pagado_bancos, 0) as pagado,
       greatest(coalesce(fac.facturado, 0) - coalesce(fac.pagado_complementos, 0) - coalesce(pag.pagado_bancos, 0), 0) as por_pagar,
       greatest(coalesce(oc.comprometido, 0) - coalesce(fac.facturado, 0), 0) as sin_facturar,
       cr.linea_credito, cr.dias_credito, cr.notas,
       case when cr.linea_credito is null then null else cr.linea_credito - greatest(coalesce(fac.facturado, 0) - coalesce(fac.pagado_complementos, 0) - coalesce(pag.pagado_bancos, 0), 0) end as disponible,
       oc.ultima_oc, fac.ultima_factura, pag.ultimo_pago,
       (select array_agg(distinct e) from unnest(coalesce(oc.empresas, '{}'::uuid[]) || coalesce(fac.empresas, '{}'::uuid[])) e) as empresas
from oc
full join fac on fac.clave = oc.clave
left join pag on pag.clave = coalesce(oc.clave, fac.clave)
left join public.proveedores_credito cr on cr.clave = coalesce(oc.clave, fac.clave);
grant select on public.v_cxp_proveedores to authenticated;

create or replace function public.fn_cxp_proveedor_detalle(p_clave text)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'ordenes', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'id_orden', o.id_orden, 'tipo', o.tipo, 'fecha', o.fecha_creacion, 'proyecto', o.proyecto, 'total', o.total, 'empresa_id', o.empresa_id, 'proveedor', o.proveedor) order by o.fecha_creacion desc), '[]'::jsonb)
                 from (select * from public.ordenes_compra where public.fn_proveedor_clave(proveedor) = p_clave order by fecha_creacion desc limit 200) o),
    'facturas', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'folio', c.folio, 'fecha', c.fecha, 'total', c.total, 'empresa_id', c.empresa_id, 'contraparte', c.contraparte, 'rfc', c.rfc, 'complemento', coalesce(c.es_complemento_pago, false)) order by c.fecha desc), '[]'::jsonb)
                  from (select * from public.cfdi where tipo = 'recibido' and public.fn_proveedor_clave(contraparte) = p_clave order by fecha desc limit 200) c),
    'pagos', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'fecha', m.fecha_pago, 'monto', m.cargo_total, 'empresa_id', m.empresa_id, 'nombre', m.nombre_razon_social, 'referencia', m.referencia_numero, 'factura', m.factura) order by m.fecha_pago desc), '[]'::jsonb)
               from (select * from public.movimientos where cargo_total > 0 and public.fn_proveedor_clave(nombre_razon_social) = p_clave order by fecha_pago desc limit 200) m)
  )
$$;
grant execute on function public.fn_cxp_proveedor_detalle(text) to authenticated;
grant execute on function public.fn_proveedor_clave(text) to authenticated, anon;
