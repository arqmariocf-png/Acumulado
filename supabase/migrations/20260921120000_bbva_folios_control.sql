-- Control BBVA nuevo (21-sep-2026, "Mantenimiento - KPIs de cobranza.xlsx"):
-- una fila por trabajo con el estatus de cada paso. Se guarda el detalle
-- para ver en qué paso va cada folio y cruzarlo con el semáforo de
-- cuadrillas (bbva_folios_cuadrilla). Se reemplaza con cada carga del
-- control (upsert por id_interno); el corte agregado sigue en
-- bbva_mantenimiento_snapshots.
create table public.bbva_folios_control (
  id_interno text primary key,
  folio text,
  cr text,
  sucursal text,
  solicitud text,
  fecha_recepcion date,
  fecha_primera_atencion date,
  prioridad text,
  fecha_compromiso_cliente date,
  supervisor text,
  equipo text,
  fecha_programada date,
  ventana_acceso text,
  estatus_operativo text,
  motivo_bloqueo text,
  siguiente_accion text,
  responsable_siguiente text,
  fecha_compromiso_siguiente date,
  fecha_ultima_actualizacion date,
  alerta_siguiente_paso text,
  fecha_finalizacion date,
  fecha_aceptacion_cliente date,
  generadores text,
  reporte_fotografico text,
  caratula text,
  presupuesto text,
  soportes_completos text,
  fecha_envio_soportes date,
  autorizacion text,
  fecha_autorizacion date,
  accion_fichero text,
  fecha_fichero date,
  etapa_seguimiento text,
  enlace_evidencia text,
  monto_a_cobrar numeric(14,2),
  pedido text,
  factura text,
  observaciones text,
  revision_registro text,
  fecha_recepcion_pedido date,
  fecha_recepcion_factura date,
  estado_pago text,
  monto_cobrado numeric(14,2),
  monto_solicitado numeric(14,2),
  pago_aplicado numeric(14,2),
  saldo_por_cobrar numeric(14,2),
  revision_cobranza text,
  corte_id uuid references public.bbva_mantenimiento_snapshots (id),
  actualizado_en timestamptz not null default now()
);

create index bbva_folios_control_folio_idx on public.bbva_folios_control (folio);
create index bbva_folios_control_supervisor_idx on public.bbva_folios_control (supervisor, etapa_seguimiento);

alter table public.bbva_folios_control enable row level security;

create policy bbva_folios_control_select on public.bbva_folios_control
  for select to authenticated
  using (auth_rol() in ('corporativo', 'direccion', 'admin') or auth_bbva_mantenimiento());

create policy bbva_folios_control_write on public.bbva_folios_control
  for all to authenticated
  using (auth_rol() in ('corporativo', 'admin') or auth_bbva_mantenimiento())
  with check (auth_rol() in ('corporativo', 'admin') or auth_bbva_mantenimiento());

-- Los supervisores de cuadrilla ven en qué paso va cada folio del control
-- (sin montos): vista con definer acotada a su rol y a los roles que ya
-- ven el control completo.
create view public.v_bbva_folio_paso with (security_invoker = false) as
select id_interno, folio, cr, sucursal, supervisor, equipo, estatus_operativo, etapa_seguimiento, alerta_siguiente_paso,
  fecha_recepcion, fecha_programada, fecha_finalizacion, soportes_completos, fecha_envio_soportes, autorizacion, fecha_autorizacion,
  accion_fichero, fecha_fichero, pedido is not null as tiene_pedido, factura is not null as tiene_factura, estado_pago, actualizado_en
from public.bbva_folios_control
where auth_rol() in ('supervisor_bbva', 'corporativo', 'direccion', 'admin') or auth_bbva_mantenimiento();

grant select on public.v_bbva_folio_paso to authenticated;
