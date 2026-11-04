-- Remisiones: un solo folio por empresa y paso a facturación (4-nov-2026,
-- Mario: "la remisión de mallas tiene un folio diferente a las remisiones,
-- vincúlalos, folios para que sea mucho más fácil el seguimiento"; "pásalas al
-- proceso de facturación, para que ya solamente tengan que dar click las
-- contadoras").
--
-- 1. Folio único. Las remisiones de almacén (remisiones_salida, "REM-000004")
--    y las de planta (remisiones_produccion, "RM-000001") llevaban cada una su
--    consecutivo. Ahora las dos tablas toman el número de UNA serie por
--    empresa (folios_series, serie 'REM') y el folio dice la empresa:
--    REM-<CODIGO>-000005. El folio deja de ser columna generada: la columna
--    vieja queda como folio_anterior (quitar la expresión generada es una
--    sentencia que el MCP no deja pasar) y `folio` es texto que llena el trigger. Los
--    folios ya impresos conservan su número; solo se les agrega el código de
--    la empresa (REM-000004 → REM-MCC-000004; la única de planta, RM-000001 →
--    RM-MCC-000001, para no chocar con REM-MCC-000001 de almacén).
-- 2. Facturación. Las dos tablas traen factura_estado (por_facturar →
--    facturada | no_factura; no_aplica para las entradas de planta), con el
--    CFDI emitido del SAT ligado (cfdi_id) o el folio a mano. Solo se escribe
--    por fn_remision_facturar / fn_remision_sin_factura / fn_remision_reabrir
--    (admin, corporativo, dirección o permiso 'contabilidad', en su alcance).
--    fn_remisiones_facturacion() lista las dos tablas juntas para la
--    pantalla Contabilidad › Remisiones por facturar. Al confirmar la entrega
--    de una remisión de salida se avisa por push a contabilidad.
--
-- Ya aplicado en producción (remisiones_folio_unico_facturacion).

-- ── 1. Folio único por empresa ─────────────────────────────────────────────

alter table public.remisiones_salida rename column folio to folio_anterior;
alter table public.remisiones_salida add column folio text;
alter table public.remisiones_produccion rename column folio to folio_anterior;
alter table public.remisiones_produccion add column folio text;

-- Los folios ya emitidos conservan su número y se les agrega la empresa.
update public.remisiones_salida r
   set folio = 'REM-' || upper(e.codigo) || '-' || lpad(r.numero::text, 6, '0')
  from public.empresas e where e.id = r.empresa_id and r.folio is null;
update public.remisiones_produccion r
   set folio = 'RM-' || upper(e.codigo) || '-' || lpad(r.numero::text, 6, '0')
  from public.empresas e where e.id = r.empresa_id and r.folio is null;

alter table public.remisiones_salida alter column folio set not null;
alter table public.remisiones_produccion alter column folio set not null;
create unique index if not exists remisiones_salida_folio_uidx on public.remisiones_salida (empresa_id, folio);
create unique index if not exists remisiones_produccion_folio_uidx on public.remisiones_produccion (empresa_id, folio);

-- La serie compartida arranca donde va la más alta de las dos tablas.
insert into public.folios_series (empresa_id, serie, ultimo)
select e.id, 'REM',
       greatest(coalesce((select max(numero) from public.remisiones_salida s where s.empresa_id = e.id), 0),
                coalesce((select max(numero) from public.remisiones_produccion p where p.empresa_id = e.id), 0))
  from public.empresas e
on conflict (empresa_id, serie) do update
  set ultimo = greatest(public.folios_series.ultimo, excluded.ultimo);

-- Siguiente número de la serie REM de la empresa (candado por empresa) y su
-- folio con el código de la empresa. La usan los dos triggers.
create or replace function public.fn_remision_siguiente_numero(p_empresa_id uuid, out numero integer, out folio text)
language plpgsql security definer set search_path = public as $$
declare v_codigo text;
begin
  select upper(codigo) into v_codigo from public.empresas where id = p_empresa_id;
  if v_codigo is null then raise exception 'Empresa no encontrada'; end if;
  perform pg_advisory_xact_lock(hashtext('remisiones:' || p_empresa_id::text));
  insert into public.folios_series (empresa_id, serie, ultimo) values (p_empresa_id, 'REM', 1)
  on conflict (empresa_id, serie) do update set ultimo = public.folios_series.ultimo + 1
  returning ultimo into numero;
  folio := 'REM-' || v_codigo || '-' || lpad(numero::text, 6, '0');
end;
$$;
revoke all on function public.fn_remision_siguiente_numero(uuid) from public, anon, authenticated;

create or replace function public.remisiones_salida_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n integer; v_folio text;
begin
  if not exists (select 1 from public.almacenes where id = new.almacen_id and empresa_id = new.empresa_id) then
    raise exception 'El almacén no pertenece a la empresa de la remisión';
  end if;
  if new.orden_venta_id is not null
    and not exists (select 1 from public.ordenes_venta where id = new.orden_venta_id and empresa_id = new.empresa_id) then
    raise exception 'La orden de venta no pertenece a la empresa de la remisión';
  end if;
  select numero, folio into v_n, v_folio from public.fn_remision_siguiente_numero(new.empresa_id);
  new.numero := v_n;
  new.folio := v_folio;
  return new;
end;
$$;

create or replace function public.remisiones_produccion_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n integer; v_folio text;
begin
  select numero, folio into v_n, v_folio from public.fn_remision_siguiente_numero(new.empresa_id);
  new.numero := v_n;
  new.folio := v_folio;
  if new.tipo = 'entrada' then new.factura_estado := 'no_aplica'; end if;
  return new;
end;
$$;

-- ── 2. Facturación ─────────────────────────────────────────────────────────

alter table public.remisiones_salida
  add column factura_estado text not null default 'por_facturar'
    check (factura_estado in ('por_facturar', 'facturada', 'no_factura', 'no_aplica')),
  add column facturada_en timestamptz,
  add column facturada_por uuid references public.profiles (id),
  add column cfdi_id uuid references public.cfdi (id),
  add column factura_folio text,
  add column factura_nota text;
alter table public.remisiones_produccion
  add column factura_estado text not null default 'por_facturar'
    check (factura_estado in ('por_facturar', 'facturada', 'no_factura', 'no_aplica')),
  add column facturada_en timestamptz,
  add column facturada_por uuid references public.profiles (id),
  add column cfdi_id uuid references public.cfdi (id),
  add column factura_folio text,
  add column factura_nota text;
update public.remisiones_produccion set factura_estado = 'no_aplica' where tipo = 'entrada';
create index if not exists remisiones_salida_factura_idx on public.remisiones_salida (factura_estado, fecha desc);
create index if not exists remisiones_produccion_factura_idx on public.remisiones_produccion (factura_estado, fecha desc);

-- Quién factura: admin, corporativo, dirección o permiso por persona 'contabilidad'.
create or replace function public.auth_factura_remisiones()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo and not coalesce(p.espectador, false)
      and (p.rol in ('admin', 'corporativo', 'direccion')
           or exists (select 1 from public.permisos_modulo pm where pm.profile_id = p.id and pm.modulo = 'contabilidad'))
  )
