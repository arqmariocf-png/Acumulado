-- Seguimiento por renglón de requisición: pedido, entregado, devolución,
-- cambio y comentarios (Jonathan Cáceres, 29-sep-2026: "un botón para
-- marcar pedido y entregado y una columna para agregar comentarios"; Mario:
-- "también devolución en caso de que necesiten cambiar piezas; son las
-- bases para nuestro punto de venta").
--
-- Bitácora, no columnas: cada marca es un evento con cantidad, nota, quién y
-- cuándo. Los totales se CALCULAN (lib/seguimientoLinea.ts y la vista):
--   pedido     = Σ pedido − Σ devolución
--   entregado  = Σ entregado − Σ devolución − Σ cambio
--   devolución = regresa la pieza y NO se repone (baja pedido y entregado)
--   cambio     = regresa la pieza para que la repongan (baja solo
--                entregado; la reposición se marca como otro "entregado")
--
-- Es independiente de las OC del sistema ("En compra" / "Surtido"): sirve
-- también para lo que se compra por fuera.
--
-- Ya aplicado en producción.

create table if not exists public.requisicion_linea_eventos (
  id uuid primary key default gen_random_uuid(),
  requisicion_linea_id uuid not null references public.requisicion_lineas(id) on delete cascade,
  requisicion_id uuid references public.requisiciones(id) on delete cascade,
  tipo text not null check (tipo in ('pedido', 'entregado', 'devolucion', 'cambio', 'comentario')),
  cantidad numeric check (cantidad is null or cantidad > 0),
  nota text,
  created_by uuid default auth.uid() references auth.users(id),
  created_by_nombre text,
  created_at timestamptz not null default now(),
  constraint requisicion_linea_eventos_cantidad_o_nota check (
    (tipo = 'comentario' and nullif(btrim(nota), '') is not null)
    or (tipo in ('pedido', 'entregado') and cantidad is not null)
    or (tipo in ('devolucion', 'cambio') and cantidad is not null and nullif(btrim(nota), '') is not null)
  )
);
create index if not exists requisicion_linea_eventos_linea_idx on public.requisicion_linea_eventos (requisicion_linea_id);
create index if not exists requisicion_linea_eventos_req_idx on public.requisicion_linea_eventos (requisicion_id);

comment on table public.requisicion_linea_eventos is
  'Bitácora por renglón de requisición: pedido, entregado, devolucion (no se repone), cambio (se repone) y comentario. Totales calculados.';

-- Antes de insertar: requisición, nombre de quien marca (profiles solo deja
-- leer el renglón propio) y que no se devuelva más de lo entregado.
create or replace function public.requisicion_linea_eventos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entregado numeric;
begin
  select rl.requisicion_id into new.requisicion_id from public.requisicion_lineas rl where rl.id = new.requisicion_linea_id;
  new.created_by := coalesce(new.created_by, (select auth.uid()));
  new.created_by_nombre := (select nombre from public.profiles where id = new.created_by);
  if new.tipo in ('devolucion', 'cambio') then
    select coalesce(sum(case when e.tipo = 'entregado' then e.cantidad else -e.cantidad end), 0)
      into v_entregado
      from public.requisicion_linea_eventos e
     where e.requisicion_linea_id = new.requisicion_linea_id and e.tipo in ('entregado', 'devolucion', 'cambio');
    if new.cantidad > v_entregado + 0.0001 then
      raise exception 'Solo se puede devolver lo entregado (% entregado).', v_entregado;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists requisicion_linea_eventos_antes on public.requisicion_linea_eventos;
create trigger requisicion_linea_eventos_antes
  before insert on public.requisicion_linea_eventos
  for each row execute function public.requisicion_linea_eventos_antes();

-- Al marcar entregado: si todos los renglones de la requisición quedaron
-- entregados completos, la requisición pasa a 'recibida'.
create or replace function public.requisicion_linea_eventos_avanza()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_etapa text;
  v_completa boolean;
begin
  if new.tipo <> 'entregado' then return new; end if;
  select etapa into v_etapa from public.requisiciones where id = new.requisicion_id and estado <> 'cancelada';
  if v_etapa is null or v_etapa = 'recibida' then return new; end if;
  select not exists (
    select 1 from public.requisicion_lineas rl
    where rl.requisicion_id = new.requisicion_id
      and coalesce((select sum(case when e.tipo = 'entregado' then e.cantidad else -e.cantidad end)
                    from public.requisicion_linea_eventos e
                    where e.requisicion_linea_id = rl.id and e.tipo in ('entregado', 'devolucion', 'cambio')), 0)
          < rl.cantidad_solicitada - 0.001
  ) into v_completa;
  if v_completa then
    update public.requisiciones set etapa = 'recibida', etapa_en = now(), etapa_por = v_uid where id = new.requisicion_id;
    insert into public.requisicion_etapas (requisicion_id, etapa, etapa_anterior, actor_id, actor_nombre, nota)
    values (new.requisicion_id, 'recibida', v_etapa, v_uid, (select nombre from public.profiles where id = v_uid), 'Todos los renglones marcados como entregados');
  end if;
  return new;
end;
$$;
drop trigger if exists requisicion_linea_eventos_avanza on public.requisicion_linea_eventos;
create trigger requisicion_linea_eventos_avanza
  after insert on public.requisicion_linea_eventos
  for each row execute function public.requisicion_linea_eventos_avanza();

alter table public.requisicion_linea_eventos enable row level security;

drop policy if exists frontera_organizacion on public.requisicion_linea_eventos;
create policy frontera_organizacion on public.requisicion_linea_eventos as restrictive for all
  using (exists (select 1 from public.requisicion_lineas rl join public.requisiciones r on r.id = rl.requisicion_id
                 where rl.id = requisicion_linea_eventos.requisicion_linea_id
                   and r.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])))
  with check (exists (select 1 from public.requisicion_lineas rl join public.requisiciones r on r.id = rl.requisicion_id
                      where rl.id = requisicion_linea_eventos.requisicion_linea_id
                        and r.empresa_id = any ((select public.auth_empresas_organizacion())::uuid[])));

-- Ve y marca quien ve el renglón (requisicion_lineas_select ya hereda de la
-- requisición: quien la pidió, almacén, empresa, responsable, admin…).
drop policy if exists requisicion_linea_eventos_select on public.requisicion_linea_eventos;
create policy requisicion_linea_eventos_select on public.requisicion_linea_eventos for select to authenticated
  using (exists (select 1 from public.requisicion_lineas rl where rl.id = requisicion_linea_eventos.requisicion_linea_id));

drop policy if exists requisicion_linea_eventos_insert on public.requisicion_linea_eventos;
create policy requisicion_linea_eventos_insert on public.requisicion_linea_eventos for insert to authenticated
  with check (created_by = (select auth.uid())
              and exists (select 1 from public.requisicion_lineas rl where rl.id = requisicion_linea_eventos.requisicion_linea_id));

-- Borrar una marca equivocada: quien la puso, o admin/corporativo. No se edita.
drop policy if exists requisicion_linea_eventos_delete on public.requisicion_linea_eventos;
create policy requisicion_linea_eventos_delete on public.requisicion_linea_eventos for delete to authenticated
  using (created_by = (select auth.uid()) or (select public.auth_rol_definer()) in ('admin', 'corporativo'));

drop trigger if exists solo_consulta on public.requisicion_linea_eventos;
create trigger solo_consulta before insert or update or delete on public.requisicion_linea_eventos
  for each statement execute function public.bloquear_solo_consulta();

grant select, insert, delete on public.requisicion_linea_eventos to authenticated;
