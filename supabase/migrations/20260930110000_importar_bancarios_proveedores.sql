-- Importar el catálogo de proveedores del backoffice (Mario, 30-sep-2026:
-- "nuestro sistema no tiene esos datos y ya los tenemos"). El backoffice
-- guarda RFC, banco, cuenta y CLABE por proveedor (pantalla Pago a
-- Proveedores), pero la API no los manda y no hay endpoint de proveedores
-- (api_proveedores_aut y similares: 404). Mientras Gonzalo no los exponga,
-- se sube la exportación en Excel/CSV desde Tesorería.
--
-- fn_proveedores_bancarios_importar(p_filas jsonb): [{nombre, beneficiario,
-- banco, cuenta, clabe, rfc, correo}]. La clave es fn_proveedor_clave(nombre).
-- origen 'backoffice': pisa lo aprendido de SPEI y lo importado antes, nunca
-- lo capturado a mano ('captura'). CLABE solo con dígito verificador válido;
-- banco por CLABE si no viene. Solo admin / corporativo / dirección.
--
-- Ya aplicado en producción.

create or replace function public.fn_proveedores_bancarios_importar(p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rol app_rol := public.auth_rol();
  v_uid uuid := (select auth.uid());
  v_grupo uuid;
  v_ins int := 0;
  v_act int := 0;
  v_omit int := 0;
  v_inval int := 0;
  r record;
  v_clave text;
  v_clabe text;
  v_origen text;
begin
  if v_rol not in ('admin', 'corporativo', 'direccion') then
    raise exception 'Solo administración, corporativo o dirección importan datos bancarios' using errcode = '42501';
  end if;
  select grupo_id into v_grupo from public.profiles where id = v_uid;

  for r in
    select nullif(btrim(f ->> 'nombre'), '') as nombre,
           nullif(btrim(f ->> 'beneficiario'), '') as beneficiario,
           nullif(btrim(f ->> 'banco'), '') as banco,
           nullif(regexp_replace(coalesce(f ->> 'cuenta', ''), '\D', '', 'g'), '') as cuenta,
           nullif(regexp_replace(coalesce(f ->> 'clabe', ''), '\D', '', 'g'), '') as clabe,
           nullif(upper(btrim(f ->> 'rfc')), '') as rfc,
           nullif(btrim(f ->> 'correo'), '') as correo
    from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) f
  loop
    v_clave := public.fn_proveedor_clave(r.nombre);
    v_clabe := case when r.clabe is not null and public.fn_clabe_valida(r.clabe) then r.clabe end;
    if v_clave is null or v_clave = '' or (v_clabe is null and r.cuenta is null) then
      v_inval := v_inval + 1;
      continue;
    end if;
    -- Nunca un número de tarjeta (16 dígitos) como cuenta.
    if r.cuenta is not null and length(r.cuenta) between 15 and 16 then
      r.cuenta := null;
      if v_clabe is null then v_inval := v_inval + 1; continue; end if;
    end if;

    select origen into v_origen from public.proveedores_datos_bancarios where clave = v_clave;
    if v_origen = 'captura' then
      v_omit := v_omit + 1;
      continue;
    end if;

    insert into public.proveedores_datos_bancarios as t
      (clave, nombre, beneficiario, banco, clabe, cuenta, rfc, correo, notas, grupo_id, origen, updated_by, updated_at)
    values (v_clave, r.nombre, coalesce(r.beneficiario, r.nombre), coalesce(r.banco, public.fn_banco_de_clabe(v_clabe)),
            v_clabe, r.cuenta, r.rfc, r.correo,
            'Importado del catálogo de proveedores del backoffice el ' || to_char(now() at time zone 'America/Mexico_City', 'DD/MM/YYYY') || '.',
            v_grupo, 'backoffice', v_uid, now())
    on conflict (clave) do update set
      nombre = excluded.nombre, beneficiario = excluded.beneficiario, banco = excluded.banco,
      clabe = coalesce(excluded.clabe, t.clabe), cuenta = coalesce(excluded.cuenta, t.cuenta),
      rfc = coalesce(excluded.rfc, t.rfc), correo = coalesce(excluded.correo, t.correo),
      notas = excluded.notas, origen = 'backoffice', updated_by = excluded.updated_by, updated_at = now()
    where t.origen <> 'captura';

    if v_origen is null then v_ins := v_ins + 1; else v_act := v_act + 1; end if;
  end loop;

  return jsonb_build_object('nuevos', v_ins, 'actualizados', v_act, 'omitidos_captura', v_omit, 'invalidos', v_inval);
end;
$$;
revoke all on function public.fn_proveedores_bancarios_importar(jsonb) from public, anon;
grant execute on function public.fn_proveedores_bancarios_importar(jsonb) to authenticated;
