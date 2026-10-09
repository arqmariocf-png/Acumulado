-- Alta manual de OC mientras el backoffice no responde (Laura, 9-oct-2026:
-- "el sistema sigue sin actualizarse, no puedo subir nada"; api_ocs_aut
-- responde 500 "Access denied for user dxjldwfg_backoffice" desde el 7-oct).
--
-- Dirección/corporativo/admin dan de alta la OC con su folio real (fuente
-- 'excel'): sale en "Por autorizar", se autoriza y se le programa pago como
-- cualquier otra. Cuando el backoffice vuelva, la sincronización hace upsert
-- por (id_orden, tipo): la misma OC pasa a 'api' con los datos de allá y
-- conserva su autorización y sus pagos ligados (no se duplica).
--
-- Ya aplicado en producción.

create or replace function public.fn_oc_alta_manual(
  p_empresa uuid, p_folio text, p_proveedor text, p_total numeric,
  p_fecha date, p_proyecto text default null, p_forma_pago text default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_folio text := btrim(coalesce(p_folio, ''));
begin
  if public.auth_rol() not in ('admin', 'direccion', 'corporativo') then
    raise exception 'Solo dirección, corporativo o el administrador dan de alta OC a mano' using errcode = '42501';
  end if;
  if p_empresa is null or not (p_empresa = any (public.auth_empresas_alcance())) then
    raise exception 'Elige una empresa que manejes' using errcode = '42501';
  end if;
  if v_folio = '' then raise exception 'Escribe el folio de la OC'; end if;
  if coalesce(btrim(p_proveedor), '') = '' then raise exception 'Escribe el proveedor'; end if;
  if p_total is null or p_total <= 0 then raise exception 'El total debe ser mayor a cero'; end if;
  if exists (select 1 from public.ordenes_compra where id_orden = v_folio and tipo = 'OC') then
    raise exception 'La OC % ya existe en el sistema', v_folio;
  end if;
  insert into public.ordenes_compra (id_orden, tipo, empresa_id, proveedor, proyecto, total, fecha_creacion, fuente, creada_por, tipo_pago_backoffice, condicion_pago)
  values (v_folio, 'OC', p_empresa, btrim(p_proveedor), nullif(btrim(coalesce(p_proyecto, '')), ''), round(p_total, 2), coalesce(p_fecha, current_date), 'excel', auth.uid(),
          nullif(btrim(coalesce(p_forma_pago, '')), ''),
          case when p_forma_pago ilike 'efectivo%' then 'efectivo' end)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.fn_oc_alta_manual(uuid, text, text, numeric, date, text, text) from public, anon;
grant execute on function public.fn_oc_alta_manual(uuid, text, text, numeric, date, text, text) to authenticated;
