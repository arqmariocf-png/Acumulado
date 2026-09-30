-- Fotos de la entrega en las remisiones de producción (Mario, 30-sep-2026:
-- "separar inventario de entradas y salidas, con un consultable de las
-- existentes, para revisar su remisión con QR y la foto de la entrega").
-- Los archivos van al bucket privado "cargas" (remisiones-produccion/…) por la
-- edge remisiones-produccion-foto (service role); aquí solo el registro. Las
-- ve quien ve la remisión; borra admin/corporativo.
--
-- Ya aplicado en producción.

create table if not exists public.remisiones_produccion_fotos (
  id uuid primary key default gen_random_uuid(),
  remision_id uuid not null references public.remisiones_produccion(id) on delete cascade,
  storage_path text not null,
  nombre text,
  subido_por uuid references auth.users(id),
  subido_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists remisiones_produccion_fotos_rem_idx on public.remisiones_produccion_fotos (remision_id);

alter table public.remisiones_produccion_fotos enable row level security;
drop policy if exists frontera_organizacion on public.remisiones_produccion_fotos;
create policy frontera_organizacion on public.remisiones_produccion_fotos as restrictive for all
  using (exists (select 1 from public.remisiones_produccion r where r.id = remisiones_produccion_fotos.remision_id and r.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])))
  with check (exists (select 1 from public.remisiones_produccion r where r.id = remisiones_produccion_fotos.remision_id and r.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])));
drop policy if exists remisiones_produccion_fotos_select on public.remisiones_produccion_fotos;
create policy remisiones_produccion_fotos_select on public.remisiones_produccion_fotos for select to authenticated
  using (exists (select 1 from public.remisiones_produccion r where r.id = remisiones_produccion_fotos.remision_id));
drop policy if exists remisiones_produccion_fotos_delete on public.remisiones_produccion_fotos;
create policy remisiones_produccion_fotos_delete on public.remisiones_produccion_fotos for delete to authenticated
  using ((select public.auth_rol_definer()) = any (array['admin', 'corporativo']::app_rol[]));
drop trigger if exists solo_consulta on public.remisiones_produccion_fotos;
create trigger solo_consulta before insert or update or delete on public.remisiones_produccion_fotos
  for each statement execute function public.bloquear_solo_consulta();
grant select, delete on public.remisiones_produccion_fotos to authenticated;

create or replace view public.v_remisiones_produccion as
 SELECT r.id, r.empresa_id, r.numero, r.folio, r.tipo, r.fecha, r.contraparte, r.proyecto_id, r.orden_venta_id, r.orden_compra_id,
    r.observaciones, r.estatus, r.emitida_por, r.entregada_en, r.entregada_por, r.recibio_nombre, r.created_at,
    e.nombre AS empresa_nombre, e.rfc AS empresa_rfc, e.codigo AS empresa_codigo, p.nombre AS emitida_por_nombre, pr.nombre AS proyecto_nombre,
    ( SELECT count(*) AS count FROM remisiones_produccion_lineas l WHERE l.remision_id = r.id) AS lineas,
    r.cliente_id, c.rfc AS cliente_rfc, c.domicilio AS cliente_domicilio,
    r.condicion_pago, r.dias_credito,
    ( SELECT count(*) FROM remisiones_produccion_fotos f WHERE f.remision_id = r.id) AS fotos
   FROM remisiones_produccion r
     JOIN empresas e ON e.id = r.empresa_id
     LEFT JOIN profiles p ON p.id = r.emitida_por
     LEFT JOIN proyectos pr ON pr.id = r.proyecto_id
     LEFT JOIN clientes c ON c.id = r.cliente_id;
