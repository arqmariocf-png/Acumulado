-- Corte del comedor para quien lleva la caja de efectivo (31-oct-2026, Mario:
-- "deja ver el corte semanal a Jaime también por si es en efectivo").
-- Ver el corte (pestaña "Descuento vía nómina") ahora también con el permiso
-- por persona 'caja'; marcar aplicado en nómina sigue siendo de RH,
-- dirección, corporativo y admin (auth_aplica_nomina_comedor).
-- Ya aplicado en producción.

create or replace function public.auth_aplica_nomina_comedor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_rol() in ('admin', 'corporativo', 'direccion', 'rh')
$$;
revoke all on function public.auth_aplica_nomina_comedor() from public;
grant execute on function public.auth_aplica_nomina_comedor() to authenticated, service_role;

create or replace function public.auth_ve_nomina_comedor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_aplica_nomina_comedor()
      or exists (select 1 from public.permisos_modulo pm
                  where pm.profile_id = auth.uid() and pm.modulo = 'caja')
$$;

create or replace function public.fn_comedor_aplicar_descuento(p_desde date, p_hasta date, p_empresa_trabajador uuid, p_referencia text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.auth_aplica_nomina_comedor() then raise exception 'Solo RH o finanzas aplican descuentos de nómina' using errcode = '42501'; end if;
  if not (p_empresa_trabajador = any (public.auth_empresas_organizacion())) then raise exception 'Sin acceso a esa empresa' using errcode = '42501'; end if;
  update public.comedor_pedidos
     set descuento_aplicado_en = now(), descuento_aplicado_por = (select auth.uid()),
         descuento_referencia = nullif(btrim(coalesce(p_referencia, '')), ''), updated_at = now()
   where estado = 'entregado' and descuento_aplicado_en is null
     and empresa_trabajador_id = p_empresa_trabajador and fecha between p_desde and p_hasta;
  get diagnostics n = row_count;
  return n;
end;
$$;
