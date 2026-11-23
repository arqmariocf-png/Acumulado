-- Facturación con factura.com (23-nov-2026, Mario: "necesitamos hacer una
-- conexión con factura.com para que las órdenes de venta se agreguen de
-- inmediato y podamos facturar con un clic").
--
-- Piezas:
--  1. facturacion_config: una por empresa. Entorno (sandbox/producción),
--     serie con la que se timbra, régimen y C.P. de expedición, y las dos
--     llaves de la API (F-Api-Key / F-Secret-Key) guardadas en Vault; la
--     tabla solo trae el id del secreto. Las llaves entran y salen únicamente
--     por funciones service_role que llama la edge `facturacion-factura-com`.
--  2. facturas_emitidas: cada timbrado (o intento) desde una OV: UID de
--     factura.com, UUID del SAT, serie/folio, importes, petición y respuesta,
--     XML/PDF en Storage (cargas/facturas/<empresa>/…) y la liga al renglón
--     de `cfdi` (así cuentas por cobrar y conciliación la ven como cualquier
--     CFDI emitido). Una OV solo puede tener UNA factura timbrada viva.
--  3. facturacion_claves_sat: memoria por organización de la clave de
--     producto/servicio y unidad del SAT que se usó para cada descripción;
--     la siguiente factura con el mismo concepto sale prellenada.
--  4. Datos fiscales que faltaban: clientes.uso_cfdi / pais / UID en
--     factura.com; clave_prod_serv y clave_unidad en productos, compras_items
--     y ordenes_venta_lineas (sat_code ya era la clave de producto).
--
-- Quién factura: admin, dirección, corporativo o permiso por persona
-- 'contabilidad' (auth_opera_facturacion). Se aplicó en producción como
-- `facturacion_factura_com`.

create or replace function public.auth_opera_facturacion()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.activo and not coalesce(p.espectador, false)
       and (p.rol in ('admin', 'direccion', 'corporativo')
            or exists (select 1 from public.permisos_modulo m where m.profile_id = p.id and m.modulo = 'contabilidad')))
$$;
revoke all on function public.auth_opera_facturacion() from public, anon;
grant execute on function public.auth_opera_facturacion() to authenticated, service_role;

-- 4. Datos fiscales
alter table public.clientes
  add column if not exists uso_cfdi text,
  add column if not exists pais text not null default 'MEX',
  add column if not exists factura_com_uid text,
  add column if not exists factura_com_entorno text;
alter table public.productos
  add column if not exists clave_prod_serv text,
  add column if not exists clave_unidad text;
alter table public.compras_items
  add column if not exists clave_prod_serv text,
  add column if not exists clave_unidad text;
alter table public.ordenes_venta_lineas
  add column if not exists clave_unidad text;

-- 1. Configuración por empresa
create table if not exists public.facturacion_config (
  empresa_id uuid primary key references public.empresas (id),
  grupo_id uuid not null references public.grupos (id),
  proveedor text not null default 'factura_com' check (proveedor = 'factura_com'),
  entorno text not null default 'sandbox' check (entorno in ('sandbox', 'produccion')),
  api_key_secret_id uuid,
  secret_key_secret_id uuid,
  serie_id integer,
  serie_nombre text,
  regimen_fiscal text,
  lugar_expedicion text check (lugar_expedicion is null or lugar_expedicion ~ '^[0-9]{5}$'),
  enviar_correo boolean not null default true,
  clave_prod_serv_default text,
  clave_unidad_default text not null default 'H87',
  probado_en timestamptz,
  ultimo_error text,
  actualizado_por uuid references public.profiles (id),
  actualizado_por_nombre text,
  updated_at timestamptz not null default now()
);

create or replace function public.facturacion_config_antes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.grupo_id is null or tg_op = 'INSERT' then
    select grupo_id into new.grupo_id from public.empresas where id = new.empresa_id;
  end if;
  -- Los secretos solo los mueven las funciones service_role (sin usuario).
  if auth.uid() is not null then
    if tg_op = 'INSERT' and (new.api_key_secret_id is not null or new.secret_key_secret_id is not null) then
      raise exception 'Las llaves de la API se guardan desde la pantalla de facturación, no a mano' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.api_key_secret_id is distinct from old.api_key_secret_id or new.secret_key_secret_id is distinct from old.secret_key_secret_id) then
      raise exception 'Las llaves de la API se guardan desde la pantalla de facturación, no a mano' using errcode = '42501';
    end if;
    new.actualizado_por := auth.uid();
    select nombre into new.actualizado_por_nombre from public.profiles where id = auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger facturacion_config_antes before insert or update on public.facturacion_config
  for each row execute function public.facturacion_config_antes();

