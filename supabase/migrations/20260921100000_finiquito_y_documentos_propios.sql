-- 21-sep-2026 (pedido de Mario):
-- 1. Al dar de baja hay que elaborar la carta finiquito -- se registra cuándo
--    se entregó para que RH vea los finiquitos pendientes.
-- 2. Cada persona con cuenta en la app (personal.profile_id) ve en su inicio
--    su contrato y el aviso de privacidad de su patrón. Para eso necesita
--    leer SU renglón de personal, SUS contrataciones y el perfil legal de la
--    empresa que la contrató -- nada más.
alter table public.personal
  add column finiquito_entregado_en timestamptz,
  add column finiquito_nota text;

comment on column public.personal.finiquito_entregado_en is 'Cuándo se entregó la carta finiquito de la baja vigente. NULL = pendiente (si activo=false). Se limpia al reactivar.';

create policy personal_select_propio on public.personal
  for select
  using (profile_id = auth.uid());

create policy contrataciones_select_propio on public.contrataciones
  for select
  using (personal_id in (select p.id from public.personal p where p.profile_id = auth.uid()));

create policy empresas_perfil_legal_select_propio on public.empresas_perfil_legal
  for select
  using (
    empresa_id in (
      select c.empresa_id from public.contrataciones c
      join public.personal p on p.id = c.personal_id
      where p.profile_id = auth.uid()
    )
  );
