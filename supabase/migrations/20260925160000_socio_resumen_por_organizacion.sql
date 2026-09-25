-- fn_socio_resumen() (20260925120000) nació cuando Mario era el único admin
-- de la única organización, y pide exactamente eso: rol 'admin'. Con un
-- cliente de paga en la misma base, el admin de ESE cliente también cumple la
-- condición -- y la función es SECURITY DEFINER, así que le devolvería las
-- empresas de Grupo Loma con su saldo consolidado, sus pagos vencidos y su
-- plantilla. Es la regla que no se rompe: nada que cuente dinero o gente de
-- otra organización se expone por RPC.
--
-- El arreglo es una línea en el WHERE: grupo_en_alcance(). El admin de la
-- organización maestra sigue viendo todo (para eso opera la plataforma); el
-- de una organización cliente ve la suya y nada más.
--
-- fn_kpis_empresa() no necesita guarda propia: solo se llama desde aquí y
-- desde la vista de socio, y ya está revocada de public más abajo -- lo que
-- le faltaba era que nadie la pudiera llamar con la empresa de otro.

create or replace function public.fn_socio_resumen()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resultado jsonb;
begin
  if coalesce(public.auth_rol() = 'admin', false) is not true then
    raise exception 'Solo el administrador puede ver el resumen de socio' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id,
           'codigo', g.codigo,
           'nombre', g.nombre,
           'marca_comercial', g.marca_comercial,
           'es_maestro', g.es_maestro,
           'activo', g.activo,
           'empresas', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', em.id,
                      'codigo', em.codigo,
                      'nombre', em.nombre,
                      'activo', em.activo,
                      'kpis', public.fn_kpis_empresa(em.id)
                    ) order by em.nombre)
             from public.empresas em
             where em.grupo_id = g.id
           ), '[]'::jsonb)
         ) order by g.es_maestro desc, g.nombre), '[]'::jsonb)
    into resultado
  from public.grupos g
  where g.activo
    and public.grupo_en_alcance(g.id);

  return jsonb_build_object('grupos', resultado, 'calculado_en', now());
end;
$$;

revoke all on function public.fn_socio_resumen() from public, anon;
grant execute on function public.fn_socio_resumen() to authenticated;

-- fn_kpis_empresa es SECURITY DEFINER y recibe una empresa cualquiera: por sí
-- sola le daría a cualquier autenticado los números de la empresa que quiera.
-- Se acota a la organización de quien pregunta.
create or replace function public.fn_kpis_empresa_publica(e uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.empresa_en_mi_organizacion(e) then public.fn_kpis_empresa(e)
    else '{}'::jsonb
  end
$$;

revoke all on function public.fn_kpis_empresa(uuid) from public, anon, authenticated;
grant execute on function public.fn_kpis_empresa(uuid) to service_role;
revoke all on function public.fn_kpis_empresa_publica(uuid) from public, anon;
grant execute on function public.fn_kpis_empresa_publica(uuid) to authenticated;