alter table public.facturacion_config enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'facturacion_config' and policyname = 'frontera_organizacion') then
    create policy frontera_organizacion on public.facturacion_config as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'facturacion_config' and policyname = 'espectador_sin_datos') then
    create policy espectador_sin_datos on public.facturacion_config as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'facturacion_config' and policyname = 'director_general') then
    create policy director_general on public.facturacion_config for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'facturacion_config' and policyname = 'facturacion_config_select') then
    create policy facturacion_config_select on public.facturacion_config for select to authenticated
      using ((select public.auth_opera_facturacion()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'facturacion_config' and policyname = 'facturacion_config_insert') then
    create policy facturacion_config_insert on public.facturacion_config for insert to authenticated
      with check ((select public.auth_opera_facturacion()) and (select public.auth_suscripcion_permite_escribir_definer())
                  and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'facturacion_config' and policyname = 'facturacion_config_update') then
    create policy facturacion_config_update on public.facturacion_config for update to authenticated
      using ((select public.auth_opera_facturacion()) and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))
      with check ((select public.auth_opera_facturacion()) and (select public.auth_suscripcion_permite_escribir_definer())
                  and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
  end if;
end $$;
create or replace trigger solo_consulta before insert or update or delete on public.facturacion_config
  for each statement execute function public.bloquear_solo_consulta();

/** Guarda (o reemplaza) las llaves de la API de factura.com de una empresa en
 * Vault y deja la configuración apuntando a ellas. Solo service_role: la llama
 * la edge después de probar las llaves contra /v4/series. */
create or replace function public.fn_facturacion_credenciales_guardar(
  p_empresa uuid, p_entorno text, p_api_key text, p_secret_key text, p_por uuid, p_por_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cfg public.facturacion_config%rowtype;
  v_grupo uuid;
  v_api uuid;
  v_sec uuid;
  v_n_api text := 'facturacion_api_key_' || p_empresa::text;
  v_n_sec text := 'facturacion_secret_key_' || p_empresa::text;
begin
  if p_entorno not in ('sandbox', 'produccion') then raise exception 'Entorno inválido'; end if;
  if coalesce(p_api_key, '') = '' or coalesce(p_secret_key, '') = '' then raise exception 'Faltan las llaves'; end if;
  select grupo_id into v_grupo from public.empresas where id = p_empresa;
  if v_grupo is null then raise exception 'Empresa no encontrada'; end if;
  select * into v_cfg from public.facturacion_config where empresa_id = p_empresa;

  v_api := v_cfg.api_key_secret_id;
  if v_api is null then select id into v_api from vault.secrets where name = v_n_api; end if;
  if v_api is null then v_api := vault.create_secret(p_api_key, v_n_api, 'factura.com F-Api-Key');
  else perform vault.update_secret(v_api, p_api_key, v_n_api, 'factura.com F-Api-Key'); end if;

  v_sec := v_cfg.secret_key_secret_id;
  if v_sec is null then select id into v_sec from vault.secrets where name = v_n_sec; end if;
  if v_sec is null then v_sec := vault.create_secret(p_secret_key, v_n_sec, 'factura.com F-Secret-Key');
  else perform vault.update_secret(v_sec, p_secret_key, v_n_sec, 'factura.com F-Secret-Key'); end if;

  insert into public.facturacion_config (empresa_id, grupo_id, entorno, api_key_secret_id, secret_key_secret_id,
                                         probado_en, ultimo_error, actualizado_por, actualizado_por_nombre, updated_at)
  values (p_empresa, v_grupo, p_entorno, v_api, v_sec, now(), null, p_por, p_por_nombre, now())
  on conflict (empresa_id) do update set
    entorno = excluded.entorno,
    api_key_secret_id = excluded.api_key_secret_id,
    secret_key_secret_id = excluded.secret_key_secret_id,
    -- la serie es del entorno: si cambia el entorno hay que volver a elegirla
    serie_id = case when public.facturacion_config.entorno = excluded.entorno then public.facturacion_config.serie_id end,
    serie_nombre = case when public.facturacion_config.entorno = excluded.entorno then public.facturacion_config.serie_nombre end,
    probado_en = now(), ultimo_error = null,
    actualizado_por = excluded.actualizado_por, actualizado_por_nombre = excluded.actualizado_por_nombre, updated_at = now();
end $$;
revoke all on function public.fn_facturacion_credenciales_guardar(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.fn_facturacion_credenciales_guardar(uuid, text, text, text, uuid, text) to service_role;

/** Las llaves descifradas y la configuración para timbrar. Solo service_role. */
create or replace function public.fn_facturacion_credenciales(p_empresa uuid)
returns table (entorno text, api_key text, secret_key text, serie_id integer, serie_nombre text, regimen_fiscal text,
               lugar_expedicion text, enviar_correo boolean, clave_prod_serv_default text, clave_unidad_default text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select c.entorno, a.decrypted_secret::text, s.decrypted_secret::text, c.serie_id, c.serie_nombre, c.regimen_fiscal,
         c.lugar_expedicion, c.enviar_correo, c.clave_prod_serv_default, c.clave_unidad_default
    from public.facturacion_config c
    left join vault.decrypted_secrets a on a.id = c.api_key_secret_id
    left join vault.decrypted_secrets s on s.id = c.secret_key_secret_id
   where c.empresa_id = p_empresa;
end $$;
revoke all on function public.fn_facturacion_credenciales(uuid) from public, anon, authenticated;
grant execute on function public.fn_facturacion_credenciales(uuid) to service_role;

/** Quita las llaves (deja los secretos en blanco; la configuración se conserva). Solo service_role. */
create or replace function public.fn_facturacion_credenciales_quitar(p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cfg public.facturacion_config%rowtype;
begin
  select * into v_cfg from public.facturacion_config where empresa_id = p_empresa;
  if v_cfg.empresa_id is null then return; end if;
  if v_cfg.api_key_secret_id is not null then perform vault.update_secret(v_cfg.api_key_secret_id, '', 'facturacion_api_key_' || p_empresa::text, 'factura.com F-Api-Key (sin llave)'); end if;
  if v_cfg.secret_key_secret_id is not null then perform vault.update_secret(v_cfg.secret_key_secret_id, '', 'facturacion_secret_key_' || p_empresa::text, 'factura.com F-Secret-Key (sin llave)'); end if;
  update public.facturacion_config set api_key_secret_id = null, secret_key_secret_id = null, probado_en = null, updated_at = now()
   where empresa_id = p_empresa;
end $$;
revoke all on function public.fn_facturacion_credenciales_quitar(uuid) from public, anon, authenticated;
grant execute on function public.fn_facturacion_credenciales_quitar(uuid) to service_role;

-- 2. Facturas emitidas
create table if not exists public.facturas_emitidas (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos (id),
  empresa_id uuid not null references public.empresas (id),
  orden_venta_id uuid references public.ordenes_venta (id),
  cliente_id uuid references public.clientes (id),
  proveedor text not null default 'factura_com',
  entorno text not null check (entorno in ('sandbox', 'produccion')),
  proveedor_uid text,
  uuid text,
  serie text,
  folio text,
  rfc_receptor text,
  nombre_receptor text,
  uso_cfdi text,
  forma_pago text,
  metodo_pago text,
  subtotal numeric(14,2),
  iva numeric(14,2),
  total numeric(14,2),
  estado text not null check (estado in ('timbrada', 'cancelada', 'error')),
  mensaje text,
  peticion jsonb,
  respuesta jsonb,
  xml_path text,
  pdf_path text,
  cfdi_id uuid references public.cfdi (id),
  creado_por uuid references public.profiles (id),
  creado_por_nombre text,
  created_at timestamptz not null default now(),
  cancelada_en timestamptz,
  cancelada_por uuid references public.profiles (id),
  cancelacion_motivo text,
  cancelacion_sustituto text,
  acuse_cancelacion text
);
create index if not exists facturas_emitidas_empresa_fecha on public.facturas_emitidas (empresa_id, created_at desc);
create index if not exists facturas_emitidas_ov on public.facturas_emitidas (orden_venta_id);
create unique index if not exists facturas_emitidas_ov_viva on public.facturas_emitidas (orden_venta_id) where estado = 'timbrada' and orden_venta_id is not null;

alter table public.facturas_emitidas enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'facturas_emitidas' and policyname = 'frontera_organizacion') then
    create policy frontera_organizacion on public.facturas_emitidas as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'facturas_emitidas' and policyname = 'espectador_sin_datos') then
    create policy espectador_sin_datos on public.facturas_emitidas as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'facturas_emitidas' and policyname = 'director_general') then
    create policy director_general on public.facturas_emitidas for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()));
  end if;
  -- Ven: quien factura y quien captura órdenes (para ver "facturada" en su OV).
  if not exists (select 1 from pg_policies where tablename = 'facturas_emitidas' and policyname = 'facturas_emitidas_select') then
    create policy facturas_emitidas_select on public.facturas_emitidas for select to authenticated
      using (((select public.auth_opera_facturacion()) or (select public.auth_captura_ordenes()))
             and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]));
  end if;