$$;

-- Vistas que dependían de la columna vieja: se vuelven a crear apuntando a
-- la nueva `folio` (misma forma, más datos de empresa y facturación al final).
create or replace view public.v_remisiones_salida with (security_invoker = true) as
select r.id, r.empresa_id, e.nombre as empresa_nombre, r.almacen_id, a.nombre as almacen_nombre,
       r.numero, r.folio, r.fecha, r.entregar_a, r.destino, r.orden_venta_id, r.observaciones, r.estatus,
       r.emitida_por, pe.nombre as emitida_por_nombre, r.entregada_en, r.entregada_por, pr.nombre as entregada_por_nombre,
       r.recibio_nombre, r.created_at,
       (select count(*) from public.movimientos_inventario m where m.remision_id = r.id) as lineas,
       (select coalesce(sum(m.cantidad), 0) from public.movimientos_inventario m where m.remision_id = r.id) as cantidad_total,
       e.codigo as empresa_codigo, e.rfc as empresa_rfc, e.razon_social as empresa_razon_social,
       e.domicilio_fiscal as empresa_domicilio, e.telefono as empresa_telefono,
       r.factura_estado, r.facturada_en, r.cfdi_id, r.factura_folio, r.factura_nota
  from public.remisiones_salida r
  join public.empresas e on e.id = r.empresa_id
  join public.almacenes a on a.id = r.almacen_id
  left join public.profiles pe on pe.id = r.emitida_por
  left join public.profiles pr on pr.id = r.entregada_por;

