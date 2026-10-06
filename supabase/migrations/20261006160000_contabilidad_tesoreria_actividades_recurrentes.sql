-- Perfil de contabilidad para Belén y actividades recurrentes con aviso
-- (Mario, 6-oct-2026: "no existe rol de Belén que sea el de contabilidad";
-- "sube el archivo de Adquira cada viernes: ponerlo como recordatorio y
-- mandar una notificación cada vez que sea esa fecha").
--
-- 1. Puesto por persona, no rol nuevo (cambiar app_rol movería decenas de
--    policies): permisos_modulo acepta 'contabilidad' y 'tesoreria'.
--    Belén y Delia siguen siendo 'corporativo' (mismos datos: OC/OV, CFDI,
--    movimientos de todas las empresas); lo que cambia es su inicio:
--    contabilidad ve el acumulado y su calendario, tesorería ve los pagos.
-- 2. actividades_recurrentes: una tarea que se crea sola en el tablero los
--    días de la semana que diga (ISO: 1 lunes … 7 domingo) a las 7:30 de
--    Puebla, con fecha límite ese día; el recordatorio diario de las 8:00
--    (push-enviar-recordatorios) avisa al celular. Con cierre 'adquira' la
--    tarjeta pasa a "Hecho" sola en cuanto se sube el archivo de Adquira.
--
-- Ya aplicado en producción.

alter table public.permisos_modulo drop constraint if exists permisos_modulo_modulo_check;
alter table public.permisos_modulo add constraint permisos_modulo_modulo_check
  check (modulo = any (array['inventario', 'produccion', 'precios', 'requisiciones', 'tareas', 'proyectos', 'bbva', 'comedor', 'legal', 'checador', 'contabilidad', 'tesoreria']));

create table if not exists public.actividades_recurrentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  tablero_id uuid not null references public.tableros(id) on delete cascade,
  titulo text not null,
  descripcion text,
  asignado_a uuid not null references public.profiles(id),
  dias_semana int[] not null default '{5}' check (dias_semana <@ array[1, 2, 3, 4, 5, 6, 7] and cardinality(dias_semana) > 0),
  cierre_automatico text check (cierre_automatico in ('adquira')),
  activa boolean not null default true,
  creado_por uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists actividades_recurrentes_tablero_idx on public.actividades_recurrentes (tablero_id);
create index if not exists actividades_recurrentes_empresa_idx on public.actividades_recurrentes (empresa_id);
create index if not exists actividades_recurrentes_asignado_idx on public.actividades_recurrentes (asignado_a);
create index if not exists actividades_recurrentes_creado_por_idx on public.actividades_recurrentes (creado_por);

create table if not exists public.actividades_recurrentes_generadas (
  actividad_id uuid not null references public.actividades_recurrentes(id) on delete cascade,
  fecha date not null,
  tarjeta_id uuid references public.tarjetas(id) on delete set null,
  primary key (actividad_id, fecha)
);
create index if not exists actividades_recurrentes_generadas_tarjeta_idx on public.actividades_recurrentes_generadas (tarjeta_id);

alter table public.actividades_recurrentes enable row level security;
alter table public.actividades_recurrentes_generadas enable row level security;

drop policy if exists frontera_organizacion on public.actividades_recurrentes;
create policy frontera_organizacion on public.actividades_recurrentes as restrictive for all
  using (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]))
  with check (empresa_id = any ((select public.auth_empresas_organizacion())::uuid[]));
drop policy if exists actividades_recurrentes_select on public.actividades_recurrentes;
create policy actividades_recurrentes_select on public.actividades_recurrentes for select
  using (asignado_a = (select auth.uid())
         or (select public.auth_rol_definer()) = any (array['admin', 'direccion', 'corporativo']::app_rol[]));
drop policy if exists actividades_recurrentes_write on public.actividades_recurrentes;
create policy actividades_recurrentes_write on public.actividades_recurrentes for all
  using ((select public.auth_rol_definer()) = 'admin'::app_rol)
  with check ((select public.auth_rol_definer()) = 'admin'::app_rol);

