-- EPP: de RH a Alma con su requisición, OC y pago (9-nov-2026, Mario: "en el
-- flujo de EPP lo suben supervisores, lo autoriza RH y se queda ahí; hay que
-- hacer que llegue a Alma con la OC correspondiente y el flujo de finanzas
-- para autorización y pago").
--
-- Causa: al atender una solicitud (fn_epp_atender_solicitud) todas las
-- piezas nacían con origen 'bodega', así que "Pedir a compras" nunca
-- aparecía y la entrega se quedaba "por surtir" en RH (4 entregas abiertas y
-- 0 requisiciones al 9-nov). Ahora:
--   * fn_epp_atender_solicitud(solicitud, obra, origen 'compra'|'bodega'):
--     con 'compra' (lo normal) crea la requisición de inmediato
--     (fn_epp_pedir_compra) y avisa a almacén por push.
--   * fn_epp_pedir_compra(asignacion, p_todas): con p_todas las piezas por
--     surtir que estaban "de bodega" pasan a compra y entran en la
--     requisición; avisa a almacén (fn_almacen_de). De ahí el camino es el de
--     siempre: Alma "Comprar en un paso" → OC → Laura la autoriza/programa →
--     Delia paga → almacén recibe.
--   * Trigger requisiciones_epp_llego: cuando la requisición de un EPP pasa a
--     en_bodega o recibida, push a RH y a quien pidió el EPP para entregarlo.
--
-- Ya aplicado en producción (epp_a_compras_y_finanzas).

create or replace function public.fn_almacen_de(p_grupo uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}'::uuid[]) from public.profiles p
   where p.grupo_id = p_grupo and p.rol = 'almacen' and p.activo and not coalesce(p.espectador, false)
$$;
revoke all on function public.fn_almacen_de(uuid) from public, anon, authenticated;

-- La firma vieja (uuid) se conserva renombrada: el MCP no deja borrar funciones.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'fn_epp_pedir_compra' and pronamespace = 'public'::regnamespace and pg_get_function_identity_arguments(oid) = 'p_asignacion uuid') then
    alter function public.fn_epp_pedir_compra(uuid) rename to fn_epp_pedir_compra_v1;
    revoke all on function public.fn_epp_pedir_compra_v1(uuid) from public, anon, authenticated;
  end if;
end $$;

