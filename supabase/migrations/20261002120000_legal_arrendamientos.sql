-- Contratos de arrendamiento (Mario, 2-oct-2026: "ya tienes el de crédito,
-- ahora va el de arrendamiento"). Machote tomado del contrato CSC →
-- Ergodinova del 1-sep-2023; el texto vive en web/src/lib/contratoArrendamiento.ts.
--
--   * legal_arrendamientos: cada contrato generado. empresa_id = nuestra
--     empresa; papel = si es ARRENDADOR (renta su inmueble) o ARRENDATARIO
--     (renta uno ajeno). Folio ARR-<empresa>-0001, inmueble, renta, inicio,
--     fin (= vencimiento, con semáforo en la pantalla), estatus y `datos` =
--     foto exacta de lo que se imprimió.
--   * legal_documentos.arrendamiento_id: el escaneado firmado se sube por la
--     edge legal-documentos (arrendamientoId / ?arrendamiento=).
-- Lo operan quien tiene el permiso 'legal' y el admin.
--
-- Ya aplicado en producción.

create table if not exists public.legal_arrendamientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  papel text not null default 'arrendador' check (papel in ('arrendador', 'arrendatario')),
  folio text,
  contraparte text not null check (length(trim(contraparte)) > 0),
  inmueble text not null check (length(trim(inmueble)) > 0),
  renta numeric(14,2) not null check (renta > 0),
  iva_incluido boolean not null default true,
  inicio date not null,
  fin date not null,
  fecha_firma date not null default current_date,
  datos jsonb not null default '{}'::jsonb,
  estatus text not null default 'borrador' check (estatus in ('borrador', 'firmado', 'terminado', 'cancelado')),
  firmado_en date,
  notas text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, folio),
  check (fin > inicio)
);
create index if not exists legal_arrendamientos_empresa_idx on public.legal_arrendamientos (empresa_id, fin);

create or replace function public.legal_arrendamientos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and nullif(trim(new.folio), '') is null then
    new.folio := public.fn_siguiente_folio(new.empresa_id, 'ARR');
  end if;
  if new.estatus = 'firmado' and new.firmado_en is null then new.firmado_en := current_date; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists legal_arrendamientos_antes on public.legal_arrendamientos;
create trigger legal_arrendamientos_antes before insert or update on public.legal_arrendamientos
  for each row execute function public.legal_arrendamientos_antes();

alter table public.legal_arrendamientos enable row level security;

drop policy if exists frontera_organizacion on public.legal_arrendamientos;
create policy frontera_organizacion on public.legal_arrendamientos as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
drop policy if exists legal_arrendamientos_select on public.legal_arrendamientos;
create policy legal_arrendamientos_select on public.legal_arrendamientos for select to authenticated
  using ((select public.auth_opera_legal()) and 'legal' = any ((select public.auth_modulos_habilitados())::text[])
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists legal_arrendamientos_insert on public.legal_arrendamientos;
create policy legal_arrendamientos_insert on public.legal_arrendamientos for insert to authenticated
  with check ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
              and 'legal' = any ((select public.auth_modulos_habilitados())::text[])
              and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists legal_arrendamientos_update on public.legal_arrendamientos;
create policy legal_arrendamientos_update on public.legal_arrendamientos for update to authenticated
  using ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
  with check ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
              and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists legal_arrendamientos_delete on public.legal_arrendamientos;
create policy legal_arrendamientos_delete on public.legal_arrendamientos for delete to authenticated
  using ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
         and estatus in ('borrador', 'cancelado')
         and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
drop policy if exists director_general on public.legal_arrendamientos;
create policy director_general on public.legal_arrendamientos for all to authenticated
  using ((select public.auth_admin_global_definer()))
  with check ((select public.auth_admin_global_definer()));
drop trigger if exists solo_consulta on public.legal_arrendamientos;
create trigger solo_consulta before insert or update or delete on public.legal_arrendamientos
  for each statement execute function public.bloquear_solo_consulta();
grant select, insert, update, delete on public.legal_arrendamientos to authenticated;

-- Escaneado firmado del arrendamiento.
alter table public.legal_documentos add column if not exists arrendamiento_id uuid
  references public.legal_arrendamientos(id) on delete cascade;
create index if not exists legal_documentos_arrendamiento_idx on public.legal_documentos (arrendamiento_id);
alter table public.legal_documentos drop constraint if exists legal_documentos_check;
alter table public.legal_documentos add constraint legal_documentos_check
  check (asunto_id is not null or contrato_id is not null or arrendamiento_id is not null);
drop policy if exists legal_documentos_select on public.legal_documentos;
create policy legal_documentos_select on public.legal_documentos for select to authenticated
  using (exists (select 1 from public.legal_asuntos a where a.id = legal_documentos.asunto_id)
         or exists (select 1 from public.legal_contratos c where c.id = legal_documentos.contrato_id)
         or exists (select 1 from public.legal_arrendamientos r where r.id = legal_documentos.arrendamiento_id));
