-- Observaciones de RH (Eréndira, 22-sep-2026):
-- 1. Área del personal: Operativo / Administrativo, además del equipo de
--    mantenimiento BBVA (que alimenta el punto de equilibrio de Christian).
-- 2. Contratación: frecuencia de pago (semanal / quincenal) y el monto por
--    periodo. sueldo_semanal se conserva como base de nómina, finiquito y
--    proyecciones (para quincenal la app lo deriva: quincenal × 24 / 52).
alter table public.personal drop constraint personal_area_check;
alter table public.personal
  add constraint personal_area_check check (area in ('operativo', 'administrativo', 'bbva_puebla'));

alter table public.contrataciones
  add column frecuencia_pago text not null default 'semanal' check (frecuencia_pago in ('semanal', 'quincenal')),
  add column sueldo_periodo numeric(10, 2) check (sueldo_periodo is null or sueldo_periodo > 0);

update public.contrataciones set sueldo_periodo = sueldo_semanal where sueldo_periodo is null;

comment on column public.contrataciones.sueldo_periodo is 'Monto que se paga en cada periodo (semana o quincena, según frecuencia_pago). sueldo_semanal es el equivalente semanal que usan nómina y finiquito.';
