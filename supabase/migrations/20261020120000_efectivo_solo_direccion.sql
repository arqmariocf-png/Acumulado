-- El efectivo no es de tesorería (20-oct-2026, Mario: "a Delia no le tocaría
-- ver y confirmar pagos en efectivo"). Tesorería ya no lista el efectivo; en
-- la base, solo dirección o admin dejan un pago en efectivo como pagado o
-- confirmado (por la edge pagos-comprobante, fn_oc_confirmar_pagadas o un
-- update directo). Procesos sin usuario (cron, service_role) no se tocan.
-- Ya aplicado en producción (efectivo_solo_direccion).

create or replace function public.pagos_programados_efectivo_guarda()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.metodo is distinct from 'efectivo' or auth.uid() is null then
    return new;
  end if;
  if public.auth_rol()::text in ('admin', 'direccion') then
    return new;
  end if;
  if new.confirmado_en is not null and (tg_op = 'INSERT' or old.confirmado_en is null) then
    raise exception 'Los pagos en efectivo los confirma dirección (Efectivo por confirmar).' using errcode = '42501';
  end if;
  if new.estatus = 'pagado' and (tg_op = 'INSERT' or old.estatus is distinct from 'pagado') then
    raise exception 'Los pagos en efectivo los marca como pagados dirección (Efectivo por confirmar).' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace trigger pagos_programados_efectivo_guarda
  before insert or update on public.pagos_programados
  for each row execute function public.pagos_programados_efectivo_guarda();
