-- Cotizador de planta (Mario, 30-sep-2026: "en la última pestaña dentro de
-- Clavicón tener el cotizador"). Cotizaciones con folio COT-<empresa>-0001,
-- cliente, vigencia, contado/crédito y partidas de producto terminado con
-- precio de venta (sin IVA; la pantalla captura con IVA incluido) y el costo
-- real congelado al cotizar (promedio ponderado de los lotes) para ver el
-- margen antes de cerrar. La cotización impresa no lleva costos.
--
-- Ya aplicado en producción.

create table if not exists public.cotizaciones_produccion (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  folio text,
  fecha date not null default ((now() at time zone 'America/Mexico_City')::date),
  cliente_id uuid references public.clientes(id),
  contraparte text not null,
  obra text,
  vigencia_dias integer not null default 15 check (vigencia_dias > 0),
  condicion_pago text check (condicion_pago in ('contado', 'credito')),
  dias_credito integer check (dias_credito is null or dias_credito > 0),
  notas text,
  estatus text not null default 'enviada' check (estatus in ('enviada', 'aceptada', 'rechazada')),
  created_by uuid default auth.uid() references auth.users(id),
  created_by_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists cotizaciones_produccion_empresa_idx on public.cotizaciones_produccion (empresa_id, fecha desc);

create table if not exists public.cotizaciones_produccion_lineas (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references public.cotizaciones_produccion(id) on delete cascade,
  orden integer not null default 0,
  producto_id uuid references public.productos_produccion(id),
  descripcion text not null,
  cantidad numeric(14,4) not null check (cantidad > 0),
  unidad text not null default 'pza',
  precio_unitario numeric(14,4) not null check (precio_unitario >= 0),
  costo_unitario numeric(14,4)
);
create index if not exists cotizaciones_produccion_lineas_cot_idx on public.cotizaciones_produccion_lineas (cotizacion_id);

create or replace function public.cotizaciones_produccion_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.folio is null then
    new.folio := public.fn_siguiente_folio(new.empresa_id, 'COT');
  end if;
  new.created_by := coalesce(new.created_by, (select auth.uid()));
  new.created_by_nombre := (select nombre from public.profiles where id = new.created_by);
  return new;
end;
$$;
drop trigger if exists cotizaciones_produccion_antes on public.cotizaciones_produccion;
create trigger cotizaciones_produccion_antes before insert on public.cotizaciones_produccion
  for each row execute function public.cotizaciones_produccion_antes();

create or replace function public.cotizaciones_produccion_lineas_costo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.producto_id is not null and new.costo_unitario is null then
    select s.costo_promedio_ponderado into new.costo_unitario from public.v_stock_producto_terminado s where s.producto_id = new.producto_id;
  end if;
  return new;
end;
$$;
drop trigger if exists cotizaciones_produccion_lineas_costo on public.cotizaciones_produccion_lineas;
create trigger cotizaciones_produccion_lineas_costo before insert on public.cotizaciones_produccion_lineas
  for each row execute function public.cotizaciones_produccion_lineas_costo();

alter table public.cotizaciones_produccion enable row level security;
alter table public.cotizaciones_produccion_lineas enable row level security;

drop policy if exists frontera_organizacion on public.cotizaciones_produccion;
create policy frontera_organizacion on public.cotizaciones_produccion as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
drop policy if exists cotizaciones_produccion_planta on public.cotizaciones_produccion;
create policy cotizaciones_produccion_planta on public.cotizaciones_produccion for all to authenticated
  using ((select public.auth_rol_definer()) = any (array['produccion', 'admin', 'corporativo', 'direccion', 'empresa']::app_rol[])
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
  with check ((select public.auth_rol_definer()) = any (array['produccion', 'admin', 'corporativo', 'direccion', 'empresa']::app_rol[])
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));

drop policy if exists frontera_organizacion on public.cotizaciones_produccion_lineas;
create policy frontera_organizacion on public.cotizaciones_produccion_lineas as restrictive for all
  using (exists (select 1 from public.cotizaciones_produccion c where c.id = cotizaciones_produccion_lineas.cotizacion_id and c.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])))
  with check (exists (select 1 from public.cotizaciones_produccion c where c.id = cotizaciones_produccion_lineas.cotizacion_id and c.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])));
drop policy if exists cotizaciones_produccion_lineas_planta on public.cotizaciones_produccion_lineas;
create policy cotizaciones_produccion_lineas_planta on public.cotizaciones_produccion_lineas for all to authenticated
  using (exists (select 1 from public.cotizaciones_produccion c where c.id = cotizaciones_produccion_lineas.cotizacion_id))
  with check (exists (select 1 from public.cotizaciones_produccion c where c.id = cotizaciones_produccion_lineas.cotizacion_id));

drop trigger if exists solo_consulta on public.cotizaciones_produccion;
create trigger solo_consulta before insert or update or delete on public.cotizaciones_produccion for each statement execute function public.bloquear_solo_consulta();
drop trigger if exists solo_consulta on public.cotizaciones_produccion_lineas;
create trigger solo_consulta before insert or update or delete on public.cotizaciones_produccion_lineas for each statement execute function public.bloquear_solo_consulta();

grant select, insert, update, delete on public.cotizaciones_produccion, public.cotizaciones_produccion_lineas to authenticated;
