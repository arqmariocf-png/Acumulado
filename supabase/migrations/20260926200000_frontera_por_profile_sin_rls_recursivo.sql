-- "Marca no encontrada o sin permiso" al abrir la foto del checador desde RH
-- (26-sep-2026). Las fronteras que cuelgan de un profile_id consultaban
-- `profiles` bajo RLS de quien mira: profiles solo deja leer el renglón
-- propio (salvo admin), así que para RH todo lo de otra persona desaparecía
-- en checador_registros, permisos_modulo, push_subscripciones,
-- sincronizaciones_oc_ov y socios_organizacion. (La lista de marcas sí
-- salía porque v_checador_marcas es definer.) El helper lee profiles como
-- definer y decide con grupo_en_alcance, que es la única pregunta.
-- Ya aplicado en producción (26-sep-2026).

create or replace function public.perfil_en_alcance(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles pr where pr.id = p_profile_id and public.grupo_en_alcance(pr.grupo_id))
$$;
revoke all on function public.perfil_en_alcance(uuid) from public;
grant execute on function public.perfil_en_alcance(uuid) to authenticated, service_role;

drop policy if exists frontera_organizacion on public.checador_registros;
create policy frontera_organizacion on public.checador_registros as restrictive for all
  using (public.perfil_en_alcance(profile_id)) with check (public.perfil_en_alcance(profile_id));

drop policy if exists frontera_organizacion on public.permisos_modulo;
create policy frontera_organizacion on public.permisos_modulo as restrictive for all
  using (public.perfil_en_alcance(profile_id)) with check (public.perfil_en_alcance(profile_id));

drop policy if exists frontera_organizacion on public.push_subscripciones;
create policy frontera_organizacion on public.push_subscripciones as restrictive for all
  using (public.perfil_en_alcance(profile_id)) with check (public.perfil_en_alcance(profile_id));

drop policy if exists frontera_organizacion on public.sincronizaciones_oc_ov;
create policy frontera_organizacion on public.sincronizaciones_oc_ov as restrictive for all
  using (public.perfil_en_alcance(solicitada_por)) with check (public.perfil_en_alcance(solicitada_por));

drop policy if exists frontera_organizacion on public.socios_organizacion;
create policy frontera_organizacion on public.socios_organizacion as restrictive for all
  using (public.perfil_en_alcance(profile_id)) with check (public.perfil_en_alcance(profile_id));
