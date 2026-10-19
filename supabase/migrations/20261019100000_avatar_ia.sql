-- Avatar de videojuego generado por IA (19-oct-2026, Mario: "el avatar me
-- gustaría más realista" → eligió "personaje de videojuego generado por IA").
-- La edge personaje-avatar-ia manda la selfie (con consentimiento de la
-- persona) a un servicio externo de imágenes (OpenAI o Google, según los
-- secrets IMAGENES_IA_*), y regresa el retrato; el navegador lo reduce y lo
-- guarda en personajes.avatar como siempre. La selfie no se guarda.
-- Esta tabla lleva la cuenta de usos para el límite por persona y día (lo
-- escribe solo la edge con service_role; cada quien ve los suyos).
-- Ya aplicado en producción (avatar_ia).

create table if not exists public.personajes_ia_usos (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  profile_id uuid not null references public.profiles (id),
  creado_en timestamptz not null default now(),
  ok boolean not null default false,
  proveedor text,
  modelo text,
  detalle text
);
create index if not exists personajes_ia_usos_profile_idx on public.personajes_ia_usos (profile_id, creado_en);
create index if not exists personajes_ia_usos_grupo_idx on public.personajes_ia_usos (grupo_id);

alter table public.personajes_ia_usos enable row level security;
drop policy if exists frontera_organizacion on public.personajes_ia_usos;
create policy frontera_organizacion on public.personajes_ia_usos as restrictive for all
  using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
drop policy if exists espectador_sin_datos on public.personajes_ia_usos;
create policy espectador_sin_datos on public.personajes_ia_usos as restrictive for select to authenticated
  using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.personajes_ia_usos;
create policy director_general on public.personajes_ia_usos for all to authenticated
  using ((select public.auth_admin_global_definer()))
  with check ((select public.auth_admin_global_definer()));
drop policy if exists personajes_ia_usos_propios on public.personajes_ia_usos;
create policy personajes_ia_usos_propios on public.personajes_ia_usos for select to authenticated
  using (profile_id = (select auth.uid()));
drop trigger if exists solo_consulta on public.personajes_ia_usos;
create trigger solo_consulta before insert or update or delete on public.personajes_ia_usos
  for each statement execute function public.bloquear_solo_consulta();
grant select on public.personajes_ia_usos to authenticated;
