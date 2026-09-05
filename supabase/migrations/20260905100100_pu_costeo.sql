-- Motor de costeo de Precios Unitarios. Todo lo que sigue es derivado: no
-- hay una sola columna de dinero que se escriba aquí, se recalcula al
-- consultar. Es lo que hace que cotizar un material vuelva a costear solos
-- todos los análisis en borrador que lo usan.
--
-- Ninguna función es SECURITY DEFINER y todas las vistas van con
-- security_invoker: el costeo corre con los permisos de quien pregunta, así
-- que RLS decide qué análisis existen para cada quien y una vista no puede
-- filtrar por accidente el costo de una obra ajena.

-- ── Precio vigente de un insumo ──────────────────────────────────────────
-- Gana el precio propio de la empresa sobre el de grupo, y dentro de cada
-- uno el más reciente ya vigente. Devuelve la fila completa (no sólo el
-- costo) para que el catálogo pueda mostrar de cuándo es la cotización sin
-- repetir esta lógica y arriesgarse a que discrepe del costeo.
create or replace function public.pu_precio_vigente(
  p_insumo_id uuid,
  p_empresa_id uuid default null
)
returns public.pu_insumo_precios
language sql
stable
set search_path = public
as $$
  select p.*
  from public.pu_insumo_precios p
  where p.insumo_id = p_insumo_id
    and (p.empresa_id is null or p.empresa_id = p_empresa_id)
    and p.vigente_desde <= now()
  order by (p.empresa_id is not null) desc, p.vigente_desde desc, p.created_at desc
  limit 1
$$;

-- NULL = nunca se ha cotizado. El costeo lo cuenta como cero pero lo reporta
-- aparte (insumos_sin_precio) en vez de esconderlo: un PU armado sobre
-- insumos sin cotizar sale barato y mentiroso.
create or replace function public.pu_costo_insumo(
  p_insumo_id uuid,
  p_empresa_id uuid default null
)
returns numeric
language sql
stable
set search_path = public
as $$
  select (public.pu_precio_vigente(p_insumo_id, p_empresa_id)).costo
$$;

