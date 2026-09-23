-- Notas de entrega (remisión en papel) fotografiadas cuando el proveedor no
-- trae QR ni código de barras -- se sube la foto (bucket "cargas", mismo
-- bucket privado que ya usa el resto de las cargas de archivos) y opcional-
-- mente se lee con IA de visión (edge function ocr-nota-entrega) para
-- sugerir los conceptos/cantidades; el usuario los confirma o los busca por
-- nombre a mano. Una nota ampara varios productos -- por eso es una tabla
-- propia y no una columna repetida en cada movimiento.
create table public.notas_entrega (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id),
  storage_path text not null,
  proveedor_sugerido text,
  fecha_sugerida date,
  -- Respuesta cruda de la IA de visión (items detectados + cualquier error
  -- de lectura) -- se conserva para poder revisar/depurar sin volver a
  -- llamar la API.
  texto_extraido jsonb,
  subido_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index notas_entrega_empresa_idx on public.notas_entrega (empresa_id, created_at);

alter table public.notas_entrega enable row level security;

create policy notas_entrega_select on public.notas_entrega
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
  );

create policy notas_entrega_insert on public.notas_entrega
  for insert
  with check (
    public.auth_puede_escribir_inventario()
    and (public.auth_ve_todas_empresas() or empresa_id = public.auth_empresa_id())
    and subido_por = (select auth.uid())
  );

-- Une un movimiento de entrada con la nota de la que salió (si vino de una
-- foto en vez de un código escaneado). Varios movimientos pueden compartir
-- la misma nota_entrega_id -- una nota trae varios productos.
alter table public.movimientos_inventario add column nota_entrega_id uuid references public.notas_entrega (id);
create index movimientos_inventario_nota_entrega_idx on public.movimientos_inventario (nota_entrega_id) where nota_entrega_id is not null;

-- Extiende la validación de empresa ya existente para cubrir también
-- nota_entrega_id (mismo criterio que almacén/producto/OC/OV: nunca debe
-- poder apuntar a un registro de otra empresa).
create or replace function public.validar_empresa_movimiento_inventario()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.almacenes where id = new.almacen_id and empresa_id = new.empresa_id) then
    raise exception 'El almacén no pertenece a la empresa del movimiento';
  end if;
  if not exists (select 1 from public.productos where id = new.producto_id and empresa_id = new.empresa_id) then
    raise exception 'El producto no pertenece a la empresa del movimiento';
  end if;
  if new.orden_compra_id is not null
    and not exists (select 1 from public.ordenes_compra where id = new.orden_compra_id and empresa_id = new.empresa_id) then
    raise exception 'La orden de compra no pertenece a la empresa del movimiento';
  end if;
  if new.orden_venta_id is not null
    and not exists (select 1 from public.ordenes_venta where id = new.orden_venta_id and empresa_id = new.empresa_id) then
    raise exception 'La orden de venta no pertenece a la empresa del movimiento';
  end if;
  if new.nota_entrega_id is not null
    and not exists (select 1 from public.notas_entrega where id = new.nota_entrega_id and empresa_id = new.empresa_id) then
    raise exception 'La nota de entrega no pertenece a la empresa del movimiento';
  end if;
  return new;
end;
$$;
