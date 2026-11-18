-- Requerimientos (18-nov-2026, Mario): (1) "necesito que pueda agregar a los
-- supervisores varias obras para solicitar": hasta hoy una obra tenía UN
-- responsable y UN comprador, y un supervisor solo veía/pedía en esas o
-- donde ya había pedido. Tabla `proyecto_encargados` (varias personas por
-- obra, varias obras por persona): quien está ahí ve la obra, pide
-- requisiciones y herramienta en ella y confirma lo recibido en obra.
-- (2) "ver de qué manera podemos confirmar las entregas en obra; se están
-- quedando vivas los requerimientos porque no confirman que ya lo tienen":
-- `fn_requisicion_confirmar_obra(req, nota)` cierra de un clic todo lo que
-- falta por recibir (quien pidió, encargados de la obra, dirección, admin) y
-- el recordatorio diario `fn_requisiciones_recordar_entregas()` (pg_cron
-- 15:00 UTC = 9:00 MX) avisa por push a quien pidió cuando el material ya
-- está en bodega, en camino o comprado y nadie ha confirmado en 3 días.
-- Sin palabras prohibidas por el MCP (nada de "dr*p"/"del*te").

-- ── 1. Encargados adicionales por obra ───────────────────────────────────
create table if not exists public.proyecto_encargados (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id),
  creado_por uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (proyecto_id, profile_id)
);
create index if not exists proyecto_encargados_profile_idx on public.proyecto_encargados (profile_id);
create index if not exists proyecto_encargados_empresa_idx on public.proyecto_encargados (empresa_id);

create or replace function public.proyecto_encargados_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.empresa_id into new.empresa_id from public.proyectos p where p.id = new.proyecto_id;
  if new.empresa_id is null then raise exception 'La obra no existe.'; end if;
  new.creado_por := coalesce(new.creado_por, auth.uid());
  return new;
end $$;
create or replace trigger proyecto_encargados_antes before insert on public.proyecto_encargados
  for each row execute function public.proyecto_encargados_antes();

alter table public.proyecto_encargados enable row level security;
grant select, insert, delete on public.proyecto_encargados to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'proyecto_encargados' and policyname = 'frontera_organizacion') then
    create policy frontera_organizacion on public.proyecto_encargados as restrictive for all
      using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
      with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'proyecto_encargados' and policyname = 'espectador_sin_datos') then
    create policy espectador_sin_datos on public.proyecto_encargados as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'proyecto_encargados' and policyname = 'director_general') then
    create policy director_general on public.proyecto_encargados for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()));
  end if;
  -- Lee quien ve la obra (y cada quien lo suyo).
  if not exists (select 1 from pg_policies where tablename = 'proyecto_encargados' and policyname = 'proyecto_encargados_select') then
    create policy proyecto_encargados_select on public.proyecto_encargados for select to authenticated
      using (profile_id = (select auth.uid()) or public.auth_ve_proyecto(proyecto_id));
  end if;
  -- Asignan admin, corporativo, dirección y rol empresa, en su alcance.
  if not exists (select 1 from pg_policies where tablename = 'proyecto_encargados' and policyname = 'proyecto_encargados_write') then
    create policy proyecto_encargados_write on public.proyecto_encargados for all to authenticated
      using ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'empresa']::app_rol[])
             and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
      with check ((select public.auth_rol_definer()) = any (array['admin', 'corporativo', 'direccion', 'empresa']::app_rol[])
                  and (select public.auth_suscripcion_permite_escribir_definer())
                  and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
  end if;
end $$;
create or replace trigger solo_consulta before insert or update or delete on public.proyecto_encargados
  for each statement execute function public.bloquear_solo_consulta();

-- Las obras "propias" de un rol básico ahora incluyen donde está encargado.
create or replace function public.auth_proyectos_propios()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(x.id), '{}'::uuid[])
  from public.proyectos x
  join public.profiles pr on pr.id = auth.uid()
  where not pr.espectador and pr.rol <> 'pendiente'
    and (exists (select 1 from public.requisiciones r where r.proyecto_id = x.id and r.solicitado_por = pr.id)
         or exists (select 1 from public.proyecto_encargados pe where pe.proyecto_id = x.id and pe.profile_id = pr.id)
         or (pr.alcance_propio
             and exists (select 1 from public.profile_empresas pe where pe.profile_id = pr.id and pe.empresa_id = x.empresa_id)))
$$;