create or replace view public.v_remisiones_produccion as
select r.id, r.empresa_id, r.numero, r.folio, r.tipo, r.fecha, r.contraparte, r.proyecto_id, r.orden_venta_id, r.orden_compra_id,
       r.observaciones, r.estatus, r.emitida_por, r.entregada_en, r.entregada_por, r.recibio_nombre, r.created_at,
       e.nombre as empresa_nombre, e.rfc as empresa_rfc, e.codigo as empresa_codigo,
       p.nombre as emitida_por_nombre, pr.nombre as proyecto_nombre,
       (select count(*) from public.remisiones_produccion_lineas l where l.remision_id = r.id) as lineas,
       r.cliente_id, c.rfc as cliente_rfc, c.domicilio as cliente_domicilio, r.condicion_pago, r.dias_credito,
       (select count(*) from public.remisiones_produccion_fotos f where f.remision_id = r.id) as fotos,
       r.paga_cliente_id, coalesce(r.paga_nombre, cp.razon_social) as paga_nombre, cp.rfc as paga_rfc, cp.domicilio as paga_domicilio,
       r.referencia_pago,
       e.razon_social as empresa_razon_social, e.domicilio_fiscal as empresa_domicilio, e.telefono as empresa_telefono,
       r.factura_estado, r.facturada_en, r.cfdi_id, r.factura_folio, r.factura_nota
  from public.remisiones_produccion r
  join public.empresas e on e.id = r.empresa_id
  left join public.profiles p on p.id = r.emitida_por
  left join public.proyectos pr on pr.id = r.proyecto_id
  left join public.clientes c on c.id = r.cliente_id
  left join public.clientes cp on cp.id = r.paga_cliente_id;

create or replace view public.v_margen_remisiones_produccion with (security_invoker = true) as
select r.id as remision_id, r.empresa_id, r.folio, r.fecha, r.contraparte, r.estatus, r.condicion_pago, r.dias_credito,
       count(l.id) as partidas,
       count(l.id) filter (where l.precio_unitario is null) as sin_precio,
       round(sum(l.cantidad * coalesce(l.precio_unitario, 0)), 2) as venta,
       round(sum(l.cantidad * coalesce(p.costo_peps, l.costo_unitario, 0)), 2) as costo,
       round(sum(l.cantidad * (coalesce(l.precio_unitario, 0) - coalesce(p.costo_peps, l.costo_unitario, 0))) filter (where l.precio_unitario is not null), 2) as margen
  from public.remisiones_produccion r
  join public.remisiones_produccion_lineas l on l.remision_id = r.id
  left join public.v_peps_remisiones_lineas p on p.linea_id = l.id
 where r.tipo = 'salida'
 group by r.id;

-- Lista para contabilidad: las dos tablas juntas, en el alcance de quien pregunta.
create or replace function public.fn_remisiones_facturacion(p_estado text default null)
returns table (
  origen text, id uuid, empresa_id uuid, empresa_codigo text, empresa_nombre text,
  folio text, fecha date, cliente text, cliente_rfc text, proyecto text, referencia text,
  estatus text, entregada_en timestamptz, lineas bigint, importe numeric,
  factura_estado text, facturada_en timestamptz, facturada_por_nombre text,
  cfdi_id uuid, cfdi_folio text, cfdi_total numeric, cfdi_fecha date, factura_folio text, factura_nota text
)
language sql stable security definer set search_path = public as $$
  with alcance as (select unnest(public.auth_empresas_alcance()) as empresa_id)
  select x.*
  from (
    select 'almacen'::text as origen, r.id, r.empresa_id, e.codigo, e.nombre, r.folio, r.fecha,
           r.entregar_a as cliente, null::text as cliente_rfc, r.destino as proyecto,
           case when ov.id_ov is not null then 'OV ' || ov.id_ov end as referencia,
           r.estatus, r.entregada_en,
           (select count(*) from public.movimientos_inventario m where m.remision_id = r.id) as lineas,
           null::numeric as importe,
           r.factura_estado, r.facturada_en, pf.nombre, r.cfdi_id, c.folio, c.total, c.fecha, r.factura_folio, r.factura_nota
      from public.remisiones_salida r
      join public.empresas e on e.id = r.empresa_id
      left join public.ordenes_venta ov on ov.id = r.orden_venta_id
      left join public.profiles pf on pf.id = r.facturada_por
      left join public.cfdi c on c.id = r.cfdi_id
    union all
    select 'planta', r.id, r.empresa_id, e.codigo, e.nombre, r.folio, r.fecha,
           coalesce(r.paga_nombre, cp.razon_social, r.contraparte), coalesce(cp.rfc, cl.rfc), pr.nombre,
           case when ov.id_ov is not null then 'OV ' || ov.id_ov else r.referencia_pago end,
           r.estatus, r.entregada_en,
           (select count(*) from public.remisiones_produccion_lineas l where l.remision_id = r.id),
           (select round(sum(l.cantidad * l.precio_unitario), 2) from public.remisiones_produccion_lineas l where l.remision_id = r.id and l.precio_unitario is not null),
           r.factura_estado, r.facturada_en, pf.nombre, r.cfdi_id, c.folio, c.total, c.fecha, r.factura_folio, r.factura_nota
      from public.remisiones_produccion r
      join public.empresas e on e.id = r.empresa_id
      left join public.ordenes_venta ov on ov.id = r.orden_venta_id
      left join public.proyectos pr on pr.id = r.proyecto_id
      left join public.clientes cl on cl.id = r.cliente_id
      left join public.clientes cp on cp.id = r.paga_cliente_id
      left join public.profiles pf on pf.id = r.facturada_por
      left join public.cfdi c on c.id = r.cfdi_id
     where r.tipo = 'salida'
  ) x (origen, id, empresa_id, empresa_codigo, empresa_nombre, folio, fecha, cliente, cliente_rfc, proyecto, referencia,
       estatus, entregada_en, lineas, importe, factura_estado, facturada_en, facturada_por_nombre,
       cfdi_id, cfdi_folio, cfdi_total, cfdi_fecha, factura_folio, factura_nota)
  where public.auth_factura_remisiones()
    and x.empresa_id in (select empresa_id from alcance)
    and (p_estado is null or x.factura_estado = p_estado)
  order by x.fecha desc, x.folio desc
