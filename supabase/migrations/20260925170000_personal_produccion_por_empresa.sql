-- Producción (Clavicón/Balken): en el selector de personal solo debe salir
-- quien tiene su alta (contratación vigente) en esa planta, no toda la
-- plantilla del grupo (Mario, 25-sep-2026). Se agrega al FINAL de la vista la
-- empresa de la contratación vigente; la pantalla filtra por la empresa de
-- la planta. Sin contratación vigente, empresa_id es null y no aparece.
-- Ya aplicado en producción.

create or replace view public.v_personal_produccion as
select pe.id,
       pe.nombre,
       pe.puesto,
       pe.area,
       c.sueldo_semanal,
       coalesce(pj.horas_semana, 48::numeric) as horas_semana,
       coalesce(pj.dias_semana, 6) as dias_semana,
       round(coalesce(pj.horas_semana, 48::numeric) / coalesce(pj.dias_semana, 6)::numeric, 2) as horas_dia,
       case
         when c.sueldo_semanal is null then null::numeric
         else round(c.sueldo_semanal / coalesce(pj.horas_semana, 48::numeric), 2)
       end as costo_hora,
       c.empresa_id
from public.personal pe
left join lateral (
  select c_1.sueldo_semanal, c_1.empresa_id
  from public.contrataciones c_1
  where c_1.personal_id = pe.id
    and c_1.fecha_inicio <= current_date
    and (c_1.fecha_fin is null or c_1.fecha_fin >= current_date)
  order by c_1.fecha_inicio desc
  limit 1
) c on true
left join public.perfiles_jornada pj on pj.id = coalesce(pe.perfil_jornada_id, (select id from public.perfiles_jornada where es_base))
where pe.activo
  and (public.auth_rol() = any (array['produccion'::app_rol, 'admin'::app_rol, 'corporativo'::app_rol, 'rh'::app_rol]));
