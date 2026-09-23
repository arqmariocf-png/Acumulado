-- Vincula el checador (entrada/salida por cuenta, ya existente) con la
-- nómina real de RH, pedido por el cliente 2026-09-11:
--   1. personal.profile_id -- liga a la persona de RH con su cuenta de
--      acceso una vez que la tenga (igual que responsable_id/comprador_id
--      en proyectos), para que pueda checar desde su celular.
--   2. v_asistencia_semanal_personal -- lista de nómina: días que checó
--      entrada en la semana x sueldo_semanal de su contratación vigente ese
--      día. Es informativo (el monto sugerido es el sueldo semanal
--      completo) -- quien arma la nómina ajusta a mano por faltas/
--      incidencias, esto NO calcula descuentos ni impuestos.
--   3. v_proyeccion_nomina_semanal -- proyección simple: suma
--      sueldo_semanal de las contrataciones vigentes por empresa, semana a
--      semana, las próximas 12 semanas.
--
-- OJO: esto es un segundo criterio de asistencia además de
-- asignaciones_diarias (captura manual de RH, ver 20260821090004) -- no lo
-- reemplaza ni lo concilia automáticamente todavía, son dos señales
-- paralelas que RH compara a mano por ahora.

alter table public.personal add column profile_id uuid references public.profiles (id);
create unique index personal_profile_id_key on public.personal (profile_id) where profile_id is not null;

create view public.v_asistencia_semanal_personal with (security_invoker = true) as
select
  p.id as personal_id,
  p.nombre as personal_nombre,
  c.id as contratacion_id,
  c.empresa_id,
  date_trunc('week', cr.created_at)::date as semana_inicio,
  count(distinct cr.created_at::date) filter (where cr.tipo = 'entrada') as dias_checados,
  c.sueldo_semanal
from public.personal p
join public.contrataciones c on c.personal_id = p.id
join public.checador_registros cr
  on cr.profile_id = p.profile_id
  and cr.created_at::date between c.fecha_inicio and c.fecha_fin
where p.profile_id is not null
group by p.id, p.nombre, c.id, c.empresa_id, date_trunc('week', cr.created_at)::date, c.sueldo_semanal;

comment on view public.v_asistencia_semanal_personal is 'Días con marca de entrada en el checador por semana, cruzados con el sueldo de la contratación vigente ese día -- informativo para armar la lista de nómina, no calcula el monto final ni descuentos.';

create view public.v_proyeccion_nomina_semanal with (security_invoker = true) as
select
  c.empresa_id,
  gs.semana::date as semana_inicio,
  sum(c.sueldo_semanal) as monto_proyectado
from public.contrataciones c
cross join lateral generate_series(
  date_trunc('week', current_date),
  date_trunc('week', current_date) + interval '11 weeks',
  interval '1 week'
) as gs(semana)
where gs.semana::date between date_trunc('week', c.fecha_inicio)::date and date_trunc('week', c.fecha_fin)::date
group by c.empresa_id, gs.semana::date;

comment on view public.v_proyeccion_nomina_semanal is 'Proyección simple de gasto de nómina: suma sueldo_semanal de contrataciones vigentes por empresa, las próximas 12 semanas desde hoy.';
