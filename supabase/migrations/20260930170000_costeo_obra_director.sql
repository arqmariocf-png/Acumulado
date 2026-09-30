-- Costeo y pronóstico de obra (Mario, 30-sep-2026): modelo para las obras
-- de Abarrotes Neto (empieza con Río Frío). "Este reporte es único mío como
-- director general": todo es SOLO del admin de la organización, salvo el
-- seguro social, que captura contabilidad (Belén, rol corporativo), y ella
-- solo ve la lista de personal asignado para calcularlo.
--
--   proyecto_costeo               contrato / OC del cliente: folio, duración,
--                                 subtotal + IVA (total se calcula), m², ubicación
--                                 (lat/long), km a la obra, plano, % de indirectos
--                                 propio (si no, el del tabulador por km).
--   proyecto_presupuesto_cliente  presupuesto original del cliente por partida
--                                 (importe = cantidad × P.U., se calcula).
--   proyecto_costeo_directos      contratistas, personal, materiales y otros
--                                 costos directos pronosticados (cantidad × costo).
--   proyecto_costeo_imss          partida de seguro social (contabilidad).
--   indirectos_tabulador          % de indirectos por distancia (km) de la
--                                 organización, para negociar con el cliente.
-- Utilidad pronóstico = subtotal del contrato − (directos + IMSS + indirectos),
-- con indirectos = % × (directos + IMSS). Cálculo en web/src/lib/costeoObra.ts.
--
-- Ya aplicado en producción.

create table if not exists public.proyecto_costeo (
  proyecto_id uuid primary key references public.proyectos(id) on delete cascade,
  folio_contrato text,
  fecha_inicio date,
  fecha_fin date,
  subtotal numeric(14,2) check (subtotal is null or subtotal >= 0),
  iva numeric(14,2) check (iva is null or iva >= 0),
  m2 numeric(12,2) check (m2 is null or m2 > 0),
  ubicacion text,
  latitud numeric(9,6),
  longitud numeric(9,6),
  km numeric(8,1) check (km is null or km >= 0),
  plano_id uuid references public.proyecto_planos(id) on delete set null,
  indirectos_pct numeric(6,2) check (indirectos_pct is null or (indirectos_pct >= 0 and indirectos_pct <= 100)),
  notas text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio)
);

create table if not exists public.proyecto_presupuesto_cliente (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  orden int not null default 0,
  clave text,
  concepto text not null,
  unidad text,
  cantidad numeric(14,4) not null default 1 check (cantidad >= 0),
  precio_unitario numeric(14,4) not null default 0 check (precio_unitario >= 0),
  created_at timestamptz not null default now()
);
create index if not exists proyecto_presupuesto_cliente_proy_idx on public.proyecto_presupuesto_cliente (proyecto_id, orden);

create table if not exists public.proyecto_costeo_directos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  tipo text not null default 'contratista' check (tipo in ('contratista', 'personal', 'material', 'otro')),
  nombre text not null,
  especialidad text,
  cantidad numeric(12,2) not null default 1 check (cantidad >= 0),
  unidad text,
  costo_unitario numeric(14,2) not null default 0 check (costo_unitario >= 0),
  notas text,
  created_at timestamptz not null default now()
);
create index if not exists proyecto_costeo_directos_proy_idx on public.proyecto_costeo_directos (proyecto_id);

create table if not exists public.proyecto_costeo_imss (
  proyecto_id uuid primary key references public.proyectos(id) on delete cascade,
  monto numeric(14,2) not null default 0 check (monto >= 0),
  nota text,
  capturado_por uuid references auth.users(id),
  capturado_por_nombre text,
  capturado_en timestamptz not null default now()
);

create table if not exists public.indirectos_tabulador (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  km_hasta numeric(8,1) not null check (km_hasta > 0),
  porcentaje numeric(6,2) not null check (porcentaje >= 0 and porcentaje <= 100),
  notas text,
  created_at timestamptz not null default now(),
  unique (grupo_id, km_hasta)
);

