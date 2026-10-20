-- Sección Catálogos (21-oct-2026, Mario: "genera la sección de catálogos:
-- empresas, proveedores, ítems, clientes; que puedan ser fácilmente
-- manipulables por el área de Laura: agregar, quitar y editar").
--
-- Proveedores (`proveedores`) e ítems (`compras_items`) ya dejaban a
-- dirección dar de alta, editar y borrar. Faltaba:
--   * empresas: dirección da de alta y edita las de su organización (antes
--     solo admin). No se borran: se desactivan (cuelgan de todo). El código
--     corto (cargas, folios, logos) solo lo cambia el admin una vez dada de
--     alta (trigger empresas_guarda_codigo).
--   * clientes: dirección borra los que no se usan (un cliente con
--     cotización, remisión, crédito, contrato o venta no se puede borrar por
--     sus llaves; en pantalla se desactiva).
-- Ya aplicado en producción (catalogos_direccion).

drop policy if exists empresas_direccion_insert on public.empresas;
create policy empresas_direccion_insert on public.empresas for insert to authenticated
  with check ((select public.auth_rol_definer()) = 'direccion'
              and grupo_id is not null
              and grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));

drop policy if exists empresas_direccion_update on public.empresas;
create policy empresas_direccion_update on public.empresas for update to authenticated
  using ((select public.auth_rol_definer()) = 'direccion'
         and grupo_id is not null
         and grupo_id = any ((select public.auth_grupos_alcance())::uuid[]))
  with check ((select public.auth_rol_definer()) = 'direccion'
              and grupo_id is not null
              and grupo_id = any ((select public.auth_grupos_alcance())::uuid[]));

create or replace function public.empresas_guarda_codigo()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.codigo is distinct from old.codigo and public.auth_rol() <> 'admin' then
    raise exception 'El código de la empresa solo lo cambia el director general (se usa en cargas, folios y logos)';
  end if;
  if new.grupo_id is distinct from old.grupo_id and not public.auth_admin_global() then
    raise exception 'La empresa no se puede pasar a otra organización';
  end if;
  return new;
end;
$$;

drop trigger if exists empresas_guarda_codigo on public.empresas;
create trigger empresas_guarda_codigo before update on public.empresas
  for each row execute function public.empresas_guarda_codigo();

drop policy if exists clientes_direccion_delete on public.clientes;
create policy clientes_direccion_delete on public.clientes for delete to authenticated
  using ((select public.auth_rol_definer()) = any (array['admin'::app_rol, 'direccion'::app_rol])
         and empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
