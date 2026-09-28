-- Supervisión con IA por proyecto (Mario, 28-sep-2026): reporte diario,
-- minuta, resumen de documento/hilo, comparativa de cotizaciones y reporte
-- de avance para el cliente (edge `proyecto-supervision-ia`). Cada corrida
-- queda en la bitácora del proyecto, que ve quien ve el proyecto.
-- Ya aplicado en producción (28-sep-2026).
create table if not exists public.proyecto_bitacora_ia (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  tipo text not null check (tipo in ('reporte_diario', 'minuta', 'resumen_documento', 'comparativa_cotizaciones', 'avance_cliente')),
  entrada text not null,
  salida text not null,
  acciones jsonb not null default '[]'::jsonb,
  modelo text,
  creado_por uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists proyecto_bitacora_ia_proyecto_idx on public.proyecto_bitacora_ia (proyecto_id, created_at desc);
alter table public.proyecto_bitacora_ia enable row level security;

drop policy if exists frontera_organizacion on public.proyecto_bitacora_ia;
create policy frontera_organizacion on public.proyecto_bitacora_ia as restrictive for all
  using (exists (select 1 from public.proyectos p where p.id = proyecto_bitacora_ia.proyecto_id and public.empresa_en_mi_organizacion(p.empresa_id)))
  with check (exists (select 1 from public.proyectos p where p.id = proyecto_bitacora_ia.proyecto_id and public.empresa_en_mi_organizacion(p.empresa_id)));

drop policy if exists proyecto_bitacora_ia_select on public.proyecto_bitacora_ia;
create policy proyecto_bitacora_ia_select on public.proyecto_bitacora_ia
  for select using (public.auth_modulo_habilitado('proyectos') and public.auth_ve_proyecto(proyecto_id));

drop policy if exists proyecto_bitacora_ia_insert on public.proyecto_bitacora_ia;
create policy proyecto_bitacora_ia_insert on public.proyecto_bitacora_ia
  for insert with check (creado_por = (select auth.uid()) and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos') and public.auth_ve_proyecto(proyecto_id));

drop policy if exists proyecto_bitacora_ia_delete on public.proyecto_bitacora_ia;
create policy proyecto_bitacora_ia_delete on public.proyecto_bitacora_ia
  for delete using (creado_por = (select auth.uid()) or public.auth_rol() in ('admin', 'corporativo'));
