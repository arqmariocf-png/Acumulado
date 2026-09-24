-- Precios unitarios > Análisis fallaba con "canceling statement due to
-- statement timeout" (Mario, 24-sep-2026). Con 15 análisis y 83 partidas
-- la vista v_pu_analisis_costeo tardaba ~3 s (y más con caché fría) porque
-- las funciones de costeo son recursivas y cada fila de pu_analisis_items
-- que tocan vuelve a evaluar su política RLS (EXISTS sobre pu_analisis, que a
-- su vez llama auth_rol()/auth_ve_todas_empresas()/auth_es_supervisor_pu()).
-- Sin RLS el mismo costeo tarda 30 ms.
--
-- Las cuatro funciones pasan a SECURITY DEFINER (dueño postgres, sin RLS
-- adentro). Es seguro porque solo devuelven números derivados de un
-- analisis_id/insumo_id que el usuario ya obtuvo a través de vistas con RLS;
-- de todos modos quedan cerradas a anon, a sesiones sin perfil y a cuentas 'pendiente' (las cuentas
-- falsas que se registran solas no tienen rol).

create or replace function public.fn_pu_costo_insumo(p_insumo_id uuid, p_empresa_id uuid default null, p_fecha date default current_date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select pr.costo
  from pu_insumo_precios pr
  where coalesce(public.auth_rol() <> 'pendiente', false)
    and pr.insumo_id = p_insumo_id
    and pr.fecha_vigencia <= p_fecha
    and (pr.empresa_id is null or pr.empresa_id = p_empresa_id)
  order by (pr.empresa_id is not null) desc, pr.fecha_vigencia desc, pr.created_at desc
  limit 1
$$;

create or replace function public.fn_pu_mano_obra_directa(p_analisis_id uuid, p_fecha date default current_date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with recursive arbol as (
    select i.insumo_id, i.analisis_hijo_id, i.costo_congelado,
           (i.cantidad / i.rendimiento) as aportacion, 1 as nivel
    from pu_analisis_items i
    where i.analisis_id = p_analisis_id and i.base_calculo = 'cantidad'

    union all

    select i.insumo_id, i.analisis_hijo_id, i.costo_congelado,
           a.aportacion * (i.cantidad / i.rendimiento), a.nivel + 1
    from pu_analisis_items i
    join arbol a on i.analisis_id = a.analisis_hijo_id
    where i.base_calculo = 'cantidad' and a.nivel < 10
  )
  select round(coalesce(sum(
    arbol.aportacion * coalesce(arbol.costo_congelado, fn_pu_costo_insumo(arbol.insumo_id, e.empresa_id, p_fecha), 0)
  ), 0), 4)
  from arbol
  join pu_insumos ins on ins.id = arbol.insumo_id and ins.tipo = 'mano_obra'
  cross join lateral (select a.empresa_id from pu_analisis a where a.id = p_analisis_id) e
  where coalesce(public.auth_rol() <> 'pendiente', false)
$$;

create or replace function public.fn_pu_explosion_insumos(p_analisis_id uuid, p_fecha date default current_date)
returns table (insumo_id uuid, tipo pu_tipo_insumo, aportacion numeric, costo_unitario numeric, importe numeric)
language sql
stable
security definer
set search_path = public
as $$
  with recursive arbol as (
    select
      i.analisis_id,
      i.insumo_id,
      i.analisis_hijo_id,
      i.costo_congelado,
      i.base_calculo,
      i.cantidad,
      i.rendimiento,
      1::numeric as multiplicador,
      1 as nivel
    from pu_analisis_items i
    where i.analisis_id = p_analisis_id

    union all

    select
      i.analisis_id,
      i.insumo_id,
      i.analisis_hijo_id,
      i.costo_congelado,
      i.base_calculo,
      i.cantidad,
      i.rendimiento,
      a.multiplicador * (a.cantidad / a.rendimiento),
      a.nivel + 1
    from pu_analisis_items i
    join arbol a on i.analisis_id = a.analisis_hijo_id
    where a.base_calculo = 'cantidad' and a.nivel < 10
  )
  select
    arbol.insumo_id,
    ins.tipo,
    case
      when arbol.base_calculo = 'pct_mano_obra' then arbol.multiplicador * arbol.cantidad
      else arbol.multiplicador * (arbol.cantidad / arbol.rendimiento)
    end,
    v.costo,
    round(
      case
        when arbol.base_calculo = 'pct_mano_obra'
          then arbol.multiplicador * arbol.cantidad * v.costo
        else arbol.multiplicador * (arbol.cantidad / arbol.rendimiento) * v.costo
      end, 4)
  from arbol
  join pu_insumos ins on ins.id = arbol.insumo_id
  cross join lateral (select a.empresa_id from pu_analisis a where a.id = p_analisis_id) e
  cross join lateral (
    select case
      when arbol.base_calculo = 'pct_mano_obra'
        then fn_pu_mano_obra_directa(arbol.analisis_id, p_fecha)
      else coalesce(arbol.costo_congelado, fn_pu_costo_insumo(arbol.insumo_id, e.empresa_id, p_fecha), 0)
    end as costo
  ) v
  where arbol.insumo_id is not null
    and coalesce(public.auth_rol() <> 'pendiente', false)
$$;

create or replace function public.fn_pu_costo_directo(p_analisis_id uuid, p_fecha date default current_date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce(sum(importe), 0), 4)
  from fn_pu_explosion_insumos(p_analisis_id, p_fecha)
$$;

revoke execute on function public.fn_pu_costo_insumo(uuid, uuid, date) from public, anon;
revoke execute on function public.fn_pu_mano_obra_directa(uuid, date) from public, anon;
revoke execute on function public.fn_pu_explosion_insumos(uuid, date) from public, anon;
revoke execute on function public.fn_pu_costo_directo(uuid, date) from public, anon;
grant execute on function public.fn_pu_costo_insumo(uuid, uuid, date) to authenticated;
grant execute on function public.fn_pu_mano_obra_directa(uuid, date) to authenticated;
grant execute on function public.fn_pu_explosion_insumos(uuid, date) to authenticated;
grant execute on function public.fn_pu_costo_directo(uuid, date) to authenticated;