end $$;
create or replace trigger solo_consulta before insert or update or delete on public.facturas_emitidas
  for each statement execute function public.bloquear_solo_consulta();

-- 3. Memoria de claves SAT por descripción
create table if not exists public.facturacion_claves_sat (
  grupo_id uuid not null references public.grupos (id),
  descripcion_norm text not null,
  descripcion text not null,
  clave_prod_serv text not null,
  clave_unidad text not null,
  unidad text,
  veces integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (grupo_id, descripcion_norm)
);
alter table public.facturacion_claves_sat enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'facturacion_claves_sat' and policyname = 'frontera_organizacion') then
    create policy frontera_organizacion on public.facturacion_claves_sat as restrictive for all
      using (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
      with check (grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'facturacion_claves_sat' and policyname = 'espectador_sin_datos') then
    create policy espectador_sin_datos on public.facturacion_claves_sat as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'facturacion_claves_sat' and policyname = 'director_general') then
    create policy director_general on public.facturacion_claves_sat for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'facturacion_claves_sat' and policyname = 'facturacion_claves_sat_select') then
    create policy facturacion_claves_sat_select on public.facturacion_claves_sat for select to authenticated
      using ((select public.auth_rol_definer()) <> 'pendiente');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'facturacion_claves_sat' and policyname = 'facturacion_claves_sat_write') then
    create policy facturacion_claves_sat_write on public.facturacion_claves_sat for all to authenticated
      using ((select public.auth_opera_facturacion()))
      with check ((select public.auth_opera_facturacion()) and (select public.auth_suscripcion_permite_escribir_definer()));
  end if;
