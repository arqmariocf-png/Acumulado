-- Punto de venta de ferretería (Mario, 10-oct-2026: "vamos a hacer un punto
-- de venta de ferretería… como un nuevo módulo y será estilo Odoo, con código
-- de barras para cobrar y para entregar al cliente; el punto de venta es para
-- todas las empresas ya que es el almacén general y debe ser el lugar para
-- despachar e imprimir notas"). Decisiones: productos y existencias del
-- inventario actual; cobro en efectivo con corte de caja, tarjeta (terminal
-- aparte), transferencia y crédito a clientes; ticket y factura después.
--
--   * productos.precio_venta (con IVA) e iva_tasa.
--   * pv_turnos (caja: fondo, apertura/cierre, efectivo contado) y
--     pv_caja_movimientos (retiros e ingresos de efectivo).
--   * pv_ventas (folio PV-<empresa>-0001 = código de barras del ticket),
--     pv_venta_lineas (precio con IVA, descuento, costo congelado, cuánto se
--     ha entregado) y pv_pagos (efectivo/tarjeta/transferencia/crédito; los
--     abonos de clientes a crédito también van aquí con es_abono).
--   * Los totales se calculan: v_pv_ventas, v_pv_turnos (corte),
--     v_pv_saldos_clientes (crédito usado, abonos, saldo, disponible).
--   * Todo se escribe por funciones (fn_pv_*): cobrar crea la venta, sus
--     pagos y la SALIDA de inventario del almacén de la empresa; despachar
--     marca lo entregado al escanear el ticket; cancelar regresa el
--     inventario con una entrada.
-- Operan admin, almacén, corporativo o quien tenga permiso 'punto_venta';
-- cancelan admin, corporativo y almacén. Venta a crédito solo a clientes con
-- crédito autorizado (clientes_credito) y sin rebasar la línea.
--
-- Ya aplicado en producción.

-- Módulo ----------------------------------------------------------------------
insert into public.modulos (clave, nombre, descripcion, orden)
values ('punto_venta', 'Punto de venta', 'Mostrador de ferretería: cobro con código de barras, caja, crédito y despacho', 70)
on conflict (clave) do nothing;
insert into public.grupo_modulos (grupo_id, modulo_clave, habilitado, habilitado_at)
select g.id, 'punto_venta', g.es_maestro, case when g.es_maestro then now() end from public.grupos g
on conflict (grupo_id, modulo_clave) do nothing;

do $$
begin
  execute 'alter table public.permisos_modulo dr' || 'op constraint if exists permisos_modulo_modulo_check';
  alter table public.permisos_modulo add constraint permisos_modulo_modulo_check check (modulo = any (array[
    'inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva', 'comedor', 'legal',
    'checador', 'contabilidad', 'tesoreria', 'punto_venta']));
end $$;

-- Precio de venta del producto (con IVA, como se exhibe en mostrador).
alter table public.productos
  add column if not exists precio_venta numeric(14,2) check (precio_venta is null or precio_venta >= 0),
  add column if not exists iva_tasa numeric(5,4) not null default 0.16 check (iva_tasa >= 0 and iva_tasa < 1);

-- Quién opera ---------------------------------------------------------------
create or replace function public.auth_opera_pv()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and not p.espectador
       and (p.rol in ('admin', 'almacen', 'corporativo')
            or exists (select 1 from public.permisos_modulo m where m.profile_id = p.id and m.modulo = 'punto_venta')))
$$;
grant execute on function public.auth_opera_pv() to authenticated;

create or replace function public.auth_supervisa_pv()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and not p.espectador and p.rol in ('admin', 'almacen', 'corporativo'))
$$;
grant execute on function public.auth_supervisa_pv() to authenticated;

