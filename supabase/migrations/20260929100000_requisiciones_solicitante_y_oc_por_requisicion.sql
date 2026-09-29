-- Flujo simplificado de compras (Mario, 29-sep-2026: "simplifica el proceso"):
-- 1. `requisiciones.solicitante_nombre`: el nombre de quien pidió se guarda en
--    la requisición al crearla. Antes se leía con un embed a profiles y, como
--    profiles solo deja leer el renglón propio, a almacén le salía en blanco.
-- 2. `v_requisicion_ordenes`: las OC RQ de cada requisición (por la partida →
--    necesidad → renglón), para mostrarlas y abrirlas desde la requisición.
--    security_invoker: cada quien ve las OC que sus policies le dejan.
-- Ya aplicado en producción.

alter table public.requisiciones add column if not exists solicitante_nombre text;

create or replace function public.requisiciones_solicitante_nombre()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.solicitante_nombre is null or btrim(new.solicitante_nombre) = '' then
    select p.nombre into new.solicitante_nombre from public.profiles p where p.id = new.solicitado_por;
  end if;
  return new;
end;
$$;

drop trigger if exists requisiciones_solicitante_nombre on public.requisiciones;
create trigger requisiciones_solicitante_nombre
  before insert on public.requisiciones
  for each row execute function public.requisiciones_solicitante_nombre();

update public.requisiciones r
  set solicitante_nombre = p.nombre
  from public.profiles p
  where p.id = r.solicitado_por and (r.solicitante_nombre is null or btrim(r.solicitante_nombre) = '');

create or replace view public.v_requisicion_ordenes with (security_invoker = true) as
select distinct on (rl.requisicion_id, oc.id)
  rl.requisicion_id,
  oc.id as orden_compra_id,
  oc.id_orden,
  oc.proveedor,
  oc.total,
  oc.fecha_creacion,
  oc.autorizada_en,
  oc.created_at
from public.necesidades_compra nc
join public.requisicion_lineas rl on rl.id = nc.requisicion_linea_id
join public.ordenes_compra oc on oc.id = nc.orden_compra_id
where oc.fuente = 'requisicion';

grant select on public.v_requisicion_ordenes to authenticated;

-- 3. Renglones y necesidades visibles para quien ve la requisición. Antes
--    `requisicion_lineas_select` no incluía a almacén ni a quien la pidió
--    (Jonathan veía el encabezado y no sus renglones; Alma solo los veía por
--    tener "todas las empresas"). Las policies de `requisiciones` ya deciden
--    quién ve cada una; aquí solo se hereda (RLS aplica dentro del EXISTS).
drop policy if exists requisicion_lineas_select on public.requisicion_lineas;
create policy requisicion_lineas_select on public.requisicion_lineas for select to authenticated
  using (exists (select 1 from public.requisiciones r where r.id = requisicion_lineas.requisicion_id));

drop policy if exists necesidades_compra_select on public.necesidades_compra;
create policy necesidades_compra_select on public.necesidades_compra for select to authenticated
  using (exists (select 1 from public.requisicion_lineas rl where rl.id = necesidades_compra.requisicion_linea_id));

drop policy if exists necesidades_entrega_select on public.necesidades_entrega;
create policy necesidades_entrega_select on public.necesidades_entrega for select to authenticated
  using (exists (select 1 from public.requisicion_lineas rl where rl.id = necesidades_entrega.requisicion_linea_id));
