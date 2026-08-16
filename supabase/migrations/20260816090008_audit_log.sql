-- Bitácora de cambios a movimientos: quién cambió qué y cuándo. Se usa tanto
-- para trazabilidad financiera como para investigar conflictos de edición
-- concurrente (sección 7.4 del spec).
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tabla text not null,
  registro_id uuid not null,
  accion text not null check (accion in ('insert', 'update', 'delete')),
  usuario_id uuid references auth.users (id),
  datos_previos jsonb,
  datos_nuevos jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_registro_idx on public.audit_log (tabla, registro_id);

create or replace function public.audit_movimientos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (tabla, registro_id, accion, usuario_id, datos_previos, datos_nuevos)
  values (
    'movimientos',
    coalesce(new.id, old.id),
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger movimientos_audit
  after insert or update or delete on public.movimientos
  for each row
  execute function public.audit_movimientos();