create or replace function public.fn_epp_pedir_compra(p_asignacion uuid, p_todas boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_a public.epp_asignaciones;
  v_persona text;
  v_obra text;
  v_grupo uuid;
  v_req uuid;
  v_n int;
begin
  if not public.auth_opera_epp() then raise exception 'Solo RH pide equipo de protección.' using errcode = '42501'; end if;
  select * into v_a from public.epp_asignaciones where id = p_asignacion for update;
  if v_a.id is null or not (v_a.empresa_id = any (public.auth_empresas_organizacion())) then
    raise exception 'Asignación no encontrada.';
  end if;
  if v_a.requisicion_id is not null then raise exception 'Esta entrega ya tiene requisición de compra.'; end if;
  if p_todas then
    update public.epp_asignacion_lineas set origen = 'compra' where asignacion_id = p_asignacion and estado = 'por_surtir' and origen <> 'compra';
  end if;
  select count(*) into v_n from public.epp_asignacion_lineas where asignacion_id = p_asignacion and origen = 'compra' and estado = 'por_surtir';
  if v_n = 0 then raise exception 'No hay piezas por comprar: ya se entregaron o salen de bodega.'; end if;
  select nombre into v_persona from public.personal where id = v_a.personal_id;
  select pr.nombre, e.grupo_id into v_obra, v_grupo from public.proyectos pr join public.empresas e on e.id = pr.empresa_id where pr.id = v_a.proyecto_id;

  insert into public.requisiciones (proyecto_id, empresa_id, solicitado_por, comentario)
  values (v_a.proyecto_id, v_a.empresa_id, auth.uid(),
          'EPP ' || coalesce(v_a.folio, '') || ' para ' || coalesce(v_persona, '') || ' (RH)')
  returning id into v_req;
  insert into public.requisicion_lineas (requisicion_id, descripcion, cantidad_solicitada, unidad_medida)
  select v_req, 'EPP: ' || l.descripcion || coalesce(' talla ' || nullif(trim(l.talla), ''), ''), l.cantidad, l.unidad
  from public.epp_asignacion_lineas l
  where l.asignacion_id = p_asignacion and l.origen = 'compra' and l.estado = 'por_surtir'
  order by l.created_at;
  update public.epp_asignaciones set requisicion_id = v_req where id = p_asignacion;

  perform public.fn_push_aviso(
    public.fn_almacen_de(v_grupo),
    'EPP por comprar',
    coalesce(v_a.folio, 'EPP') || ' para ' || coalesce(v_persona, '—') || ' · ' || v_n || ' pieza(s) · obra ' || coalesce(v_obra, '—') || '. Genera la OC desde la requisición.',
    '/requisiciones?abrir=' || v_req::text);
  return v_req;
end;
$$;
revoke all on function public.fn_epp_pedir_compra(uuid, boolean) from public, anon;
grant execute on function public.fn_epp_pedir_compra(uuid, boolean) to authenticated;

do $$ begin
  if exists (select 1 from pg_proc where proname = 'fn_epp_atender_solicitud' and pronamespace = 'public'::regnamespace and pg_get_function_identity_arguments(oid) = 'p_solicitud uuid, p_proyecto uuid') then
    alter function public.fn_epp_atender_solicitud(uuid, uuid) rename to fn_epp_atender_solicitud_v1;
    revoke all on function public.fn_epp_atender_solicitud_v1(uuid, uuid) from public, anon, authenticated;
  end if;
end $$;

create or replace function public.fn_epp_atender_solicitud(p_solicitud uuid, p_proyecto uuid default null, p_origen text default 'compra')
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_s public.epp_solicitudes%rowtype;
  v_proyecto uuid;
  v_asignacion uuid;
begin
  if not public.auth_opera_epp() then raise exception 'Solo RH atiende solicitudes de EPP.' using errcode = '42501'; end if;
  if coalesce(p_origen, 'compra') not in ('compra', 'bodega') then raise exception 'Origen no válido: compra o bodega.'; end if;
  select * into v_s from public.epp_solicitudes where id = p_solicitud for update;
  if v_s.id is null or not (v_s.grupo_id = any (public.auth_grupos_alcance())) then raise exception 'Solicitud no encontrada.'; end if;
  if v_s.estado <> 'pendiente' then raise exception 'Esa solicitud ya fue %.', v_s.estado; end if;
  v_proyecto := coalesce(p_proyecto, v_s.proyecto_id);
  if v_proyecto is null then raise exception 'Elige la obra a la que se carga el equipo.'; end if;
  if not exists (select 1 from public.proyectos pr where pr.id = v_proyecto and pr.empresa_id = any (public.auth_empresas_organizacion())) then
    raise exception 'La obra no existe o es de otra organización.';
  end if;

  insert into public.epp_asignaciones (proyecto_id, empresa_id, personal_id, notas, created_by)
  select v_proyecto, pr.empresa_id, v_s.personal_id,
         'Solicitud ' || v_s.folio || coalesce(' de ' || v_s.solicitante_nombre, '') || coalesce(': ' || v_s.notas, ''), auth.uid()
    from public.proyectos pr where pr.id = v_proyecto
  returning id into v_asignacion;

  insert into public.epp_asignacion_lineas (asignacion_id, empresa_id, descripcion, talla, cantidad, unidad, origen)
  select v_asignacion, a.empresa_id, l.descripcion, l.talla, l.cantidad, l.unidad, coalesce(p_origen, 'compra')
    from public.epp_solicitud_lineas l, public.epp_asignaciones a
   where l.solicitud_id = p_solicitud and a.id = v_asignacion
   order by l.created_at;

  update public.epp_solicitudes
     set estado = 'atendida', asignacion_id = v_asignacion, proyecto_id = v_proyecto,
         atendida_por = auth.uid(), atendida_en = now()
   where id = p_solicitud;

  if coalesce(p_origen, 'compra') = 'compra' then
    perform public.fn_epp_pedir_compra(v_asignacion, false);
  end if;
  return v_asignacion;
end;
$$;
revoke all on function public.fn_epp_atender_solicitud(uuid, uuid, text) from public, anon;
grant execute on function public.fn_epp_atender_solicitud(uuid, uuid, text) to authenticated;

-- Llegó el EPP (la requisición entró a bodega o a la obra): aviso a RH y a
-- quien lo pidió para que lo entreguen y lo marquen.
create or replace function public.requisiciones_epp_llego()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_a public.epp_asignaciones;
  v_persona text;
  v_grupo uuid;
  v_quien uuid[];
begin
  if new.etapa is not distinct from old.etapa or new.etapa not in ('en_bodega', 'recibida') then return new; end if;
  select * into v_a from public.epp_asignaciones where requisicion_id = new.id limit 1;
  if v_a.id is null then return new; end if;
  select nombre into v_persona from public.personal where id = v_a.personal_id;
  select grupo_id into v_grupo from public.empresas where id = v_a.empresa_id;
  v_quien := public.fn_rh_de(v_grupo);
  select array(select unnest(v_quien) union select s.solicitado_por from public.epp_solicitudes s where s.asignacion_id = v_a.id and s.solicitado_por is not null) into v_quien;
  perform public.fn_push_aviso(
    v_quien,
    'Llegó el EPP',
    coalesce(v_a.folio, 'EPP') || ' para ' || coalesce(v_persona, '—') || ' ya está ' || case when new.etapa = 'recibida' then 'en la obra' else 'en bodega' end || ': entrégalo y márcalo entregado.',
    '/rh?tab=epp');
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'requisiciones_epp_llego' and tgrelid = 'public.requisiciones'::regclass) then
    create trigger requisiciones_epp_llego after update of etapa on public.requisiciones
      for each row execute function public.requisiciones_epp_llego();
  end if;
end $$;