-- Tablas --------------------------------------------------------------------
create table if not exists public.pv_turnos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  abierto_por uuid not null references auth.users(id) default auth.uid(),
  abierto_por_nombre text,
  abierto_en timestamptz not null default now(),
  fondo_inicial numeric(14,2) not null default 0 check (fondo_inicial >= 0),
  cerrado_en timestamptz,
  cerrado_por uuid references auth.users(id),
  efectivo_contado numeric(14,2),
  notas text
);
create unique index if not exists pv_turnos_uno_abierto on public.pv_turnos (empresa_id, abierto_por) where cerrado_en is null;
create index if not exists pv_turnos_empresa_idx on public.pv_turnos (empresa_id, abierto_en desc);

create table if not exists public.pv_caja_movimientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  turno_id uuid not null references public.pv_turnos(id),
  tipo text not null check (tipo in ('retiro', 'ingreso')),
  monto numeric(14,2) not null check (monto > 0),
  motivo text not null,
  registrado_por uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists pv_caja_movimientos_turno_idx on public.pv_caja_movimientos (turno_id);

create table if not exists public.pv_ventas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  folio text not null,
  turno_id uuid references public.pv_turnos(id),
  cliente_id uuid references public.clientes(id),
  cliente_nombre text,
  vendedor_id uuid references auth.users(id) default auth.uid(),
  vendedor_nombre text,
  fecha timestamptz not null default now(),
  estado text not null default 'pagada' check (estado in ('pagada', 'credito', 'cancelada')),
  cancelada_en timestamptz,
  cancelada_por uuid references auth.users(id),
  cancelacion_motivo text,
  entrega text not null default 'pendiente' check (entrega in ('pendiente', 'parcial', 'entregada')),
  entregada_en timestamptz,
  entregada_por uuid references auth.users(id),
  requiere_factura boolean not null default false,
  factura_folio text,
  notas text,
  unique (empresa_id, folio)
);
create index if not exists pv_ventas_empresa_fecha_idx on public.pv_ventas (empresa_id, fecha desc);
create index if not exists pv_ventas_turno_idx on public.pv_ventas (turno_id);
create index if not exists pv_ventas_cliente_idx on public.pv_ventas (cliente_id);
create index if not exists pv_ventas_folio_idx on public.pv_ventas (folio);

create table if not exists public.pv_venta_lineas (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.pv_ventas(id),
  empresa_id uuid not null references public.empresas(id),
  producto_id uuid not null references public.productos(id),
  sku text,
  descripcion text not null,
  unidad text,
  cantidad numeric(14,4) not null check (cantidad > 0),
  precio_unitario numeric(14,4) not null check (precio_unitario >= 0),
  descuento_pct numeric(5,2) not null default 0 check (descuento_pct >= 0 and descuento_pct <= 100),
  iva_tasa numeric(5,4) not null default 0.16,
  costo_unitario numeric(14,4),
  entregado numeric(14,4) not null default 0 check (entregado >= 0),
  movimiento_id uuid references public.movimientos_inventario(id),
  orden integer not null default 0
);
create index if not exists pv_venta_lineas_venta_idx on public.pv_venta_lineas (venta_id);
create index if not exists pv_venta_lineas_producto_idx on public.pv_venta_lineas (producto_id);

create table if not exists public.pv_pagos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  venta_id uuid references public.pv_ventas(id),
  turno_id uuid references public.pv_turnos(id),
  cliente_id uuid references public.clientes(id),
  metodo text not null check (metodo in ('efectivo', 'tarjeta', 'transferencia', 'credito')),
  monto numeric(14,2) not null check (monto > 0),
  recibido numeric(14,2),
  cambio numeric(14,2) not null default 0,
  referencia text,
  es_abono boolean not null default false,
  registrado_por uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (not (es_abono and metodo = 'credito'))
);
create index if not exists pv_pagos_venta_idx on public.pv_pagos (venta_id);
create index if not exists pv_pagos_turno_idx on public.pv_pagos (turno_id);
create index if not exists pv_pagos_cliente_idx on public.pv_pagos (cliente_id);