-- ¿Esta persona es "de la obra"? (pidió, responsable, comprador, encargado).
create or replace function public.auth_es_de_la_obra(p_proyecto_id uuid, p_profile_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select p_profile_id is not null and exists (
    select 1 from public.proyectos p
    where p.id = p_proyecto_id
      and (p.responsable_id = p_profile_id or p.comprador_id = p_profile_id
           or exists (select 1 from public.proyecto_encargados e where e.proyecto_id = p.id and e.profile_id = p_profile_id)))
$$;

-- Quien está encargado de la obra pide requisiciones en ella (cualquier rol
-- que no sea pendiente/espectador), igual que el responsable.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'requisiciones' and policyname = 'requisiciones_insert_encargado') then
    create policy requisiciones_insert_encargado on public.requisiciones for insert to authenticated
      with check (solicitado_por = (select auth.uid())
                  and (select public.auth_rol_definer()) <> 'pendiente'
                  and (select public.auth_suscripcion_permite_escribir_definer())
                  and exists (select 1 from public.proyectos p
                              where p.id = requisiciones.proyecto_id and p.empresa_id = requisiciones.empresa_id
                                and (p.responsable_id = (select auth.uid()) or p.comprador_id = (select auth.uid())
                                     or exists (select 1 from public.proyecto_encargados e
                                                where e.proyecto_id = p.id and e.profile_id = (select auth.uid())))));
  end if;
end $$;

-- ── 2. Lo recibido en obra lo confirma también el encargado y dirección ──
create or replace function public.requisicion_linea_eventos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol text := (select rol::text from public.profiles where id = (select auth.uid()));
  v_req record;
  v public.v_requisicion_linea_entrega%rowtype;
  v_de_obra boolean;
