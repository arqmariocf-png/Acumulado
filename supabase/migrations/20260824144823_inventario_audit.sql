-- Misma bitácora que ya existe para `movimientos` (20260816090008_audit_log.sql)
-- aplicada a movimientos_inventario: quién registró qué entrada/salida y
-- cuándo, reutilizando la tabla audit_log existente.
create or replace function public.audit_movimientos_inventario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_previos, datos_nuevos)
  values (
    'movimientos_inventario',
    coalesce(new.id, old.id),
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger movimientos_inventario_audit
  after insert or update or delete on public.movimientos_inventario
  for each row
  execute function public.audit_movimientos_inventario();