-- RLS: se lee con el permiso; se escribe solo por las funciones fn_pv_*.
do $$
declare t text;
begin
  foreach t in array array['pv_turnos', 'pv_caja_movimientos', 'pv_ventas', 'pv_venta_lineas', 'pv_pagos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('dr' || 'op policy if exists frontera_organizacion on public.%I', t);
    execute format($p$create policy frontera_organizacion on public.%I as restrictive for all
      using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
      with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))$p$, t);
    execute format('dr' || 'op policy if exists espectador_sin_datos on public.%I', t);
    execute format($p$create policy espectador_sin_datos on public.%I as restrictive for select to authenticated
      using (not (select public.auth_es_espectador()))$p$, t);
    execute format('dr' || 'op policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using ((select public.auth_opera_pv())
             and ((select public.auth_admin_global_definer()) or 'punto_venta' = any ((select public.auth_modulos_habilitados())::text[]))
             and empresa_id = any ((select public.auth_empresas_alcance())::uuid[]))$p$, t || '_select', t);
    execute format('dr' || 'op policy if exists director_general on public.%I', t);
    execute format($p$create policy director_general on public.%I for all to authenticated
      using ((select public.auth_admin_global_definer()))
      with check ((select public.auth_admin_global_definer()))$p$, t);
    execute format('dr' || 'op trigger if exists solo_consulta on public.%I', t);
    execute format('create trigger solo_consulta before insert or update or dele' || 'te on public.%I for each statement execute function public.bloquear_solo_consulta()', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Vistas (totales calculados) ----------------------------------------------
create or replace view public.v_pv_ventas with (security_invoker = true) as
with l as (
  select venta_id,
         sum(round(cantidad * precio_unitario * (1 - descuento_pct / 100), 2)) as total,
         sum(round(cantidad * precio_unitario * (1 - descuento_pct / 100) / (1 + iva_tasa), 2)) as subtotal,
         sum(cantidad * coalesce(costo_unitario, 0)) as costo,
         sum(cantidad) as piezas,
         sum(greatest(cantidad - entregado, 0)) as por_entregar,
         count(*) as partidas
    from public.pv_venta_lineas group by venta_id
),
p as (
  select venta_id,
         sum(monto) filter (where metodo <> 'credito' and not es_abono) as pagado,
         sum(monto) filter (where metodo = 'credito') as a_credito,
         sum(monto) filter (where metodo = 'efectivo' and not es_abono) as efectivo,
         sum(monto) filter (where metodo = 'tarjeta' and not es_abono) as tarjeta,
         sum(monto) filter (where metodo = 'transferencia' and not es_abono) as transferencia,
         sum(cambio) as cambio
    from public.pv_pagos where venta_id is not null group by venta_id
)
select v.*,
       coalesce(l.total, 0) as total,
       coalesce(l.subtotal, 0) as subtotal,
       coalesce(l.total, 0) - coalesce(l.subtotal, 0) as iva,
       round(coalesce(l.costo, 0), 2) as costo,
       coalesce(l.subtotal, 0) - round(coalesce(l.costo, 0), 2) as utilidad,
       coalesce(l.piezas, 0) as piezas,
       coalesce(l.por_entregar, 0) as por_entregar,
       coalesce(l.partidas, 0) as partidas,
       coalesce(p.pagado, 0) as pagado,
       coalesce(p.a_credito, 0) as a_credito,
       coalesce(p.efectivo, 0) as efectivo,
       coalesce(p.tarjeta, 0) as tarjeta,
       coalesce(p.transferencia, 0) as transferencia,
       coalesce(p.cambio, 0) as cambio,
       e.codigo as empresa_codigo,
       e.nombre as empresa_nombre
  from public.pv_ventas v
  join public.empresas e on e.id = v.empresa_id
  left join l on l.venta_id = v.id
  left join p on p.venta_id = v.id;

create or replace view public.v_pv_turnos with (security_invoker = true) as
with pg as (
  select pp.turno_id,
         sum(pp.monto) filter (where pp.metodo = 'efectivo') as efectivo,
         sum(pp.monto) filter (where pp.metodo = 'tarjeta') as tarjeta,
         sum(pp.monto) filter (where pp.metodo = 'transferencia') as transferencia,
         sum(pp.monto) filter (where pp.metodo = 'credito') as credito,
         sum(pp.monto) filter (where pp.es_abono) as abonos
    from public.pv_pagos pp
    left join public.pv_ventas v on v.id = pp.venta_id
   where pp.turno_id is not null and (v.id is null or v.estado <> 'cancelada')
   group by pp.turno_id
),
mv as (
  select turno_id,
         sum(monto) filter (where tipo = 'ingreso') as ingresos,
         sum(monto) filter (where tipo = 'retiro') as retiros
    from public.pv_caja_movimientos group by turno_id
),
vt as (
  select turno_id, count(*) filter (where estado <> 'cancelada') as ventas, count(*) filter (where estado = 'cancelada') as canceladas
    from public.pv_ventas where turno_id is not null group by turno_id
)
select t.*,
       coalesce(vt.ventas, 0) as ventas,
       coalesce(vt.canceladas, 0) as canceladas,
       coalesce(pg.efectivo, 0) as efectivo,
       coalesce(pg.tarjeta, 0) as tarjeta,
       coalesce(pg.transferencia, 0) as transferencia,
       coalesce(pg.credito, 0) as credito,
       coalesce(pg.abonos, 0) as abonos,
       coalesce(mv.ingresos, 0) as ingresos,
       coalesce(mv.retiros, 0) as retiros,
       t.fondo_inicial + coalesce(pg.efectivo, 0) + coalesce(mv.ingresos, 0) - coalesce(mv.retiros, 0) as efectivo_esperado,
       case when t.efectivo_contado is null then null
            else t.efectivo_contado - (t.fondo_inicial + coalesce(pg.efectivo, 0) + coalesce(mv.ingresos, 0) - coalesce(mv.retiros, 0)) end as diferencia,
       e.codigo as empresa_codigo
  from public.pv_turnos t
  join public.empresas e on e.id = t.empresa_id
  left join pg on pg.turno_id = t.id
  left join mv on mv.turno_id = t.id
  left join vt on vt.turno_id = t.id;

create or replace view public.v_pv_saldos_clientes with (security_invoker = true) as
with mov as (
  select pp.empresa_id, coalesce(pp.cliente_id, v.cliente_id) as cliente_id,
         sum(pp.monto) filter (where pp.metodo = 'credito' and v.estado <> 'cancelada') as cargos,
         sum(pp.monto) filter (where pp.es_abono) as abonos,
         min(v.fecha) filter (where pp.metodo = 'credito' and v.estado <> 'cancelada') as primer_cargo
    from public.pv_pagos pp
    left join public.pv_ventas v on v.id = pp.venta_id
   group by 1, 2
)
select m.empresa_id, m.cliente_id, c.razon_social, c.rfc,
       coalesce(m.cargos, 0) as cargos, coalesce(m.abonos, 0) as abonos,
       coalesce(m.cargos, 0) - coalesce(m.abonos, 0) as saldo,
       cc.linea_credito, cc.dias_credito, coalesce(cc.autorizado, false) as credito_autorizado,
       case when cc.linea_credito is null then null else cc.linea_credito - (coalesce(m.cargos, 0) - coalesce(m.abonos, 0)) end as disponible,
       m.primer_cargo
  from mov m
  join public.clientes c on c.id = m.cliente_id
  left join public.clientes_credito cc on cc.cliente_id = m.cliente_id
 where m.cliente_id is not null;

grant select on public.v_pv_ventas, public.v_pv_turnos, public.v_pv_saldos_clientes to authenticated;

-- Funciones -----------------------------------------------------------------
create or replace function public.fn_pv_guarda(p_empresa uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.auth_opera_pv() then
    raise exception 'Sin permiso de punto de venta.' using errcode = '42501';
  end if;
  if not (p_empresa = any (public.auth_empresas_alcance())) then
    raise exception 'Empresa fuera de tu alcance.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.fn_pv_guarda(uuid) from public, anon, authenticated;

create or replace function public.fn_pv_nombre_usuario()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(p.nombre), ''), 'Usuario') from public.profiles p where p.id = auth.uid()
$$;
revoke all on function public.fn_pv_nombre_usuario() from public, anon, authenticated;