-- Quién captura el IMSS (nombre a la vista de Mario sin leer profiles).
create or replace function public.proyecto_costeo_imss_quien()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.capturado_por := (select auth.uid());
  new.capturado_por_nombre := (select nombre from public.profiles where id = new.capturado_por);
  new.capturado_en := now();
  return new;
end;
$$;
drop trigger if exists proyecto_costeo_imss_quien on public.proyecto_costeo_imss;
create trigger proyecto_costeo_imss_quien before insert or update on public.proyecto_costeo_imss
  for each row execute function public.proyecto_costeo_imss_quien();

-- RLS ----------------------------------------------------------------------
alter table public.proyecto_costeo enable row level security;
alter table public.proyecto_presupuesto_cliente enable row level security;
alter table public.proyecto_costeo_directos enable row level security;
alter table public.proyecto_costeo_imss enable row level security;
alter table public.indirectos_tabulador enable row level security;

do $$
declare t text;
begin
  foreach t in array array['proyecto_costeo', 'proyecto_presupuesto_cliente', 'proyecto_costeo_directos', 'proyecto_costeo_imss'] loop
    execute format('drop policy if exists frontera_organizacion on public.%I', t);
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (exists (select 1 from public.proyectos p where p.id = %I.proyecto_id and p.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])))
      with check (exists (select 1 from public.proyectos p where p.id = %I.proyecto_id and p.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])))$p$, t, t, t);
    -- Solo el admin (director general) de la organización.
    execute format('drop policy if exists %I on public.%I', t || '_director', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using ((select public.auth_rol_definer()) = 'admin')
      with check ((select public.auth_rol_definer()) = 'admin')$p$, t || '_director', t);
    execute format('drop trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or delete on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Contabilidad (corporativo): captura el IMSS y ve SOLO el personal asignado.
drop policy if exists proyecto_costeo_imss_contabilidad on public.proyecto_costeo_imss;
create policy proyecto_costeo_imss_contabilidad on public.proyecto_costeo_imss for all to authenticated
  using ((select public.auth_rol_definer()) = 'corporativo')
  with check ((select public.auth_rol_definer()) = 'corporativo');
drop policy if exists proyecto_costeo_directos_contabilidad on public.proyecto_costeo_directos;
create policy proyecto_costeo_directos_contabilidad on public.proyecto_costeo_directos for select to authenticated
  using ((select public.auth_rol_definer()) = 'corporativo' and tipo in ('personal', 'contratista'));

drop policy if exists frontera_organizacion on public.indirectos_tabulador;
create policy frontera_organizacion on public.indirectos_tabulador as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
drop policy if exists indirectos_tabulador_director on public.indirectos_tabulador;
create policy indirectos_tabulador_director on public.indirectos_tabulador for all to authenticated
  using ((select public.auth_rol_definer()) = 'admin')
  with check ((select public.auth_rol_definer()) = 'admin');
drop trigger if exists solo_consulta on public.indirectos_tabulador;
create trigger solo_consulta before insert or update or delete on public.indirectos_tabulador
  for each statement execute function public.bloquear_solo_consulta();
grant select, insert, update, delete on public.indirectos_tabulador to authenticated;

-- Obras con costeo para contabilidad: nombre del proyecto sin montos.
create or replace view public.v_costeo_imss_pendiente with (security_invoker = true) as
select p.id as proyecto_id, p.nombre, e.nombre as empresa,
       i.monto, i.nota, i.capturado_por_nombre, i.capturado_en
from public.proyectos p
join public.empresas e on e.id = p.empresa_id
left join public.proyecto_costeo_imss i on i.proyecto_id = p.id
where exists (select 1 from public.proyecto_costeo_directos d where d.proyecto_id = p.id and d.tipo in ('personal', 'contratista'));
grant select on public.v_costeo_imss_pendiente to authenticated;