drop policy if exists frontera_organizacion on public.actividades_recurrentes_generadas;
create policy frontera_organizacion on public.actividades_recurrentes_generadas as restrictive for all
  using (exists (select 1 from public.actividades_recurrentes a where a.id = actividad_id))
  with check (exists (select 1 from public.actividades_recurrentes a where a.id = actividad_id));
drop policy if exists actividades_recurrentes_generadas_select on public.actividades_recurrentes_generadas;
create policy actividades_recurrentes_generadas_select on public.actividades_recurrentes_generadas for select
  using (exists (select 1 from public.actividades_recurrentes a where a.id = actividad_id));

drop policy if exists espectador_sin_datos on public.actividades_recurrentes;
create policy espectador_sin_datos on public.actividades_recurrentes as restrictive for select using (not (select public.auth_es_espectador()));
drop policy if exists espectador_sin_datos on public.actividades_recurrentes_generadas;
create policy espectador_sin_datos on public.actividades_recurrentes_generadas as restrictive for select using (not (select public.auth_es_espectador()));
drop policy if exists director_general on public.actividades_recurrentes;
create policy director_general on public.actividades_recurrentes for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));
drop policy if exists director_general on public.actividades_recurrentes_generadas;
create policy director_general on public.actividades_recurrentes_generadas for all using ((select public.auth_admin_global_definer())) with check ((select public.auth_admin_global_definer()));

drop trigger if exists solo_consulta on public.actividades_recurrentes;
create trigger solo_consulta before insert or update or delete on public.actividades_recurrentes
  for each statement execute function public.bloquear_solo_consulta();
drop trigger if exists solo_consulta on public.actividades_recurrentes_generadas;
create trigger solo_consulta before insert or update or delete on public.actividades_recurrentes_generadas
  for each statement execute function public.bloquear_solo_consulta();