-- ── Explosión de un análisis ─────────────────────────────────────────────
-- Devuelve los renglones ya costeados. Es recursiva a través de
-- pu_costo_directo: un renglón que es un básico vale el costo directo de ese
-- básico, que a su vez se explota igual.
--
-- Los importes se redondean a dos decimales AQUÍ y el costo directo es la
-- suma de esos importes redondeados -- así el subtotal que suma la pantalla
-- renglón por renglón cuadra al centavo con el costo directo de la tarjeta,
-- que es lo que se imprime y se firma.
create or replace function public.pu_renglones_costeados(
  p_analisis_id uuid,
  p_profundidad integer default 0
)
returns table (
  item_id uuid,
  analisis_id uuid,
  orden integer,
  base_calculo public.pu_base_calculo,
  codigo text,
  descripcion text,
  unidad text,
  tipo public.pu_tipo_insumo,
  cantidad numeric,
  rendimiento numeric,
  aportacion numeric,
  costo_unitario numeric,
  importe numeric,
  costo_cerrado boolean,
  sin_precio boolean,
  proveedor text,
  precio_autorizado_en timestamptz
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_empresa uuid;
begin
  if p_profundidad > 10 then
    raise exception 'Los análisis básicos se están anidando demasiado (posible ciclo) en %', p_analisis_id;
  end if;

  -- Si el análisis no existe, o RLS no se lo muestra a quien pregunta, no
  -- hay renglones que costear -- y no se distingue un caso del otro.
  select a.empresa_id into v_empresa from public.pu_analisis a where a.id = p_analisis_id;
  if v_empresa is null then
    return;
  end if;

  return query
  with base as (
    select
      it.id,
      it.orden,
      it.base_calculo,
      coalesce(ins.codigo, hijo.codigo) as codigo,
      coalesce(ins.descripcion, hijo.concepto) as descripcion,
      coalesce(ins.unidad, hijo.unidad) as unidad,
      case
        when it.analisis_hijo_id is not null then 'auxiliar'::public.pu_tipo_insumo
        else ins.tipo
      end as tipo,
      it.cantidad,
      it.rendimiento,
      -- En 'pct_mano_obra' la cantidad ya ES la fracción (3% se guarda como
      -- 0.03), por eso no se divide entre el rendimiento.
      case
        when it.base_calculo = 'pct_mano_obra' then it.cantidad
        else it.cantidad / it.rendimiento
      end as aportacion,
      case
        when it.analisis_hijo_id is not null
          then public.pu_costo_directo(it.analisis_hijo_id, p_profundidad + 1)
        when it.costo_congelado is not null then it.costo_congelado
        else public.pu_costo_insumo(it.insumo_id, v_empresa)
      end as costo_bruto,
      it.costo_congelado is not null as costo_cerrado,
      it.proveedor,
      it.precio_autorizado_en
    from public.pu_analisis_items it
    left join public.pu_insumos ins on ins.id = it.insumo_id
    left join public.pu_analisis hijo on hijo.id = it.analisis_hijo_id
    where it.analisis_id = p_analisis_id
  ),
  -- La herramienta menor se cobra como porcentaje de la mano de obra DE ESTE
  -- análisis: la que trae un básico ya se cobró dentro del básico.
  mano_obra as (
    select coalesce(sum(round(coalesce(b.costo_bruto, 0) * b.aportacion, 2)), 0) as total
    from base b
    where b.tipo = 'mano_obra' and b.base_calculo = 'cantidad'
  )
  select
    b.id,
    p_analisis_id,
    b.orden,
    b.base_calculo,
    b.codigo,
    b.descripcion,
    b.unidad,
    b.tipo,
    b.cantidad,
    b.rendimiento,
    b.aportacion,
    case when b.base_calculo = 'pct_mano_obra' then mo.total else coalesce(b.costo_bruto, 0) end,
    round(
      case when b.base_calculo = 'pct_mano_obra' then mo.total else coalesce(b.costo_bruto, 0) end * b.aportacion,
      2
    ),
    b.costo_cerrado,
    -- Un básico vacío o un porcentaje no cuentan como "sin cotizar": el
    -- aviso es para el insumo que nadie ha puesto en el catálogo.
    b.base_calculo = 'cantidad' and b.tipo <> 'auxiliar' and b.costo_bruto is null,
    b.proveedor,
    b.precio_autorizado_en
  from base b
  cross join mano_obra mo
  order by b.orden, b.codigo;
end;
$$;

create or replace function public.pu_costo_directo(
  p_analisis_id uuid,
  p_profundidad integer default 0
)
returns numeric
language plpgsql
stable
set search_path = public
as $$
declare
  v_total numeric;
begin
  select coalesce(sum(r.importe), 0)
    into v_total
    from public.pu_renglones_costeados(p_analisis_id, p_profundidad) r;
  return coalesce(v_total, 0);
end;
$$;

-- ── Vistas que consume el frontend ───────────────────────────────────────

-- El costo que le aplica a quien consulta, con la MISMA función que usa el
-- motor de costeo -- así el catálogo y el precio unitario no pueden
-- discrepar. Un usuario sin empresa (corporativo/admin/dirección) ve el
-- precio de grupo, que es como se captura hoy.
create view public.v_pu_insumos_vigentes with (security_invoker = true) as
select
  i.id,
  i.codigo,
  i.descripcion,
  i.unidad,
  i.tipo,
  i.activo,
  (v.precio).costo as costo_vigente,
  (v.precio).vigente_desde as cotizado_el,
  (v.precio).fuente as fuente_costo
from public.pu_insumos i
cross join lateral (
  select public.pu_precio_vigente(i.id, public.auth_empresa_id()) as precio
) v;

-- analisis_id sale de pu_analisis.id (y no de la función) a propósito: así un
-- filtro `analisis_id = ...` del frontend baja al índice de la tabla en vez
-- de costear los 200 análisis para tirar 199.
create view public.v_pu_analisis_detalle with (security_invoker = true) as
select
  r.item_id,
  a.id as analisis_id,
  r.orden,
  r.base_calculo,
  r.codigo,
  r.descripcion,
  r.unidad,
  r.tipo,
  r.cantidad,
  r.rendimiento,
  r.aportacion,
  r.costo_unitario,
  r.importe,
  r.costo_cerrado,
  r.sin_precio,
  r.proveedor,
  r.precio_autorizado_en
from public.pu_analisis a
cross join lateral public.pu_renglones_costeados(a.id, 0) r;

-- La tarjeta con su precio ya calculado.
--
-- El sobrecosto va en cascada (cada porcentaje sobre el subtotal acumulado,
-- no sobre el costo directo), que es el orden de la Ley de Obras Públicas:
--   PU = ((((CD + indirectos) + financiamiento) + utilidad) + cargos)
--
-- Sin factor asignado los cuatro porcentajes son cero y el precio unitario
-- es el costo directo pelón -- el frontend lo avisa en la tarjeta, para que
-- nadie confunda un PU sin factor con un precio de venta.
--
-- Un básico nunca lleva sobrecosto: se consume dentro de otro análisis a
-- costo directo, y el sobrecosto se cobra una sola vez en el concepto que sí
-- se vende.
create view public.v_pu_analisis_costeo with (security_invoker = true) as
select
  a.id as analisis_id,
  a.empresa_id,
  e.codigo as empresa_codigo,
  e.nombre as empresa_nombre,
  a.proyecto_id,
  pr.nombre as proyecto_nombre,
  a.codigo,
  a.concepto,
  a.unidad,
  a.es_auxiliar,
  a.estado,
  a.creado_por,
  autor.nombre as creado_por_nombre,
  f.nombre as factor_nombre,
  pct.indirectos_pct,
  pct.financiamiento_pct,
  pct.utilidad_pct,
  pct.cargos_adicionales_pct,
  c.costo_directo,
  c.importe_material,
  c.importe_mano_obra,
  c.importe_equipo,
  c.importe_basicos,
  m.indirectos as importe_indirectos,
  m.financiamiento as importe_financiamiento,
  m.utilidad as importe_utilidad,
  m.cargos as importe_cargos_adicionales,
  -- El precio es la suma de los renglones YA redondeados, no el redondeo de
  -- la suma: la tarjeta impresa tiene que cuadrar cuando alguien la sume a
  -- mano, que es exactamente lo que hace quien la revisa.
  c.costo_directo + m.indirectos + m.financiamiento + m.utilidad + m.cargos as precio_unitario,
  c.insumos_sin_precio,
  a.updated_at
from public.pu_analisis a
join public.empresas e on e.id = a.empresa_id
left join public.proyectos pr on pr.id = a.proyecto_id
left join public.profiles autor on autor.id = a.creado_por
left join public.pu_factores f on f.id = a.factor_id
cross join lateral (
  select
    coalesce(sum(r.importe), 0) as costo_directo,
    coalesce(sum(r.importe) filter (where r.tipo = 'material'), 0) as importe_material,
    coalesce(sum(r.importe) filter (where r.tipo = 'mano_obra'), 0) as importe_mano_obra,
    coalesce(sum(r.importe) filter (where r.tipo in ('herramienta', 'equipo')), 0) as importe_equipo,
    coalesce(sum(r.importe) filter (where r.tipo = 'auxiliar'), 0) as importe_basicos,
    count(*) filter (where r.sin_precio) as insumos_sin_precio
  from public.pu_renglones_costeados(a.id, 0) r
) c
cross join lateral (
  select
    case when a.es_auxiliar then 0 else coalesce(f.indirectos_pct, 0) end as indirectos_pct,
    case when a.es_auxiliar then 0 else coalesce(f.financiamiento_pct, 0) end as financiamiento_pct,
    case when a.es_auxiliar then 0 else coalesce(f.utilidad_pct, 0) end as utilidad_pct,
    case when a.es_auxiliar then 0 else coalesce(f.cargos_adicionales_pct, 0) end as cargos_adicionales_pct
) pct
-- La cascada desarrollada: cada porcentaje se aplica sobre el subtotal que
-- ya trae los anteriores, de ahí los productos encadenados.
cross join lateral (
  select
    round(c.costo_directo * pct.indirectos_pct, 2) as indirectos,
    round(c.costo_directo * (1 + pct.indirectos_pct) * pct.financiamiento_pct, 2) as financiamiento,
    round(
      c.costo_directo * (1 + pct.indirectos_pct) * (1 + pct.financiamiento_pct) * pct.utilidad_pct,
      2
    ) as utilidad,
    round(
      c.costo_directo
        * (1 + pct.indirectos_pct)
        * (1 + pct.financiamiento_pct)
        * (1 + pct.utilidad_pct)
        * pct.cargos_adicionales_pct,
      2
    ) as cargos
) m;

-- El consultable: lo único que cuenta como precio bueno. Filtra por etapa,
-- no por permisos -- RLS ya limitó las filas a las obras de cada quien.
create view public.v_pu_publicados with (security_invoker = true) as
select * from public.v_pu_analisis_costeo where estado = 'publicado';