end $$;
create or replace trigger solo_consulta before insert or update or delete on public.facturacion_claves_sat
  for each statement execute function public.bloquear_solo_consulta();

/** Lo que la pantalla "Facturar" necesita de una OV en una sola consulta:
 * encabezado, partidas (con la clave SAT recordada para su descripción),
 * clientes de la empresa que se parecen al nombre de la OV, configuración de
 * la empresa (sin secretos) y si ya tiene factura. RLS de quien pregunta
 * sobre la OV; el resto se arma aquí para no pegar cuatro veces. */
create or replace function public.fn_ov_para_facturar(p_ov uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ov public.ordenes_venta%rowtype;
  v_grupo uuid;
  v_r jsonb;
begin
  if not public.auth_opera_facturacion() then
    raise exception 'Sin permiso para facturar' using errcode = '42501';
  end if;
  select * into v_ov from public.ordenes_venta
   where id = p_ov and empresa_id = any (public.auth_empresas_alcance());
  if v_ov.id is null then raise exception 'La orden de venta no existe o no tienes acceso'; end if;
  select grupo_id into v_grupo from public.empresas where id = v_ov.empresa_id;

  select jsonb_build_object(
    'ov', jsonb_build_object('id', v_ov.id, 'id_ov', v_ov.id_ov, 'empresa_id', v_ov.empresa_id, 'cliente', v_ov.cliente,
            'proyecto', v_ov.proyecto, 'fecha_ov', v_ov.fecha_ov, 'total', v_ov.total, 'subtotal', v_ov.subtotal, 'iva', v_ov.iva,
            'forma_pago', v_ov.forma_pago, 'condicion_pago', v_ov.condicion_pago, 'notas', v_ov.notas, 'fuente', v_ov.fuente,
            'cancelada', v_ov.cancelada_en is not null),
    'empresa', (select jsonb_build_object('id', e.id, 'codigo', e.codigo, 'nombre', e.nombre, 'rfc', e.rfc, 'razon_social', e.razon_social)
                  from public.empresas e where e.id = v_ov.empresa_id),
    'lineas', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', l.id, 'numero', l.numero, 'concepto', l.concepto, 'unidad', l.unidad, 'cantidad', l.cantidad,
                 'precio_base', l.precio_base, 'iva', coalesce(l.iva, true), 'sat_code', l.sat_code, 'clave_unidad', l.clave_unidad,
                 'memoria', (select jsonb_build_object('clave_prod_serv', m.clave_prod_serv, 'clave_unidad', m.clave_unidad, 'unidad', m.unidad)
                               from public.facturacion_claves_sat m
                              where m.grupo_id = v_grupo and m.descripcion_norm = public.normalizar_texto_sql(l.concepto)),
                 'producto', (select jsonb_build_object('clave_prod_serv', p.clave_prod_serv, 'clave_unidad', p.clave_unidad)
                               from public.productos p
                              where p.empresa_id = v_ov.empresa_id and p.activo and public.normalizar_texto_sql(p.nombre) = public.normalizar_texto_sql(l.concepto)
                              limit 1)
               ) order by l.numero, l.created_at)
               from public.ordenes_venta_lineas l where l.orden_venta_id = v_ov.id), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'razon_social', c.razon_social, 'nombre_comercial', c.nombre_comercial, 'rfc', c.rfc,
                 'regimen_fiscal', c.regimen_fiscal, 'codigo_postal', c.codigo_postal, 'email', c.email, 'uso_cfdi', c.uso_cfdi,
                 'domicilio', c.domicilio, 'factura_com_uid', c.factura_com_uid, 'factura_com_entorno', c.factura_com_entorno,
                 'coincide', public.fn_proveedor_clave(c.razon_social) = public.fn_proveedor_clave(v_ov.cliente)
                             or public.fn_proveedor_clave(coalesce(c.nombre_comercial, '')) = public.fn_proveedor_clave(v_ov.cliente)
               ) order by c.razon_social)
               from public.clientes c where c.empresa_id = v_ov.empresa_id and c.activo), '[]'::jsonb),
    'config', (select jsonb_build_object('entorno', f.entorno, 'serie_id', f.serie_id, 'serie_nombre', f.serie_nombre,
                 'regimen_fiscal', f.regimen_fiscal, 'lugar_expedicion', f.lugar_expedicion, 'enviar_correo', f.enviar_correo,
                 'clave_prod_serv_default', f.clave_prod_serv_default, 'clave_unidad_default', f.clave_unidad_default,
                 'con_llaves', f.api_key_secret_id is not null and f.secret_key_secret_id is not null)
                 from public.facturacion_config f where f.empresa_id = v_ov.empresa_id),
    'factura', (select jsonb_build_object('id', x.id, 'uuid', x.uuid, 'serie', x.serie, 'folio', x.folio, 'estado', x.estado,
                 'total', x.total, 'created_at', x.created_at, 'entorno', x.entorno, 'pdf_path', x.pdf_path, 'xml_path', x.xml_path)
                 from public.facturas_emitidas x where x.orden_venta_id = v_ov.id and x.estado = 'timbrada' limit 1)
  ) into v_r;
  return v_r;