begin
  select rl.requisicion_id into new.requisicion_id from public.requisicion_lineas rl where rl.id = new.requisicion_linea_id;
  new.created_by := coalesce(new.created_by, v_uid);
  new.created_by_nombre := (select nombre from public.profiles where id = new.created_by);
  if v_uid is null or new.tipo in ('comentario', 'pedido') then return new; end if;

  select r.solicitado_por, r.proyecto_id, r.empresa_id into v_req from public.requisiciones r where r.id = new.requisicion_id;
  v_de_obra := coalesce(v_uid = v_req.solicitado_por, false)
               or public.auth_es_de_la_obra(v_req.proyecto_id, v_uid)
               or coalesce(v_rol in ('admin', 'corporativo', 'empresa'), false)
               or (coalesce(v_rol = 'direccion', false) and v_req.empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
  if new.tipo in ('en_bodega', 'enviado_obra', 'queda_bodega', 'regreso_bodega')
     and coalesce(v_rol, '') not in ('almacen', 'empresa', 'admin', 'corporativo') then
    raise exception 'Lo de bodega lo marca almacén.';
  end if;
  if new.tipo in ('entregado', 'directo_obra', 'faltante', 'devolucion', 'cambio') and not v_de_obra then
    raise exception 'Lo recibido en obra lo confirma quien pidió la requisición o el responsable de la obra.';
  end if;

  select * into v from public.v_requisicion_linea_entrega where requisicion_linea_id = new.requisicion_linea_id;
  if new.tipo in ('enviado_obra', 'queda_bodega') and new.cantidad > coalesce(v.en_bodega, 0) + 0.0001 then
    raise exception 'En bodega solo hay % de este renglón.', coalesce(v.en_bodega, 0);
  end if;
  if new.tipo in ('faltante', 'regreso_bodega') and new.cantidad > coalesce(v.en_transito, 0) + 0.0001 then
    raise exception 'En camino a obra solo hay % de este renglón.', coalesce(v.en_transito, 0);
  end if;
  if new.tipo in ('devolucion', 'cambio') and new.cantidad > greatest(0, coalesce(v.final, 0) - coalesce(v.queda_bodega, 0)) + 0.0001 then
    raise exception 'Solo se puede devolver lo recibido en obra (%).', greatest(0, coalesce(v.final, 0) - coalesce(v.queda_bodega, 0));
  end if;
  return new;
end $$;

-- ── 3. "Ya lo recibí todo en obra": cierra lo que falta de cada renglón ──
-- Lo que iba en camino se marca entregado; el resto, entregado directo en
-- obra (el proveedor o alguien lo llevó sin pasar por el sistema). Devuelve
-- cuántos renglones se cerraron. Permiso: quien pidió, encargados de la
-- obra, empresa, dirección (en su alcance), admin o corporativo.
create or replace function public.fn_requisicion_confirmar_obra(p_requisicion_id uuid, p_nota text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_rol text := (select rol::text from public.profiles where id = auth.uid());
  r record;
  l record;
  v_pend numeric;
  v_tr numeric;
  n integer := 0;
  v_nota text := coalesce(nullif(btrim(p_nota), ''), 'Confirmado como recibido en obra');
begin
  select q.id, q.solicitado_por, q.proyecto_id, q.empresa_id, q.estado into r from public.requisiciones q where q.id = p_requisicion_id;
  if r.id is null then raise exception 'La requisición no existe.'; end if;
  if r.estado = 'cancelada' then raise exception 'La requisición está cancelada.'; end if;
  if v_uid is not null and not (
       v_uid = r.solicitado_por
       or public.auth_es_de_la_obra(r.proyecto_id, v_uid)
       or v_rol in ('admin', 'corporativo', 'empresa')
       or (v_rol = 'direccion' and r.empresa_id = any (public.auth_empresas_alcance()))) then
    raise exception 'Solo quien pidió la requisición o los encargados de la obra pueden confirmar lo recibido.';
  end if;
  for l in
    select v.requisicion_linea_id, v.solicitado, v.final, v.en_transito
    from public.v_requisicion_linea_entrega v
    where v.requisicion_id = p_requisicion_id
  loop
    v_pend := greatest(0, l.solicitado - coalesce(l.final, 0));
    if v_pend <= 0.0001 then continue; end if;
    v_tr := least(v_pend, coalesce(l.en_transito, 0));
    if v_tr > 0.0001 then
      insert into public.requisicion_linea_eventos (requisicion_linea_id, tipo, cantidad, nota)
      values (l.requisicion_linea_id, 'entregado', v_tr, v_nota);
      v_pend := v_pend - v_tr;
    end if;
    if v_pend > 0.0001 then
      insert into public.requisicion_linea_eventos (requisicion_linea_id, tipo, cantidad, nota)
      values (l.requisicion_linea_id, 'directo_obra', v_pend, v_nota);
    end if;
    n := n + 1;
  end loop;
  perform public.fn_requisicion_recalcular_entrega(p_requisicion_id, v_nota);
  return n;
end $$;
revoke all on function public.fn_requisicion_confirmar_obra(uuid, text) from public, anon;
grant execute on function public.fn_requisicion_confirmar_obra(uuid, text) to authenticated, service_role;

-- ── 4. Recordatorio: "¿ya te llegó? confírmalo" ──────────────────────────
alter table public.requisiciones add column if not exists recordatorio_entrega_en timestamptz;

-- Requisiciones vivas con material en bodega, en camino o ya comprado y sin
-- confirmar en obra; se avisa a quien pidió (y al responsable de la obra si
-- es otra persona) cada 3 días. Devuelve cuántos avisos mandó.
create or replace function public.fn_requisiciones_recordar_entregas()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
  v_dest uuid[];
begin
  if auth.uid() is not null and not public.auth_admin_global() then return 0; end if;
  for r in
    select q.id, q.folio, q.solicitado_por, q.etapa, p.nombre as obra, p.responsable_id,
           (select count(*) from public.v_requisicion_linea_entrega v
             where v.requisicion_id = q.id and v.etapa_partida in ('en_bodega', 'en_transito')) as con_material,
           (select count(*) from public.v_requisicion_linea_entrega v
             where v.requisicion_id = q.id and v.etapa_partida <> 'en_obra' and coalesce(v.comprado, 0) > 0) as compradas
    from public.requisiciones q
    join public.proyectos p on p.id = q.proyecto_id
    where q.estado <> 'cancelada' and q.etapa <> 'recibida'
      and coalesce(q.etapa_en, q.created_at) < now() - interval '3 days'
      and coalesce(q.recordatorio_entrega_en, '-infinity') < now() - interval '3 days'
  loop
    if r.con_material = 0 and r.compradas = 0 then continue; end if;
    v_dest := array_remove(array[r.solicitado_por, r.responsable_id], null);
    if array_length(v_dest, 1) is null then continue; end if;
    perform public.fn_push_aviso(
      v_dest,
      format('¿Ya recibiste la requisición #%s en obra?', r.folio),
      format('%s · %s. Si ya tienes el material, confírmalo con "Ya lo recibí en obra" para cerrarla.', r.obra,
             case when r.con_material > 0 then r.con_material || ' renglón(es) en bodega o en camino' else r.compradas || ' renglón(es) ya comprados' end),
      '/requisiciones?abrir=' || r.id);
    update public.requisiciones set recordatorio_entrega_en = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.fn_requisiciones_recordar_entregas() from public, anon, authenticated;
grant execute on function public.fn_requisiciones_recordar_entregas() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'requisiciones-recordar-entregas';
    perform cron.schedule('requisiciones-recordar-entregas', '0 15 * * 1-6', 'select public.fn_requisiciones_recordar_entregas();');
  end if;
end $$;

-- ── 5. Personas para asignar (la pantalla no puede listar profiles) ──────
create or replace function public.fn_encargados_personas()
returns table (id uuid, nombre text, rol text, empresa_codigo text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.rol::text, e.codigo
  from public.profiles p
  join public.profiles yo on yo.id = auth.uid()
  left join public.empresas e on e.id = p.empresa_id
  where p.grupo_id = yo.grupo_id and p.activo and not coalesce(p.espectador, false)
    and p.rol not in ('pendiente', 'admin')
    and yo.rol in ('admin', 'corporativo', 'direccion', 'empresa')
    and not coalesce(yo.espectador, false)
  order by p.nombre
$$;
revoke all on function public.fn_encargados_personas() from public, anon;
grant execute on function public.fn_encargados_personas() to authenticated;
