-- Lo que faltaba leer de cada XML del SAT para cuentas por cobrar (23-oct-2026):
-- tipo de comprobante (I ingreso, E nota de crédito, P pago, N nómina, T
-- traslado), método de pago (PUE se paga al facturar, PPD queda por cobrar
-- hasta su complemento), forma de pago y los CFDI relacionados (cada factura
-- que paga un complemento con su ImpPagado; la factura que corrige una nota de
-- crédito). Lo llena la edge sat-descarga-masiva; lo ya descargado se relee
-- de los ZIP guardados con { reprocesar: true }.
--
-- Ya aplicado en producción (cfdi_metodo_pago_relacionados).

alter table public.cfdi
  add column if not exists tipo_comprobante text,
  add column if not exists metodo_pago text,
  add column if not exists forma_pago text,
  add column if not exists relacionados jsonb not null default '[]'::jsonb;

create index if not exists cfdi_folio_upper_idx on public.cfdi (upper(folio));

-- ZIP del SAT cuyos CFDI aún no traen tipo de comprobante (solo la edge).
create or replace function public.fn_sat_archivos_por_reprocesar(p_limite int default 200)
returns table (id uuid, empresa_id uuid, tipo text, storage_path text)
language sql stable security definer set search_path = public as $$
  select a.id, a.empresa_id, a.tipo, a.storage_path
    from public.archivos_cargados a
   where a.storage_path like 'sat/%/descargas/%'
     and exists (select 1 from public.cfdi c where c.archivo_id = a.id and c.tipo_comprobante is null)
   order by a.created_at
   limit greatest(coalesce(p_limite, 200), 1)
$$;
revoke all on function public.fn_sat_archivos_por_reprocesar(int) from public, anon, authenticated;
grant execute on function public.fn_sat_archivos_por_reprocesar(int) to service_role;