$$;

-- Nadie edita los campos de facturación a mano: solo por las funciones.
create or replace function public.remisiones_guarda_facturacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.auth_admin_global() then return new; end if;
  if (new.factura_estado, new.facturada_en, new.facturada_por, new.cfdi_id, new.factura_folio, new.factura_nota)
     is distinct from (old.factura_estado, old.facturada_en, old.facturada_por, old.cfdi_id, old.factura_folio, old.factura_nota)
     and current_setting('acumulado.remision_facturando', true) is distinct from '1' then
    raise exception 'La facturación de la remisión se cambia desde Contabilidad › Remisiones por facturar';
  end if;
  return new;
end;
$$;
create or replace trigger remisiones_salida_guarda_facturacion before update on public.remisiones_salida
  for each row execute function public.remisiones_guarda_facturacion();
create or replace trigger remisiones_produccion_guarda_facturacion before update on public.remisiones_produccion
  for each row execute function public.remisiones_guarda_facturacion();

-- Marcar facturada: con el CFDI emitido del SAT (misma empresa) o con folio a
-- mano. Las tres funciones avisan al trigger de arriba que son ellas.
create or replace function public.fn_remision_facturar(p_origen text, p_id uuid, p_cfdi_id uuid default null, p_folio text default null, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_folio text; v_cfdi_folio text;
begin
  if not public.auth_factura_remisiones() then raise exception 'Sin permiso para facturar remisiones'; end if;
  if p_origen = 'almacen' then
    select empresa_id into v_empresa from public.remisiones_salida where id = p_id;
  elsif p_origen = 'planta' then
    select empresa_id into v_empresa from public.remisiones_produccion where id = p_id and tipo = 'salida';
  else
    raise exception 'Origen inválido: %', p_origen;
  end if;
  if v_empresa is null then raise exception 'Remisión no encontrada'; end if;
  if not (v_empresa = any (public.auth_empresas_alcance())) then raise exception 'La remisión está fuera de tu alcance'; end if;
  if p_cfdi_id is not null then
    select folio into v_cfdi_folio from public.cfdi where id = p_cfdi_id and empresa_id = v_empresa and tipo = 'emitido';
    if v_cfdi_folio is null then raise exception 'El CFDI no es un comprobante emitido de la misma empresa'; end if;
  end if;
  v_folio := nullif(btrim(coalesce(p_folio, '')), '');
  if p_cfdi_id is null and v_folio is null then raise exception 'Indica el CFDI o el folio de la factura'; end if;
  perform set_config('acumulado.remision_facturando', '1', true);
  if p_origen = 'almacen' then
    update public.remisiones_salida
       set factura_estado = 'facturada', facturada_en = now(), facturada_por = auth.uid(),
           cfdi_id = p_cfdi_id, factura_folio = coalesce(v_folio, v_cfdi_folio), factura_nota = nullif(btrim(coalesce(p_nota, '')), '')
     where id = p_id;
  else
    update public.remisiones_produccion
       set factura_estado = 'facturada', facturada_en = now(), facturada_por = auth.uid(),
           cfdi_id = p_cfdi_id, factura_folio = coalesce(v_folio, v_cfdi_folio), factura_nota = nullif(btrim(coalesce(p_nota, '')), '')
     where id = p_id;
  end if;
  perform set_config('acumulado.remision_facturando', '0', true);
end;
$$;

create or replace function public.fn_remision_sin_factura(p_origen text, p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  if not public.auth_factura_remisiones() then raise exception 'Sin permiso para facturar remisiones'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo'; end if;
  if p_origen = 'almacen' then
    select empresa_id into v_empresa from public.remisiones_salida where id = p_id;
  elsif p_origen = 'planta' then
    select empresa_id into v_empresa from public.remisiones_produccion where id = p_id and tipo = 'salida';
  else
    raise exception 'Origen inválido: %', p_origen;
  end if;
  if v_empresa is null then raise exception 'Remisión no encontrada'; end if;
  if not (v_empresa = any (public.auth_empresas_alcance())) then raise exception 'La remisión está fuera de tu alcance'; end if;
  perform set_config('acumulado.remision_facturando', '1', true);
  if p_origen = 'almacen' then
    update public.remisiones_salida set factura_estado = 'no_factura', facturada_en = now(), facturada_por = auth.uid(), cfdi_id = null, factura_folio = null, factura_nota = btrim(p_motivo) where id = p_id;
  else
    update public.remisiones_produccion set factura_estado = 'no_factura', facturada_en = now(), facturada_por = auth.uid(), cfdi_id = null, factura_folio = null, factura_nota = btrim(p_motivo) where id = p_id;
  end if;
  perform set_config('acumulado.remision_facturando', '0', true);
end;
$$;

create or replace function public.fn_remision_reabrir_factura(p_origen text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid;
begin
  if not public.auth_factura_remisiones() then raise exception 'Sin permiso para facturar remisiones'; end if;
  if p_origen = 'almacen' then
    select empresa_id into v_empresa from public.remisiones_salida where id = p_id;
  elsif p_origen = 'planta' then
    select empresa_id into v_empresa from public.remisiones_produccion where id = p_id and tipo = 'salida';
  else
    raise exception 'Origen inválido: %', p_origen;
  end if;
  if v_empresa is null then raise exception 'Remisión no encontrada'; end if;
  if not (v_empresa = any (public.auth_empresas_alcance())) then raise exception 'La remisión está fuera de tu alcance'; end if;
  perform set_config('acumulado.remision_facturando', '1', true);
  if p_origen = 'almacen' then
    update public.remisiones_salida set factura_estado = 'por_facturar', facturada_en = null, facturada_por = null, cfdi_id = null, factura_folio = null, factura_nota = null where id = p_id;
  else
    update public.remisiones_produccion set factura_estado = 'por_facturar', facturada_en = null, facturada_por = null, cfdi_id = null, factura_folio = null, factura_nota = null where id = p_id;
  end if;
  perform set_config('acumulado.remision_facturando', '0', true);
end;
$$;

-- Contabilidad de la organización (permiso por persona 'contabilidad') para el aviso.
create or replace function public.fn_contabilidad_de(p_grupo uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct p.id), '{}'::uuid[]) from public.profiles p
   join public.permisos_modulo pm on pm.profile_id = p.id and pm.modulo = 'contabilidad'
   where p.grupo_id = p_grupo and p.activo and not coalesce(p.espectador, false)
$$;
revoke all on function public.fn_contabilidad_de(uuid) from public, anon, authenticated;

-- Al confirmar la entrega de una remisión de salida, contabilidad recibe el
-- aviso para facturarla.
create or replace function public.remisiones_aviso_facturar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_grupo uuid; v_cliente text; v_empresa text;
begin
  if new.estatus <> 'entregada' or old.estatus = 'entregada' then return null; end if;
  if new.factura_estado <> 'por_facturar' then return null; end if;
  if tg_table_name = 'remisiones_produccion' and new.tipo <> 'salida' then return null; end if;
  select e.grupo_id, e.codigo into v_grupo, v_empresa from public.empresas e where e.id = new.empresa_id;
  if tg_table_name = 'remisiones_salida' then
    v_cliente := new.entregar_a;
  else
    v_cliente := coalesce(new.paga_nombre, new.contraparte);
  end if;
  perform public.fn_push_aviso(
    public.fn_contabilidad_de(v_grupo),
    'Remisión entregada, lista para facturar',
    concat_ws(' · ', new.folio, v_empresa, v_cliente),
    '/contabilidad/remisiones');
  return null;
end;
$$;
create or replace trigger remisiones_salida_aviso_facturar after update on public.remisiones_salida
  for each row execute function public.remisiones_aviso_facturar();
create or replace trigger remisiones_produccion_aviso_facturar after update on public.remisiones_produccion
  for each row execute function public.remisiones_aviso_facturar();
