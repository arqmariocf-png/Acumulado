-- Precios unitarios dentro de los proyectos (Mario, 26-sep-2026): semáforo
-- de avance con dos autorizaciones. La interna ya existe (borrador →
-- almacén → dirección → publicado); la del cliente es un paso posterior a
-- "publicado" que se registra aquí, sin tocar el flujo ni su trigger.
-- Ya aplicado en producción (26-sep-2026).

alter table public.pu_analisis
  add column if not exists cliente_autorizado_en timestamptz,
  add column if not exists cliente_autorizado_por uuid references public.profiles (id),
  add column if not exists cliente_referencia text;

comment on column public.pu_analisis.cliente_autorizado_en is 'Cuándo el cliente aceptó el precio publicado (paso posterior a publicado). Null = pendiente del cliente.';
comment on column public.pu_analisis.cliente_referencia is 'Folio, OC o correo con el que el cliente autorizó.';

-- Quién registra la autorización del cliente: dirección, corporativo, la
-- empresa o el responsable/comprador del proyecto; solo sobre publicados.
-- Queda en la bitácora (pu_aprobaciones) con el mismo estado antes y después.
create or replace function public.fn_pu_autorizar_cliente(p_analisis_id uuid, p_autorizado boolean, p_referencia text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol app_rol := public.auth_rol();
  v_estado text;
  v_empresa uuid;
  v_proyecto uuid;
begin
  select estado, empresa_id, proyecto_id into v_estado, v_empresa, v_proyecto from public.pu_analisis where id = p_analisis_id;
  if v_estado is null then
    raise exception 'Análisis no encontrado';
  end if;
  if not public.empresa_en_mi_organizacion(v_empresa) then
    raise exception 'Sin acceso a este análisis' using errcode = '42501';
  end if;
  if not (v_rol in ('admin', 'direccion', 'corporativo', 'empresa')
          or exists (select 1 from public.proyectos p where p.id = v_proyecto and (p.responsable_id = v_uid or p.comprador_id = v_uid))) then
    raise exception 'Solo dirección, corporativo, la empresa o el responsable del proyecto registran la autorización del cliente' using errcode = '42501';
  end if;
  if p_autorizado and v_estado <> 'publicado' then
    raise exception 'El cliente solo puede autorizar un precio ya publicado (estado actual: %)', v_estado;
  end if;

  update public.pu_analisis
  set cliente_autorizado_en = case when p_autorizado then now() else null end,
      cliente_autorizado_por = case when p_autorizado then v_uid else null end,
      cliente_referencia = case when p_autorizado then nullif(trim(coalesce(p_referencia, '')), '') else null end
  where id = p_analisis_id;

  insert into public.pu_aprobaciones (analisis_id, estado_anterior, estado_nuevo, actor_id, actor_rol, actor_nombre, comentario)
  values (p_analisis_id, v_estado, v_estado, v_uid, v_rol, (select nombre from public.profiles where id = v_uid),
          case when p_autorizado then 'Cliente autorizó' || coalesce(' · ' || nullif(trim(p_referencia), ''), '') else 'Se retiró la autorización del cliente' end);
end;
$$;

revoke all on function public.fn_pu_autorizar_cliente(uuid, boolean, text) from public;
grant execute on function public.fn_pu_autorizar_cliente(uuid, boolean, text) to authenticated, service_role;
