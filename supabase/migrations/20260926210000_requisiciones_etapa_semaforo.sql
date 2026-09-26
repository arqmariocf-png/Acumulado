-- Semáforo de requerimientos (Mario, 26-sep-2026): una vez creada la
-- requisición arranca el flujo autorización → pago → suministro → en bodega
-- → en tránsito → recibido. `estado` (enviada/en_revision/resuelta/
-- cancelada) sigue siendo la resolución de compras; `etapa` es el avance
-- físico del suministro que ve la obra. Ya aplicado en producción.
alter table public.requisiciones
  add column if not exists etapa text not null default 'solicitada'
    check (etapa in ('solicitada', 'autorizada', 'pagada', 'suministro', 'en_bodega', 'en_transito', 'recibida')),
  add column if not exists etapa_en timestamptz not null default now(),
  add column if not exists etapa_por uuid references public.profiles (id);

create table if not exists public.requisicion_etapas (
  id uuid primary key default gen_random_uuid(),
  requisicion_id uuid not null references public.requisiciones (id) on delete cascade,
  etapa text not null,
  etapa_anterior text,
  actor_id uuid references public.profiles (id),
  actor_nombre text,
  nota text,
  created_at timestamptz not null default now()
);
create index if not exists requisicion_etapas_req_idx on public.requisicion_etapas (requisicion_id, created_at);
alter table public.requisicion_etapas enable row level security;

drop policy if exists frontera_organizacion on public.requisicion_etapas;
create policy frontera_organizacion on public.requisicion_etapas as restrictive for all
  using (exists (select 1 from public.requisiciones r where r.id = requisicion_etapas.requisicion_id and public.empresa_en_mi_organizacion(r.empresa_id)))
  with check (exists (select 1 from public.requisiciones r where r.id = requisicion_etapas.requisicion_id and public.empresa_en_mi_organizacion(r.empresa_id)));
drop policy if exists requisicion_etapas_select on public.requisicion_etapas;
create policy requisicion_etapas_select on public.requisicion_etapas
  for select using (exists (select 1 from public.requisiciones r where r.id = requisicion_etapas.requisicion_id));
-- Escritura solo por la RPC (definer).

-- Quién ve requisiciones: además de los de siempre, quien opera los
-- proyectos de su empresa (empresa, responsable, básicos con módulo) y
-- almacén de esa empresa, que es quien marca "en bodega / recibida".
drop policy if exists requisiciones_select on public.requisiciones;
create policy requisiciones_select on public.requisiciones
  for select
  using (
    public.auth_rol() <> 'pendiente'
    and (
      public.auth_ve_todas_empresas()
      or (public.auth_rol() in ('empresa', 'direccion', 'almacen') and empresa_id = public.auth_empresa_id())
      or (public.auth_opera_proyectos_empresa() and empresa_id = public.auth_empresa_id())
      or solicitado_por = (select auth.uid())
      or exists (
        select 1 from public.proyectos p
        where p.id = requisiciones.proyecto_id
          and (p.responsable_id = (select auth.uid()) or p.comprador_id = (select auth.uid()))
      )
    )
  );

-- Quién marca cada etapa: autoriza dirección/empresa; paga dirección;
-- suministro dirección/empresa/almacén; bodega y tránsito empresa/almacén;
-- recibida empresa/almacén/responsable o quien la pidió. admin y
-- corporativo todas; regresar una etapa solo admin/corporativo/dirección.
create or replace function public.fn_requisicion_etapa(p_requisicion_id uuid, p_etapa text, p_nota text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_req public.requisiciones%rowtype;
  v_orden int;
  v_orden_actual int;
  v_puede boolean;
  etapas text[] := array['solicitada', 'autorizada', 'pagada', 'suministro', 'en_bodega', 'en_transito', 'recibida'];
begin
  select * into v_req from public.requisiciones where id = p_requisicion_id;
  if v_req.id is null then raise exception 'Requisición no encontrada'; end if;
  if not public.empresa_en_mi_organizacion(v_req.empresa_id) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  if v_req.estado = 'cancelada' then raise exception 'La requisición está cancelada'; end if;
  v_orden := array_position(etapas, p_etapa);
  if v_orden is null then raise exception 'Etapa no válida: %', p_etapa; end if;
  v_orden_actual := array_position(etapas, v_req.etapa);

  if v_orden < v_orden_actual and v_rol not in ('admin', 'corporativo', 'direccion') then
    raise exception 'Solo dirección o corporativo pueden regresar una etapa' using errcode = '42501';
  end if;

  v_puede := v_rol in ('admin', 'corporativo') or (
    case p_etapa
      when 'autorizada' then v_rol in ('direccion', 'empresa')
      when 'pagada' then v_rol = 'direccion'
      when 'suministro' then v_rol in ('direccion', 'empresa', 'almacen')
      when 'en_bodega' then v_rol in ('empresa', 'almacen')
      when 'en_transito' then v_rol in ('empresa', 'almacen')
      when 'recibida' then v_rol in ('empresa', 'almacen', 'responsable') or v_req.solicitado_por = v_uid
        or exists (select 1 from public.proyectos p where p.id = v_req.proyecto_id and (p.responsable_id = v_uid or p.comprador_id = v_uid))
      else v_rol in ('direccion')
    end
    and (public.auth_ve_todas_empresas() or v_req.empresa_id = public.auth_empresa_id())
  );
  if not v_puede then
    raise exception 'Tu rol (%) no puede marcar la etapa %', v_rol, p_etapa using errcode = '42501';
  end if;

  update public.requisiciones set etapa = p_etapa, etapa_en = now(), etapa_por = v_uid where id = p_requisicion_id;
  insert into public.requisicion_etapas (requisicion_id, etapa, etapa_anterior, actor_id, actor_nombre, nota)
  values (p_requisicion_id, p_etapa, v_req.etapa, v_uid, (select nombre from public.profiles where id = v_uid), nullif(trim(coalesce(p_nota, '')), ''));
end;
$$;
revoke all on function public.fn_requisicion_etapa(uuid, text, text) from public;
grant execute on function public.fn_requisicion_etapa(uuid, text, text) to authenticated, service_role;
