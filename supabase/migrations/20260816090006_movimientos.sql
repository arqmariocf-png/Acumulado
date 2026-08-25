-- Tabla principal: un renglón por movimiento bancario. Es el reemplazo directo
-- de las hojas mensuales de Acumulado_Bancos_2026.xlsx.
create table public.movimientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  cuenta_id uuid not null references public.cuentas_bancarias (id),
  archivo_id uuid references public.archivos_cargados (id),

  tipo_movimiento text not null default 'Bancos',
  folio text,
  fecha_pago date not null,
  fecha_orden date,

  proyecto text,
  nombre_razon_social text,

  cargo_total numeric(14, 2),
  abono_total numeric(14, 2),
  saldo numeric(14, 2) not null,

  referencia_tipo text check (referencia_tipo in ('OC', 'OS', 'OV', 'OF')),
  referencia_numero text,

  factura text,
  comentarios text,
  observacion text,

  -- Resultado del motor de conciliación (ver sección 4 del spec):
  --   resuelto            -> Proyecto/Nombre/Factura completos o N/A justificado
  --   pendiente_esperado  -> falta un dato pero es una excepción documentada (🟡)
  --   pendiente_revision  -> falta un dato sin explicación conocida (🔴)
  --   ambiguo             -> 2+ candidatos de FACTURA con el mismo monto (🟣)
  estado_clasificacion text not null default 'pendiente_revision'
    check (estado_clasificacion in ('resuelto', 'pendiente_esperado', 'pendiente_revision', 'ambiguo')),
  posible_duplicado boolean not null default false,

  -- Bloqueo optimista: toda actualización desde el frontend debe enviar la
  -- `version` que leyó; si no coincide, se rechaza el update (conflicto de
  -- edición concurrente, sección 7.4 del spec).
  version integer not null default 1,

  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Cargo y Abono nunca deben confundirse ni coexistir: un movimiento es
  -- exactamente uno de los dos (regla crítica de captura, sección 2 del spec).
  constraint movimientos_cargo_xor_abono check (num_nonnulls(cargo_total, abono_total) = 1)
);

create index movimientos_empresa_idx on public.movimientos (empresa_id);
create index movimientos_cuenta_fecha_idx on public.movimientos (cuenta_id, fecha_pago);
create index movimientos_estado_idx on public.movimientos (estado_clasificacion);
create index movimientos_referencia_idx on public.movimientos (referencia_tipo, referencia_numero);

-- Índice de apoyo para la deduplicación (sección 4.6): mismo Cuenta+Fecha+Monto+
-- Referencia. No es una constraint UNIQUE porque un duplicado real del banco
-- debe insertarse igual y quedar marcado para revisión, no rechazarse.
create index movimientos_dedupe_idx on public.movimientos (
  cuenta_id, fecha_pago, coalesce(cargo_total, 0), coalesce(abono_total, 0), referencia_numero
);

create trigger movimientos_set_updated_at
  before update on public.movimientos
  for each row
  execute function public.set_updated_at();

-- El bloqueo optimista se aplica en el trigger: cada UPDATE debe traer la
-- versión vigente en NEW.version (tal como la leyó el cliente); si no coincide
-- con la versión actual en la fila, se rechaza. Al aceptarse, se incrementa.
create or replace function public.check_movimientos_version()
returns trigger
language plpgsql
as $$
begin
  if new.version is distinct from old.version then
    raise exception 'CONFLICTO_EDICION: el movimiento % fue modificado por otro usuario (version esperada %, actual %)',
      old.id, new.version, old.version
      using errcode = 'P0001';
  end if;
  new.version = old.version + 1;
  return new;
end;
$$;

create trigger movimientos_check_version
  before update on public.movimientos
  for each row
  execute function public.check_movimientos_version();
