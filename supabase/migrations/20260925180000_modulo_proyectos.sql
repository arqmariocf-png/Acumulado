-- Proyectos es el módulo con el que entra ARSSA (Mario, 25-sep-2026: "vamos a
-- entrar con el área de proyectos únicamente"), pero no existía como módulo:
-- `modulos` solo tenía conciliacion, inventario y rh. Sus tablas tenían la
-- frontera de organización y nada más -- ni interruptor ni suscripción. Sin
-- esto, "abrirle proyectos a un cliente" no es una operación que exista, y
-- una organización suspendida seguiría capturando.

insert into public.modulos (clave, nombre, descripcion, orden) values
  ('proyectos', 'Proyectos', 'Proyecto, diseño de planos y cotizaciones; control de obra.', 40)
on conflict (clave) do nothing;

-- Loma lo usa desde antes; ARSSA entra con él y es el único que trae abierto.
insert into public.grupo_modulos (grupo_id, modulo_clave, habilitado, habilitado_at)
select g.id, 'proyectos', true, now() from public.grupos g
where g.codigo in ('LOMA', 'ARSSA')
on conflict (grupo_id, modulo_clave) do update set habilitado = true, habilitado_at = now();

insert into public.grupo_modulos (grupo_id, modulo_clave, habilitado)
select g.id, 'proyectos', false from public.grupos g
where g.codigo not in ('LOMA', 'ARSSA')
on conflict (grupo_id, modulo_clave) do nothing;

-- ── proyectos ───────────────────────────────────────────────────────────
alter policy proyectos_select on public.proyectos
  using (
    public.auth_rol() <> 'pendiente'
    and public.auth_modulo_habilitado('proyectos')
    and (
      public.auth_ve_todas_empresas()
      or (public.auth_rol() in ('empresa', 'direccion') and empresa_id = public.auth_empresa_id())
      or responsable_id = (select auth.uid())
      or comprador_id = (select auth.uid())
    )
  );

alter policy proyectos_select_produccion on public.proyectos
  using (
    public.auth_rol() = 'produccion'
    and public.auth_modulo_habilitado('proyectos')
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );

alter policy proyectos_select_gastos on public.proyectos
  using (
    public.auth_puede_comprobar_gasto()
    and public.auth_modulo_habilitado('proyectos')
    and activo
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );

alter policy proyectos_insert_produccion on public.proyectos
  with check (
    public.auth_rol() = 'produccion'
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and (public.auth_empresa_id() is null or empresa_id = public.auth_empresa_id())
  );

-- `for all` se parte para que la lectura no dependa del pago.
drop policy proyectos_write on public.proyectos;

create policy proyectos_insert on public.proyectos for insert to authenticated
  with check (
    public.auth_rol() in ('admin', 'corporativo')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
  );

create policy proyectos_update on public.proyectos for update to authenticated
  using (
    public.auth_rol() in ('admin', 'corporativo')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
  )
  with check (
    public.auth_rol() in ('admin', 'corporativo')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
  );

create policy proyectos_delete on public.proyectos for delete to authenticated
  using (
    public.auth_rol() in ('admin', 'corporativo')
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
  );

-- ── planos ──────────────────────────────────────────────────────────────
alter policy proyecto_planos_select on public.proyecto_planos
  using (
    public.auth_modulo_habilitado('proyectos')
    and exists (
      select 1 from public.proyectos p
      where p.id = proyecto_planos.proyecto_id
        and (
          public.auth_ve_todas_empresas()
          or (public.auth_rol() in ('empresa', 'direccion') and p.empresa_id = public.auth_empresa_id())
          or p.responsable_id = (select auth.uid())
          or p.comprador_id = (select auth.uid())
        )
    )
  );

alter policy proyecto_planos_insert on public.proyecto_planos
  with check (
    subido_por = (select auth.uid())
    and public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and exists (
      select 1 from public.proyectos p
      where p.id = proyecto_planos.proyecto_id
        and (
          public.auth_ve_todas_empresas()
          or (public.auth_rol() in ('empresa', 'direccion') and p.empresa_id = public.auth_empresa_id())
          or p.responsable_id = (select auth.uid())
          or p.comprador_id = (select auth.uid())
        )
    )
  );

alter policy proyecto_planos_delete on public.proyecto_planos
  using (
    public.auth_suscripcion_permite_escribir()
    and public.auth_modulo_habilitado('proyectos')
    and (public.auth_rol() in ('admin', 'corporativo') or subido_por = (select auth.uid()))
  );

-- ── control de obra ─────────────────────────────────────────────────────
alter policy proyecto_controles_select on public.proyecto_controles
  using (public.auth_modulo_habilitado('proyectos') and public.auth_ve_proyecto(proyecto_id));

drop policy proyecto_controles_write on public.proyecto_controles;
create policy proyecto_controles_insert on public.proyecto_controles for insert to authenticated
  with check (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
create policy proyecto_controles_update on public.proyecto_controles for update to authenticated
  using (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'))
  with check (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
create policy proyecto_controles_delete on public.proyecto_controles for delete to authenticated
  using (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));

alter policy proyecto_control_compras_select on public.proyecto_control_compras
  using (
    public.auth_modulo_habilitado('proyectos')
    and exists (select 1 from public.proyecto_controles c where c.id = proyecto_control_compras.control_id and public.auth_ve_proyecto(c.proyecto_id))
  );

drop policy proyecto_control_compras_write on public.proyecto_control_compras;
create policy proyecto_control_compras_insert on public.proyecto_control_compras for insert to authenticated
  with check (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
create policy proyecto_control_compras_update on public.proyecto_control_compras for update to authenticated
  using (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'))
  with check (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
create policy proyecto_control_compras_delete on public.proyecto_control_compras for delete to authenticated
  using (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));

alter policy proyecto_control_nomina_select on public.proyecto_control_nomina
  using (
    public.auth_modulo_habilitado('proyectos')
    and exists (select 1 from public.proyecto_controles c where c.id = proyecto_control_nomina.control_id and public.auth_ve_proyecto(c.proyecto_id))
  );

drop policy proyecto_control_nomina_write on public.proyecto_control_nomina;
create policy proyecto_control_nomina_insert on public.proyecto_control_nomina for insert to authenticated
  with check (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
create policy proyecto_control_nomina_update on public.proyecto_control_nomina for update to authenticated
  using (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'))
  with check (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
create policy proyecto_control_nomina_delete on public.proyecto_control_nomina for delete to authenticated
  using (public.auth_rol() in ('admin','corporativo') and public.auth_suscripcion_permite_escribir() and public.auth_modulo_habilitado('proyectos'));