-- Genera las tarjetas de hoy (lo llama pg_cron a las 13:30 UTC = 7:30 Puebla).
create or replace function public.fn_generar_actividades_recurrentes(p_fecha date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hoy date := coalesce(p_fecha, (now() at time zone 'America/Mexico_City')::date);
  v_a public.actividades_recurrentes%rowtype;
  v_columna uuid;
  v_tarjeta uuid;
  v_n int := 0;
begin
  for v_a in
    select * from public.actividades_recurrentes a
    where a.activa and extract(isodow from v_hoy)::int = any (a.dias_semana)
      and not exists (select 1 from public.actividades_recurrentes_generadas g where g.actividad_id = a.id and g.fecha = v_hoy)
  loop
    select c.id into v_columna from public.tablero_columnas c where c.tablero_id = v_a.tablero_id order by c.orden limit 1;
    if v_columna is null then continue; end if;
    insert into public.tarjetas (tablero_id, columna_id, titulo, descripcion, asignado_a, creado_por, fecha_limite)
    values (v_a.tablero_id, v_columna, v_a.titulo || ' · ' || to_char(v_hoy, 'DD/MM'), v_a.descripcion, v_a.asignado_a,
            coalesce(v_a.creado_por, v_a.asignado_a), v_hoy)
    returning id into v_tarjeta;
    insert into public.actividades_recurrentes_generadas (actividad_id, fecha, tarjeta_id) values (v_a.id, v_hoy, v_tarjeta);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.fn_generar_actividades_recurrentes(date) from public, anon, authenticated;

-- Al subir Adquira, la tarjeta de la semana pasa a la última columna ("Hecho").
create or replace function public.fn_cerrar_actividades_adquira()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tarjetas t
     set columna_id = (select c.id from public.tablero_columnas c where c.tablero_id = t.tablero_id order by c.orden desc limit 1)
    from public.actividades_recurrentes_generadas g
    join public.actividades_recurrentes a on a.id = g.actividad_id
   where g.tarjeta_id = t.id
     and a.cierre_automatico = 'adquira'
     and g.fecha >= (now() at time zone 'America/Mexico_City')::date - 6
     and t.columna_id <> (select c.id from public.tablero_columnas c where c.tablero_id = t.tablero_id order by c.orden desc limit 1);
  return null;
end;
$$;
drop trigger if exists bbva_adquira_cierra_actividad on public.bbva_adquira_pedidos;
create trigger bbva_adquira_cierra_actividad after insert or update on public.bbva_adquira_pedidos
  for each statement execute function public.fn_cerrar_actividades_adquira();

-- Siembra (solo donde existen las personas): Belén = contabilidad,
-- Delia = tesorería, tablero "Contabilidad · Actividades" (CSC) y el
-- viernes de Adquira.
insert into public.permisos_modulo (profile_id, modulo)
select p.id, 'contabilidad' from public.profiles p where p.id = '83a81024-5ae6-45a1-ad83-738be2971d78'
on conflict do nothing;
insert into public.permisos_modulo (profile_id, modulo)
select p.id, 'tesoreria' from public.profiles p where p.id = '4b0d4d7d-fbc5-42e5-ac8b-deaa5644bfaf'
on conflict do nothing;

do $$
declare v_tablero uuid; v_mario uuid := 'e0268126-4fa1-4415-8553-b9cff72b1db7'; v_belen uuid := '83a81024-5ae6-45a1-ad83-738be2971d78'; v_csc uuid := '6f5a3ec0-8e10-4bcf-ba09-c38e12098bbf';
begin
  if not exists (select 1 from public.profiles where id = v_belen) or not exists (select 1 from public.empresas where id = v_csc) then return; end if;
  select id into v_tablero from public.tableros where nombre = 'Contabilidad · Actividades' and empresa_id = v_csc;
  if v_tablero is null then
    insert into public.tableros (empresa_id, nombre, descripcion, creado_por)
    values (v_csc, 'Contabilidad · Actividades', 'Actividades recurrentes de contabilidad (Belén).', v_mario)
    returning id into v_tablero;
    insert into public.tablero_columnas (tablero_id, nombre, orden) values (v_tablero, 'Por hacer', 0), (v_tablero, 'En progreso', 1), (v_tablero, 'Hecho', 2);
  end if;
  if not exists (select 1 from public.actividades_recurrentes where tablero_id = v_tablero and cierre_automatico = 'adquira') then
    insert into public.actividades_recurrentes (empresa_id, tablero_id, titulo, descripcion, asignado_a, dias_semana, cierre_automatico, creado_por)
    values (v_csc, v_tablero, 'Subir el archivo de Adquira (BBVA)',
            'Cada viernes: exporta "Pedidos recibidos" de Adquira y súbelo en Mantenimiento → Control BBVA (/mantenimiento/bbva). La tarjeta se cierra sola al subirlo.',
            v_belen, '{5}', 'adquira', v_mario);
  end if;
end $$;

-- Último CFDI por empresa (indicador "Empresas con CFDI atrasados" y panel
-- del acumulado): emitidos, recibidos y cuándo se cargó. Una fila por
-- empresa activa, aunque no tenga CFDI.
create or replace view public.v_cfdi_ultimo_por_empresa with (security_invoker = true) as
select e.id as empresa_id,
       e.codigo as empresa_codigo,
       e.nombre as empresa_nombre,
       max(c.fecha)::date as ultima_fecha,
       max(c.fecha) filter (where c.tipo = 'emitido')::date as ultimo_emitido,
       max(c.fecha) filter (where c.tipo = 'recibido')::date as ultimo_recibido,
       max(c.created_at) as ultima_carga,
       count(c.id) as total_cfdi
from public.empresas e
left join public.cfdi c on c.empresa_id = e.id
where e.activo
group by e.id, e.codigo, e.nombre;
revoke all on public.v_cfdi_ultimo_por_empresa from anon;
grant select on public.v_cfdi_ultimo_por_empresa to authenticated;