end $$;
revoke all on function public.fn_ov_para_facturar(uuid) from public, anon;
grant execute on function public.fn_ov_para_facturar(uuid) to authenticated, service_role;

/** Después de timbrar: guarda lo aprendido (claves SAT por descripción, datos
 * fiscales del cliente, claves en las partidas) y registra la factura y su
 * CFDI emitido. Solo service_role (la edge, ya con la respuesta de factura.com). */
create or replace function public.fn_factura_registrar(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_cfdi uuid;
  v_grupo uuid;
  v_empresa uuid := (p->>'empresa_id')::uuid;
  v_ov uuid := nullif(p->>'orden_venta_id', '')::uuid;
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, (now() at time zone 'America/Mexico_City')::date);
  l jsonb;
begin
  select grupo_id into v_grupo from public.empresas where id = v_empresa;
  if v_grupo is null then raise exception 'Empresa no encontrada'; end if;

  if p->>'estado' = 'timbrada' then
    insert into public.cfdi (tipo, empresa_id, rfc, folio, total, periodo, contraparte, fecha, tipo_comprobante, metodo_pago, forma_pago, es_complemento_pago)
    values ('emitido', v_empresa, upper(p->>'rfc_receptor'), upper(p->>'uuid'), (p->>'total')::numeric, to_char(v_fecha, 'YYYYMM'),
            p->>'nombre_receptor', v_fecha, 'I', p->>'metodo_pago', p->>'forma_pago', false)
    on conflict (tipo, rfc, folio, periodo) do update set total = excluded.total, contraparte = excluded.contraparte,
            metodo_pago = excluded.metodo_pago, forma_pago = excluded.forma_pago
    returning id into v_cfdi;
  end if;

  insert into public.facturas_emitidas (grupo_id, empresa_id, orden_venta_id, cliente_id, entorno, proveedor_uid, uuid, serie, folio,
      rfc_receptor, nombre_receptor, uso_cfdi, forma_pago, metodo_pago, subtotal, iva, total, estado, mensaje, peticion, respuesta,
      xml_path, pdf_path, cfdi_id, creado_por, creado_por_nombre)
  values (v_grupo, v_empresa, v_ov, nullif(p->>'cliente_id', '')::uuid, p->>'entorno', p->>'proveedor_uid', upper(p->>'uuid'),
      p->>'serie', p->>'folio', upper(p->>'rfc_receptor'), p->>'nombre_receptor', p->>'uso_cfdi', p->>'forma_pago', p->>'metodo_pago',
      (p->>'subtotal')::numeric, (p->>'iva')::numeric, (p->>'total')::numeric, p->>'estado', p->>'mensaje', p->'peticion', p->'respuesta',
      p->>'xml_path', p->>'pdf_path', v_cfdi, nullif(p->>'creado_por', '')::uuid, p->>'creado_por_nombre')
  returning id into v_id;

  if p->>'estado' = 'timbrada' then
    -- Memoria de claves y claves en las partidas
    for l in select * from jsonb_array_elements(coalesce(p->'conceptos', '[]'::jsonb)) loop
      if coalesce(l->>'clave_prod_serv', '') <> '' and coalesce(l->>'clave_unidad', '') <> '' and coalesce(l->>'descripcion', '') <> '' then
        insert into public.facturacion_claves_sat (grupo_id, descripcion_norm, descripcion, clave_prod_serv, clave_unidad, unidad)
        values (v_grupo, public.normalizar_texto_sql(l->>'descripcion'), l->>'descripcion', l->>'clave_prod_serv', l->>'clave_unidad', l->>'unidad')
        on conflict (grupo_id, descripcion_norm) do update set clave_prod_serv = excluded.clave_prod_serv, clave_unidad = excluded.clave_unidad,
          unidad = excluded.unidad, veces = public.facturacion_claves_sat.veces + 1, updated_at = now();
        if nullif(l->>'linea_id', '') is not null then
          update public.ordenes_venta_lineas set sat_code = l->>'clave_prod_serv', clave_unidad = l->>'clave_unidad'
           where id = (l->>'linea_id')::uuid;
        end if;
        update public.productos set clave_prod_serv = l->>'clave_prod_serv', clave_unidad = l->>'clave_unidad'
         where empresa_id = v_empresa and public.normalizar_texto_sql(nombre) = public.normalizar_texto_sql(l->>'descripcion')
           and (clave_prod_serv is null or clave_unidad is null);
      end if;
    end loop;
  end if;
  return v_id;
end $$;
revoke all on function public.fn_factura_registrar(jsonb) from public, anon, authenticated;
grant execute on function public.fn_factura_registrar(jsonb) to service_role;
