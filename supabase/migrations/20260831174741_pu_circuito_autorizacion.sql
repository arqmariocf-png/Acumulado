-- Módulo Precios Unitarios (3/3 flujo): circuito de autorización.
--
-- El supervisor de obra captura rendimientos de su gente y el material que
-- necesita; almacén confirma el material; dirección autoriza (fianzas); y
-- dirección general cierra con indirectos y utilidad. Hasta entonces el PU no
-- es descargable. Las etapas se validan por ROL, no por persona, para que el
-- circuito siga vivo cuando alguien cambie de puesto.
--
--   borrador -> en_revision_material -> material_confirmado -> autorizado -> publicado
--
-- Cualquier revisor puede regresar a borrador (rechazo). Todo movimiento queda
-- en pu_aprobaciones.

alter table pu_analisis drop constraint pu_analisis_estado_check;

alter table pu_analisis add constraint pu_analisis_estado_check
  check (estado in ('borrador', 'en_revision_material', 'material_confirmado', 'autorizado', 'publicado', 'obsoleto'));

comment on column pu_analisis.estado is
  'Etapa del circuito. Solo "publicado" es descargable por el supervisor: antes de eso el precio todavía no tiene material confirmado ni utilidad definida.';

create table pu_aprobaciones (
  id uuid primary key default gen_random_uuid(),
  analisis_id uuid not null references pu_analisis(id) on delete cascade,
  estado_anterior text not null,
  estado_nuevo text not null,
  actor_id uuid references profiles(id) on delete set null,
  actor_rol app_rol,
  comentario text,
  created_at timestamptz not null default now()
);

comment on table pu_aprobaciones is
  'Bitácora del circuito de autorización de un PU: quién movió qué etapa y cuándo. Se escribe sola por trigger -- no depende de que la app se acuerde de registrarla.';

create index pu_aprobaciones_analisis_idx on pu_aprobaciones (analisis_id, created_at desc);

-- Comentario de rechazo/aprobación que la app deja en el mismo UPDATE que
-- cambia el estado. No se persiste en el análisis: viaja al renglón de bitácora.
alter table pu_analisis add column comentario_revision text;

comment on column pu_analisis.comentario_revision is
  'Buzón de un solo uso: lo que el revisor escribe al mover la etapa. El trigger lo copia a pu_aprobaciones y lo limpia, así el análisis nunca arrastra el comentario de un rechazo ya resuelto.';

create function validar_flujo_pu_analisis() returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_rol app_rol := auth_rol();
  v_uid uuid := (select auth.uid());
  v_es_supervisor boolean;
  v_transicion text;
begin
  -- service_role (Edge Functions, generación de PDF, cargas) no tiene sesión;
  -- ahí no hay circuito que validar.
  if v_rol is null then
    return new;
  end if;

  if new.estado is not distinct from old.estado then
    if new.factor_id is distinct from old.factor_id and v_rol <> 'admin' then
      raise exception 'Solo dirección general define el factor de sobrecosto (indirectos y utilidad) del análisis';
    end if;
    return new;
  end if;

  select exists (
    select 1 from proyectos p
    where p.id = new.proyecto_id and p.responsable_id = v_uid
  ) into v_es_supervisor;

  v_transicion := old.estado || '->' || new.estado;

  if new.estado = 'borrador' and old.estado <> 'borrador' then
    -- Rechazo: regresa al supervisor. Lo puede hacer cualquier revisor del
    -- circuito, o el propio supervisor si quiere retirar su envío.
    if not (v_rol = any (array['almacen', 'direccion', 'admin', 'corporativo']::app_rol[]) or v_es_supervisor) then
      raise exception 'Tu rol (%) no puede regresar el análisis a borrador', v_rol;
    end if;

  elsif v_transicion = 'borrador->en_revision_material' then
    if not (v_es_supervisor or v_rol = any (array['admin', 'corporativo', 'direccion']::app_rol[])) then
      raise exception 'Solo el supervisor del proyecto puede enviar su análisis a revisión de material';
    end if;
    if not exists (select 1 from pu_analisis_items i where i.analisis_id = new.id) then
      raise exception 'No puedes enviar a revisión un análisis sin renglones de mano de obra ni material';
    end if;

  elsif v_transicion = 'en_revision_material->material_confirmado' then
    if v_rol <> all (array['almacen', 'admin']::app_rol[]) then
      raise exception 'La confirmación de material le toca a almacén';
    end if;

  elsif v_transicion = 'material_confirmado->autorizado' then
    if v_rol <> all (array['direccion', 'admin']::app_rol[]) then
      raise exception 'La autorización (fianzas) le toca a dirección';
    end if;

  elsif v_transicion = 'autorizado->publicado' then
    if v_rol <> 'admin' then
      raise exception 'Solo dirección general publica el precio unitario';
    end if;
    if new.factor_id is null and not new.es_auxiliar then
      raise exception 'No se puede publicar un PU sin factor de sobrecosto: falta definir indirectos y utilidad';
    end if;

  elsif v_transicion = 'publicado->obsoleto' then
    if v_rol <> all (array['admin', 'corporativo']::app_rol[]) then
      raise exception 'Solo dirección general o corporativo dan de baja un PU publicado';
    end if;

  else
    raise exception 'Transición de etapa no permitida: %', v_transicion;
  end if;

  return new;
end;
$$;

create trigger validar_flujo_pu_analisis
  before update on pu_analisis
  for each row execute function validar_flujo_pu_analisis();

create function registrar_aprobacion_pu() returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into pu_aprobaciones (analisis_id, estado_anterior, estado_nuevo, actor_id, actor_rol, comentario)
  values (new.id, old.estado, new.estado, (select auth.uid()), auth_rol(), new.comentario_revision);

  update pu_analisis set comentario_revision = null where id = new.id;
  return null;
end;
$$;

create trigger registrar_aprobacion_pu
  after update of estado on pu_analisis
  for each row
  when (old.estado is distinct from new.estado)
  execute function registrar_aprobacion_pu();

alter table pu_aprobaciones enable row level security;

create policy pu_aprobaciones_select on pu_aprobaciones
  for select using (
    exists (select 1 from pu_analisis a where a.id = pu_aprobaciones.analisis_id)
  );

grant select on pu_aprobaciones to authenticated;