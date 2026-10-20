-- Venta inter empresa desde una OC/OS (21-oct-2026, Mario: "en el catálogo de
-- OC y OS genera un botón que copie la información de ese folio como base y
-- se dirija como una nueva indicación con una comisión o un criterio de venta
-- inter empresa. Ej.: Aceros compra a proveedor material y esto se lo vende a
-- Mario, sin embargo Mario también necesita comprárselo a Aceros. Es un triple
-- movimiento con la misma información o con muy pequeña variación").
--
-- 1) La OC/OS original (empresa A ← proveedor) ya existe.
-- 2) OV de la empresa A a la empresa B (cliente = razón social de B).
-- 3) OC/OS de la empresa B a la empresa A (proveedor = razón social de A).
-- 2 y 3 llevan las mismas partidas al precio de venta (costo + comisión, que
-- la pantalla calcula y deja corregir por partida) y se crean juntas, en una
-- sola transacción, con fn_orden_ia_guardar (sus guardas aplican: quien
-- captura órdenes y con las dos empresas en su alcance). Las dos quedan
-- ligadas a la OC original en `interempresa_origen_id`.
-- Ya aplicado en producción (orden_interempresa).

alter table public.ordenes_compra add column if not exists interempresa_origen_id uuid references public.ordenes_compra (id) on delete set null;
alter table public.ordenes_venta add column if not exists interempresa_origen_id uuid references public.ordenes_compra (id) on delete set null;
create index if not exists ordenes_compra_interempresa_idx on public.ordenes_compra (interempresa_origen_id) where interempresa_origen_id is not null;
create index if not exists ordenes_venta_interempresa_idx on public.ordenes_venta (interempresa_origen_id) where interempresa_origen_id is not null;

create or replace function public.fn_orden_interempresa(
  p_origen uuid,
  p_empresa_compradora uuid,
  p_lineas jsonb,
  p_comision numeric default null,
  p_proyecto text default null,
  p_forma_pago text default null,
  p_condicion text default null,
  p_notas text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_oc public.ordenes_compra;
  v_vende public.empresas;
  v_compra public.empresas;
  v_nota text;
  v_ov jsonb;
  v_oc2 jsonb;
begin
  if not public.auth_captura_ordenes() then
    raise exception 'Sin permiso para capturar órdenes (compras, almacén o dirección).' using errcode = '42501';
  end if;
  select * into v_oc from public.ordenes_compra where id = p_origen;
  if v_oc.id is null or not (v_oc.empresa_id = any (public.auth_empresas_alcance())) then
    raise exception 'No encuentro la orden de origen o no es de una empresa que manejes.' using errcode = '42501';
  end if;
  if v_oc.rechazada_en is not null then
    raise exception 'La orden % está cancelada o rechazada.', v_oc.id_orden;
  end if;
  select * into v_vende from public.empresas where id = v_oc.empresa_id;
  select * into v_compra from public.empresas where id = p_empresa_compradora;
  if v_compra.id is null or v_compra.grupo_id is distinct from v_vende.grupo_id then
    raise exception 'Elige la empresa que compra (del mismo grupo).';
  end if;
  if v_compra.id = v_vende.id then
    raise exception 'La empresa que compra debe ser otra distinta de %.', v_vende.codigo;
  end if;

  v_nota := concat_ws(' · ',
    format('Inter empresa: base %s %s (%s)', v_oc.tipo, v_oc.id_orden, coalesce(v_oc.proveedor, 'sin proveedor')),
    case when p_comision is not null then format('comisión %s %%', trim(to_char(p_comision, 'FM999990.##'))) end,
    nullif(btrim(coalesce(p_notas, '')), ''));

  v_ov := public.fn_orden_ia_guardar(
    null, 'OV', v_vende.id, coalesce(nullif(btrim(v_compra.razon_social), ''), v_compra.nombre),
    coalesce(p_proyecto, v_oc.proyecto), null, p_lineas, p_forma_pago, p_condicion,
    v_oc.fecha_entrega, v_oc.lugar_entrega, v_nota);
  v_oc2 := public.fn_orden_ia_guardar(
    null, case when v_oc.tipo = 'OS' then 'OS' else 'OC' end, v_compra.id, coalesce(nullif(btrim(v_vende.razon_social), ''), v_vende.nombre),
    coalesce(p_proyecto, v_oc.proyecto), null, p_lineas, p_forma_pago, p_condicion,
    v_oc.fecha_entrega, v_oc.lugar_entrega, v_nota || format(' · OV %s', v_ov ->> 'folio'));

  update public.ordenes_venta set interempresa_origen_id = v_oc.id where id = (v_ov ->> 'id')::uuid;
  update public.ordenes_compra set interempresa_origen_id = v_oc.id where id = (v_oc2 ->> 'id')::uuid;

  return jsonb_build_object('ov', v_ov, 'oc', v_oc2, 'origen', v_oc.id_orden);
end;
$$;
revoke all on function public.fn_orden_interempresa(uuid, uuid, jsonb, numeric, text, text, text, text) from public, anon;
grant execute on function public.fn_orden_interempresa(uuid, uuid, jsonb, numeric, text, text, text, text) to authenticated;
