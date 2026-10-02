-- Expediente legal de cada empresa (Eréndira vía Mario, 2-oct-2026: "dentro
-- de los datos de las empresas hace observaciones y sugiere motivos de
-- protocolización de las actas, y también un espacio para adjuntar toda la
-- documentación legal con sus vencimientos").
--
--   * legal_empresa_documentos: acta constitutiva, asambleas, poderes, folio
--     mercantil, constancia de situación fiscal, opiniones de cumplimiento,
--     registro patronal, REPSE, licencias, contratos… con número, fecha,
--     vencimiento y el archivo (bucket privado "cargas" bajo
--     legal/<empresa>/expediente/…, por la edge legal-documentos).
--   * legal_empresa_observaciones: observaciones de legal sobre la empresa y
--     actas por protocolizar con su motivo (cambio de administrador, poderes,
--     aumento de capital…) y estatus pendiente → en notaría → protocolizada.
-- Los opera quien tiene el permiso 'legal' (Belén, Eréndira) y el admin.
--
-- Ya aplicado en producción.

create table if not exists public.legal_empresa_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null default 'otro'
    check (tipo in ('acta_constitutiva', 'acta_asamblea', 'poder', 'folio_mercantil', 'constancia_fiscal',
                    'opinion_sat', 'opinion_imss', 'opinion_infonavit', 'registro_patronal', 'repse',
                    'licencia_funcionamiento', 'proteccion_civil', 'contrato', 'otro')),
  nombre text not null check (length(trim(nombre)) > 0),
  numero text,
  fecha_documento date,
  vence date,
  notario text,
  notas text,
  storage_path text,
  archivo_nombre text,
  subido_por uuid references auth.users(id) default auth.uid(),
  subido_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists legal_empresa_documentos_empresa_idx on public.legal_empresa_documentos (empresa_id, vence);

create table if not exists public.legal_empresa_observaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null default 'observacion' check (tipo in ('observacion', 'protocolizacion')),
  titulo text not null check (length(trim(titulo)) > 0),
  motivo text,
  detalle text,
  estatus text not null default 'pendiente' check (estatus in ('pendiente', 'en_notaria', 'protocolizada', 'atendida', 'descartada')),
  fecha_limite date,
  resuelto_en date,
  autor_id uuid references auth.users(id) default auth.uid(),
  autor_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists legal_empresa_observaciones_empresa_idx on public.legal_empresa_observaciones (empresa_id, estatus);

-- Autor y fechas.
create or replace function public.legal_empresa_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'legal_empresa_observaciones' then
      new.autor_id := coalesce(new.autor_id, auth.uid());
      select p.nombre into new.autor_nombre from public.profiles p where p.id = new.autor_id;
    else
      new.subido_por := coalesce(new.subido_por, auth.uid());
      select p.nombre into new.subido_por_nombre from public.profiles p where p.id = new.subido_por;
    end if;
  end if;
  if tg_table_name = 'legal_empresa_observaciones' then
    if new.estatus in ('protocolizada', 'atendida', 'descartada') and new.resuelto_en is null then
      new.resuelto_en := current_date;
    elsif new.estatus in ('pendiente', 'en_notaria') then
      new.resuelto_en := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists legal_empresa_documentos_antes on public.legal_empresa_documentos;
create trigger legal_empresa_documentos_antes before insert or update on public.legal_empresa_documentos
  for each row execute function public.legal_empresa_antes();
drop trigger if exists legal_empresa_observaciones_antes on public.legal_empresa_observaciones;
create trigger legal_empresa_observaciones_antes before insert or update on public.legal_empresa_observaciones
  for each row execute function public.legal_empresa_antes();

-- RLS ------------------------------------------------------------------------
alter table public.legal_empresa_documentos enable row level security;
alter table public.legal_empresa_observaciones enable row level security;

do $$
declare t text;
begin
  foreach t in array array['legal_empresa_documentos', 'legal_empresa_observaciones'] loop
    execute format('drop policy if exists frontera_organizacion on public.%I', t);
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
      with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))$p$, t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using ((select public.auth_opera_legal()) and 'legal' = any ((select public.auth_modulos_habilitados())::text[])
             and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
                  and 'legal' = any ((select public.auth_modulos_habilitados())::text[])
                  and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
             and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
      with check ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
                  and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using ((select public.auth_opera_legal()) and (select public.auth_suscripcion_permite_escribir_definer())
             and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_delete', t);
    execute format('drop policy if exists director_general on public.%I', t);
    execute format($p$create policy director_general on public.%I for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()))$p$, t);
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
