-- Programación de pagos para Finanzas (Laura, rol dirección; pedido de
-- Mario, 23-sep-2026): calendario de pagos por empresa y cuenta con
-- estatus, para compararlo contra los saldos de cierre. Dirección
-- normalmente solo lee datos financieros; aquí se le abre escritura solo
-- sobre esta tabla.
create table public.pagos_programados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  cuenta_id uuid references public.cuentas_bancarias (id),
  beneficiario text not null,
  concepto text,
  monto numeric(14, 2) not null check (monto > 0),
  fecha_programada date not null,
  estatus text not null default 'pendiente' check (estatus in ('pendiente', 'pagado', 'cancelado')),
  pagado_en date,
  referencia text,
  notas text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pagos_programados_fecha_idx on public.pagos_programados (estatus, fecha_programada);
create index pagos_programados_empresa_idx on public.pagos_programados (empresa_id, fecha_programada);

create trigger pagos_programados_set_updated_at before update on public.pagos_programados for each row execute function public.set_updated_at();

alter table public.pagos_programados enable row level security;

create policy pagos_programados_select on public.pagos_programados
  for select using (
    public.auth_rol() in ('direccion', 'corporativo', 'admin', 'empresa')
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy pagos_programados_write on public.pagos_programados
  for all using (
    public.auth_rol() in ('direccion', 'corporativo', 'admin')
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  ) with check (
    public.auth_rol() in ('direccion', 'corporativo', 'admin')
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );
