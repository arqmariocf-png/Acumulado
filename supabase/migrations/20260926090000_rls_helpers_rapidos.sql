-- 26-sep-2026: con la frontera entre organizaciones, cada policy llama por
-- fila a empresa_en_alcance() / empresa_en_mi_organizacion(), y cada una de
-- esas llamaba a su vez a auth_admin_global(), auth_grupo_id(),
-- auth_ve_todas_empresas(), auth_empresa_id()… (8–10 funciones SECURITY
-- DEFINER por fila). Resultado medido: v_saldo_cierre_cuenta 4 s para 18
-- filas, v_oc_lineas_avance 7 s para 2 filas, y los KPIs del organigrama
-- disparaban "canceling statement due to statement timeout" (8 s).
--
-- Mismas reglas, una sola consulta por llamada: se lee el perfil una vez
-- (rol, empresa, organización, si es maestra) y se decide ahí. Además, los
-- KPIs a nivel grupo se calculan en una sola RPC (fn_kpis_alcance) en vez de
-- ~40 consultas con RLS desde el navegador. Ya aplicado en producción.

create or replace function public.auth_admin_global()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    join public.grupos g on g.id = pr.grupo_id
    where pr.id = auth.uid() and pr.rol = 'admin' and g.es_maestro
  )
$$;

create or replace function public.grupo_en_alcance(p_grupo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    left join public.grupos g on g.id = pr.grupo_id
    where pr.id = auth.uid()
      and ((pr.rol = 'admin' and coalesce(g.es_maestro, false))
           or (p_grupo_id is not null and p_grupo_id = pr.grupo_id))
  )
$$;

create or replace function public.empresa_en_mi_organizacion(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    left join public.grupos g on g.id = pr.grupo_id
    where pr.id = auth.uid()
      and ((pr.rol = 'admin' and coalesce(g.es_maestro, false))
           or exists (select 1 from public.empresas e where e.id = p_empresa_id and e.grupo_id = pr.grupo_id))
  )
$$;

create or replace function public.empresa_en_alcance(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    left join public.grupos g on g.id = pr.grupo_id
    where pr.id = auth.uid()
      and ((pr.rol = 'admin' and coalesce(g.es_maestro, false))
           or exists (
             select 1 from public.empresas e
             where e.id = p_empresa_id
               and e.grupo_id = pr.grupo_id
               and (pr.rol in ('corporativo', 'admin') or pr.empresa_id is null or e.id = pr.empresa_id)))
  )
$$;

create or replace function public.auth_modulo_habilitado(p_clave text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    left join public.grupos g on g.id = pr.grupo_id
    where pr.id = auth.uid()
      and ((pr.rol = 'admin' and coalesce(g.es_maestro, false))
           or exists (select 1 from public.grupo_modulos gm where gm.grupo_id = pr.grupo_id and gm.modulo_clave = p_clave and gm.habilitado))
  )
$$;

-- KPIs a nivel grupo en una sola llamada: suma de fn_kpis_empresa() sobre las
-- empresas que la persona alcanza (misma regla que empresa_en_alcance). Los
-- montos y conteos se suman; los porcentajes/días (rh_asistencia_hoy,
-- cont_dias_ultima_carga, log_dias_entrega) se promedian sobre las empresas
-- con dato. Devuelve también el detalle por empresa.
create or replace function public.fn_kpis_alcance()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rol app_rol := public.auth_rol();
  v_empresas jsonb;
  v_total jsonb := '{}'::jsonb;
  v_fila record;
  v_clave text;
  v_val numeric;
  v_promedios text[] := array['rh_asistencia_hoy', 'cont_dias_ultima_carga', 'log_dias_entrega'];
  v_conteos jsonb := '{}'::jsonb;
  v_ve_finanzas boolean;
  v_ve_rh boolean;
  v_ocultas text[] := array[]::text[];
  v_salida jsonb;
begin
  if v_rol is null or v_rol = 'pendiente' then
    raise exception 'Sin acceso' using errcode = '42501';
  end if;

  -- Mismo criterio que lib/indicadores.ts: finanzas/contabilidad solo a
  -- corporativo, dirección, admin y empresa; RH solo a rh, admin, directivo.
  v_ve_finanzas := v_rol in ('corporativo', 'direccion', 'admin', 'empresa');
  v_ve_rh := v_rol in ('rh', 'admin', 'directivo', 'corporativo', 'direccion');

  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'codigo', e.codigo, 'nombre', e.nombre, 'kpis', public.fn_kpis_empresa(e.id)) order by e.nombre), '[]'::jsonb)
    into v_empresas
  from public.empresas e
  where e.activo and public.empresa_en_alcance(e.id);

  for v_fila in select value as emp from jsonb_array_elements(v_empresas) loop
    for v_clave, v_val in select key, case when jsonb_typeof(value) = 'number' then value::text::numeric else null end from jsonb_each(v_fila.emp -> 'kpis') loop
      if v_val is null then continue; end if;
      v_total := v_total || jsonb_build_object(v_clave, coalesce((v_total ->> v_clave)::numeric, 0) + v_val);
      v_conteos := v_conteos || jsonb_build_object(v_clave, coalesce((v_conteos ->> v_clave)::int, 0) + 1);
    end loop;
  end loop;

  foreach v_clave in array v_promedios loop
    if (v_conteos ->> v_clave) is not null and (v_conteos ->> v_clave)::int > 0 then
      v_total := v_total || jsonb_build_object(v_clave, round((v_total ->> v_clave)::numeric / (v_conteos ->> v_clave)::numeric, 1));
    end if;
  end loop;

  -- Claves que este rol no debe ver (ni en el total ni por empresa).
  select coalesce(array_agg(k), array[]::text[]) into v_ocultas
  from jsonb_object_keys(v_total) k
  where (not v_ve_finanzas and (k like 'fin\_%' or k like 'cont\_%' or k in ('movimientos_revisar', 'carga_sin_estado', 'cuentas_bancarias')))
     or (not v_ve_rh and (k like 'rh\_%' or k = 'usuarios'));

  v_total := v_total - v_ocultas;
  select coalesce(jsonb_agg(jsonb_set(e, '{kpis}', (e -> 'kpis') - v_ocultas)), '[]'::jsonb) into v_salida
  from jsonb_array_elements(v_empresas) e;

  return jsonb_build_object('total', v_total, 'empresas', v_salida, 'calculado_en', now());
end;
$$;

revoke all on function public.fn_kpis_alcance() from public, anon;
grant execute on function public.fn_kpis_alcance() to authenticated;