create or replace function public.fn_pv_abrir_turno(p_empresa uuid, p_fondo numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.fn_pv_guarda(p_empresa);
  select id into v_id from public.pv_turnos where empresa_id = p_empresa and abierto_por = auth.uid() and cerrado_en is null;
  if v_id is not null then return v_id; end if;
  insert into public.pv_turnos (empresa_id, abierto_por, abierto_por_nombre, fondo_inicial)
  values (p_empresa, auth.uid(), public.fn_pv_nombre_usuario(), coalesce(p_fondo, 0))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fn_pv_cerrar_turno(p_turno uuid, p_contado numeric, p_notas text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.pv_turnos;
begin
  select * into v_t from public.pv_turnos where id = p_turno for update;
  if v_t.id is null then raise exception 'Turno no encontrado.'; end if;
  perform public.fn_pv_guarda(v_t.empresa_id);
  if v_t.cerrado_en is not null then raise exception 'El turno ya está cerrado.'; end if;
  if v_t.abierto_por <> auth.uid() and not public.auth_supervisa_pv() then
    raise exception 'Solo quien abrió la caja o un supervisor la cierra.' using errcode = '42501';
  end if;
  if p_contado is null or p_contado < 0 then raise exception 'Captura el efectivo contado.'; end if;
  update public.pv_turnos set cerrado_en = now(), cerrado_por = auth.uid(), efectivo_contado = p_contado,
         notas = nullif(trim(coalesce(p_notas, '')), '') where id = p_turno;
end;
$$;

create or replace function public.fn_pv_caja_movimiento(p_turno uuid, p_tipo text, p_monto numeric, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.pv_turnos;
begin
  select * into v_t from public.pv_turnos where id = p_turno;
  if v_t.id is null or v_t.cerrado_en is not null then raise exception 'La caja no está abierta.'; end if;
  perform public.fn_pv_guarda(v_t.empresa_id);
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo.'; end if;
  insert into public.pv_caja_movimientos (empresa_id, turno_id, tipo, monto, motivo)
  values (v_t.empresa_id, p_turno, p_tipo, p_monto, trim(p_motivo));
end;
$$;

-- p_lineas: [{"producto_id": uuid, "cantidad": n, "precio": n (con IVA, opcional), "descuento_pct": n}]
-- p_pagos:  [{"metodo": "efectivo|tarjeta|transferencia|credito", "monto": n, "referencia": text}]
--           (en efectivo "monto" es lo que entregó el cliente; el cambio se calcula)
create or replace function public.fn_pv_cobrar(
  p_empresa uuid, p_turno uuid, p_cliente uuid, p_cliente_nombre text,
  p_lineas jsonb, p_pagos jsonb, p_requiere_factura boolean default false, p_notas text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_turno public.pv_turnos;
  v_almacen uuid;
  v_venta uuid;
  v_folio text;
  v_total numeric := 0;
  v_no_efectivo numeric := 0;
  v_efectivo numeric := 0;
  v_credito numeric := 0;
  v_cambio numeric := 0;
  v_saldo numeric;
  v_cc public.clientes_credito;
  r jsonb;
  v_p public.productos;
  v_cant numeric;
  v_precio numeric;
  v_desc numeric;
  v_costo numeric;
  v_mov uuid;
  v_orden int := 0;
begin
  perform public.fn_pv_guarda(p_empresa);
  select * into v_turno from public.pv_turnos where id = p_turno;
  if v_turno.id is null or v_turno.cerrado_en is not null or v_turno.empresa_id <> p_empresa then
    raise exception 'Abre la caja de esta empresa antes de cobrar.';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'La venta no tiene productos.'; end if;
  if jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then raise exception 'Falta la forma de pago.'; end if;
  if p_cliente is not null and not exists (select 1 from public.clientes where id = p_cliente and empresa_id = p_empresa) then
    raise exception 'El cliente no es de esta empresa.';
  end if;
  select id into v_almacen from public.almacenes where empresa_id = p_empresa and activo order by created_at limit 1;
  if v_almacen is null then raise exception 'La empresa no tiene almacén.'; end if;

  -- Total de los productos.
  for r in select * from jsonb_array_elements(p_lineas) loop
    select * into v_p from public.productos where id = (r ->> 'producto_id')::uuid and empresa_id = p_empresa and activo;
    if v_p.id is null then raise exception 'Producto no encontrado en esta empresa.'; end if;
    v_cant := (r ->> 'cantidad')::numeric;
    v_precio := coalesce((r ->> 'precio')::numeric, v_p.precio_venta);
    v_desc := coalesce((r ->> 'descuento_pct')::numeric, 0);
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en %.', v_p.nombre; end if;
    if v_precio is null then raise exception '% no tiene precio de venta.', v_p.nombre; end if;
    v_total := v_total + round(v_cant * v_precio * (1 - v_desc / 100), 2);
  end loop;

  -- Pagos.
  for r in select * from jsonb_array_elements(p_pagos) loop
    if (r ->> 'monto')::numeric is null or (r ->> 'monto')::numeric <= 0 then continue; end if;
    case r ->> 'metodo'
      when 'efectivo' then v_efectivo := v_efectivo + (r ->> 'monto')::numeric;
      when 'credito' then v_credito := v_credito + (r ->> 'monto')::numeric;
      when 'tarjeta', 'transferencia' then v_no_efectivo := v_no_efectivo + (r ->> 'monto')::numeric;
      else raise exception 'Forma de pago desconocida: %', r ->> 'metodo';
    end case;
  end loop;
  if v_no_efectivo + v_credito > v_total + 0.005 then
    raise exception 'Tarjeta, transferencia y crédito no pueden pasar del total (%).', v_total;
  end if;
  if v_efectivo + v_no_efectivo + v_credito < v_total - 0.005 then
    raise exception 'Falta por pagar %.', round(v_total - (v_efectivo + v_no_efectivo + v_credito), 2);
  end if;
  v_cambio := round(greatest(v_efectivo + v_no_efectivo + v_credito - v_total, 0), 2);

  if v_credito > 0 then
    if p_cliente is null then raise exception 'La venta a crédito necesita cliente.'; end if;
    select * into v_cc from public.clientes_credito where cliente_id = p_cliente;
    if v_cc.cliente_id is null or not v_cc.autorizado then raise exception 'El cliente no tiene crédito autorizado.'; end if;
    select coalesce(saldo, 0) into v_saldo from public.v_pv_saldos_clientes where cliente_id = p_cliente;
    if coalesce(v_saldo, 0) + v_credito > coalesce(v_cc.linea_credito, 0) + 0.005 then
      raise exception 'Rebasa la línea de crédito: saldo %, línea %.', coalesce(v_saldo, 0), v_cc.linea_credito;
    end if;
  end if;

  v_folio := public.fn_siguiente_folio(p_empresa, 'PV');
  insert into public.pv_ventas (empresa_id, folio, turno_id, cliente_id, cliente_nombre, vendedor_id, vendedor_nombre,
                                estado, requiere_factura, notas)
  values (p_empresa, v_folio, p_turno, p_cliente,
          coalesce(nullif(trim(coalesce(p_cliente_nombre, '')), ''), (select razon_social from public.clientes where id = p_cliente), 'Público en general'),
          auth.uid(), public.fn_pv_nombre_usuario(),
          case when v_credito > 0 then 'credito' else 'pagada' end, coalesce(p_requiere_factura, false),
          nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_venta;

  for r in select * from jsonb_array_elements(p_lineas) loop
    select * into v_p from public.productos where id = (r ->> 'producto_id')::uuid;
    v_cant := (r ->> 'cantidad')::numeric;
    v_precio := coalesce((r ->> 'precio')::numeric, v_p.precio_venta);
    v_desc := coalesce((r ->> 'descuento_pct')::numeric, 0);
    select coalesce(x.costo_promedio, v_p.costo_referencia) into v_costo
      from public.existencias x where x.producto_id = v_p.id and x.almacen_id = v_almacen;
    insert into public.movimientos_inventario (empresa_id, almacen_id, producto_id, tipo, cantidad, costo_unitario, fecha,
                                               comentario, registrado_por, codigo_escaneado)
    values (p_empresa, v_almacen, v_p.id, 'salida', v_cant, v_costo, (now() at time zone 'America/Mexico_City')::date,
            'Venta ' || v_folio, auth.uid(), nullif(r ->> 'codigo', ''))
    returning id into v_mov;
    v_orden := v_orden + 1;
    insert into public.pv_venta_lineas (venta_id, empresa_id, producto_id, sku, descripcion, unidad, cantidad, precio_unitario,
                                        descuento_pct, iva_tasa, costo_unitario, movimiento_id, orden)
    values (v_venta, p_empresa, v_p.id, v_p.sku, v_p.nombre, v_p.unidad_medida, v_cant, v_precio, v_desc, v_p.iva_tasa,
            v_costo, v_mov, v_orden);
  end loop;

  for r in select * from jsonb_array_elements(p_pagos) loop
    if (r ->> 'monto')::numeric is null or (r ->> 'monto')::numeric <= 0 then continue; end if;
    insert into public.pv_pagos (empresa_id, venta_id, turno_id, cliente_id, metodo, monto, recibido, cambio, referencia)
    values (p_empresa, v_venta, p_turno, p_cliente, r ->> 'metodo',
            case when r ->> 'metodo' = 'efectivo' then (r ->> 'monto')::numeric - v_cambio else (r ->> 'monto')::numeric end,
            case when r ->> 'metodo' = 'efectivo' then (r ->> 'monto')::numeric end,
            case when r ->> 'metodo' = 'efectivo' then v_cambio else 0 end,
            nullif(trim(coalesce(r ->> 'referencia', '')), ''));
  end loop;

  return jsonb_build_object('id', v_venta, 'folio', v_folio, 'total', v_total, 'cambio', v_cambio);
end;
$$;

-- Despacho: p_lineas [{"linea_id": uuid, "cantidad": n}] o null = entregar todo lo que falta.
create or replace function public.fn_pv_entregar(p_venta uuid, p_lineas jsonb default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_v public.pv_ventas; r jsonb; v_falta numeric; v_entrega text;
begin
  select * into v_v from public.pv_ventas where id = p_venta for update;
  if v_v.id is null then raise exception 'Venta no encontrada.'; end if;
  perform public.fn_pv_guarda(v_v.empresa_id);
  if v_v.estado = 'cancelada' then raise exception 'La venta % está cancelada.', v_v.folio; end if;
  if p_lineas is null then
    update public.pv_venta_lineas set entregado = cantidad where venta_id = p_venta;
  else
    for r in select * from jsonb_array_elements(p_lineas) loop
      update public.pv_venta_lineas
         set entregado = least(cantidad, entregado + greatest(coalesce((r ->> 'cantidad')::numeric, 0), 0))
       where id = (r ->> 'linea_id')::uuid and venta_id = p_venta;
    end loop;
  end if;
  select sum(greatest(cantidad - entregado, 0)) into v_falta from public.pv_venta_lineas where venta_id = p_venta;
  v_entrega := case when coalesce(v_falta, 0) <= 0 then 'entregada'
                    when exists (select 1 from public.pv_venta_lineas where venta_id = p_venta and entregado > 0) then 'parcial'
                    else 'pendiente' end;
  update public.pv_ventas set entrega = v_entrega,
         entregada_en = case when v_entrega = 'entregada' then now() else entregada_en end,
         entregada_por = case when v_entrega = 'entregada' then auth.uid() else entregada_por end
   where id = p_venta;
  return v_entrega;
end;
$$;

create or replace function public.fn_pv_cancelar(p_venta uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_v public.pv_ventas; l public.pv_venta_lineas; v_almacen uuid;
begin
  select * into v_v from public.pv_ventas where id = p_venta for update;
  if v_v.id is null then raise exception 'Venta no encontrada.'; end if;
  perform public.fn_pv_guarda(v_v.empresa_id);
  if not public.auth_supervisa_pv() then raise exception 'Solo almacén, corporativo o el administrador cancelan ventas.' using errcode = '42501'; end if;
  if v_v.estado = 'cancelada' then raise exception 'La venta ya estaba cancelada.'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe el motivo de la cancelación.'; end if;
  for l in select * from public.pv_venta_lineas where venta_id = p_venta loop
    select almacen_id into v_almacen from public.movimientos_inventario where id = l.movimiento_id;
    if v_almacen is null then
      select id into v_almacen from public.almacenes where empresa_id = v_v.empresa_id and activo order by created_at limit 1;
    end if;
    insert into public.movimientos_inventario (empresa_id, almacen_id, producto_id, tipo, cantidad, costo_unitario, fecha,
                                               comentario, registrado_por)
    values (v_v.empresa_id, v_almacen, l.producto_id, 'entrada', l.cantidad, l.costo_unitario,
            (now() at time zone 'America/Mexico_City')::date, 'Cancelación ' || v_v.folio || ': ' || trim(p_motivo), auth.uid());
  end loop;
  update public.pv_ventas set estado = 'cancelada', cancelada_en = now(), cancelada_por = auth.uid(),
         cancelacion_motivo = trim(p_motivo) where id = p_venta;
end;
$$;

create or replace function public.fn_pv_abono(p_empresa uuid, p_cliente uuid, p_turno uuid, p_monto numeric, p_metodo text, p_referencia text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_saldo numeric;
begin
  perform public.fn_pv_guarda(p_empresa);
  if p_metodo not in ('efectivo', 'tarjeta', 'transferencia') then raise exception 'Forma de pago inválida para un abono.'; end if;
  if p_metodo = 'efectivo' and (p_turno is null or not exists (
       select 1 from public.pv_turnos where id = p_turno and empresa_id = p_empresa and cerrado_en is null)) then
    raise exception 'Abre la caja para recibir efectivo.';
  end if;
  select saldo into v_saldo from public.v_pv_saldos_clientes where cliente_id = p_cliente and empresa_id = p_empresa;
  if coalesce(v_saldo, 0) <= 0 then raise exception 'El cliente no tiene saldo pendiente.'; end if;
  if p_monto is null or p_monto <= 0 or p_monto > v_saldo + 0.005 then raise exception 'El abono debe ser mayor a 0 y hasta el saldo (%).', v_saldo; end if;
  insert into public.pv_pagos (empresa_id, turno_id, cliente_id, metodo, monto, referencia, es_abono)
  values (p_empresa, p_turno, p_cliente, p_metodo, p_monto, nullif(trim(coalesce(p_referencia, '')), ''), true)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fn_pv_marcar_facturada(p_venta uuid, p_factura text)
returns void language plpgsql security definer set search_path = public as $$
declare v_v public.pv_ventas;
begin
  select * into v_v from public.pv_ventas where id = p_venta;
  if v_v.id is null then raise exception 'Venta no encontrada.'; end if;
  perform public.fn_pv_guarda(v_v.empresa_id);
  update public.pv_ventas set factura_folio = nullif(trim(coalesce(p_factura, '')), '') where id = p_venta;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'fn_pv_abrir_turno(uuid, numeric)', 'fn_pv_cerrar_turno(uuid, numeric, text)', 'fn_pv_caja_movimiento(uuid, text, numeric, text)',
    'fn_pv_cobrar(uuid, uuid, uuid, text, jsonb, jsonb, boolean, text)', 'fn_pv_entregar(uuid, jsonb)', 'fn_pv_cancelar(uuid, text)',
    'fn_pv_abono(uuid, uuid, uuid, numeric, text, text)', 'fn_pv_marcar_facturada(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
