-- Aviso push cuando alguien se anota en el comedor (19-nov-2026, Mario:
-- "notifícame si se anotan en comedor").
--
-- `comedor_config.aviso_pedidos_a` = a quién se le avisa (LOMA: Mario). El
-- trigger `comedor_pedidos_aviso` es un constraint trigger DIFERIDO: corre al
-- confirmar la transacción, cuando `fn_comedor_pedir` ya insertó los renglones
-- del pedido, así el aviso dice qué pidió. Avisa al pedir (insert o un pedido
-- cancelado que vuelve a 'pedido') y al cancelar; nunca a quien pidió. Va por
-- `fn_push_aviso` (nunca falla la transacción). Se cambia la lista por SQL.
-- Ya aplicada en producción como `comedor_aviso_pedidos`.

alter table public.comedor_config add column if not exists aviso_pedidos_a uuid[] not null default '{}';

update public.comedor_config c
   set aviso_pedidos_a = array['e0268126-4fa1-4415-8553-b9cff72b1db7'::uuid]
 where c.grupo_id = (select id from public.grupos where codigo = 'LOMA')
   and coalesce(array_length(c.aviso_pedidos_a, 1), 0) = 0
   and exists (select 1 from public.profiles p where p.id = 'e0268126-4fa1-4415-8553-b9cff72b1db7'::uuid);

create or replace function public.comedor_pedidos_aviso()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_a uuid[];
  v_grupo uuid;
  v_platillos text;
  v_fecha text;
  v_cuando text;
  v_titulo text;
  v_cuerpo text;
begin
  if tg_op = 'UPDATE' and old.estado = new.estado then return null; end if;
  if new.estado not in ('pedido', 'cancelado') then return null; end if;
  select e.grupo_id into v_grupo from public.empresas e where e.id = new.empresa_id;
  select array_remove(c.aviso_pedidos_a, new.profile_id) into v_a from public.comedor_config c where c.grupo_id = v_grupo;
  if v_a is null or array_length(v_a, 1) is null then return null; end if;
  select string_agg(case when l.cantidad > 1 then l.cantidad || ' × ' else '' end || l.nombre, ', ' order by l.nombre)
    into v_platillos from public.comedor_pedido_lineas l where l.pedido_id = new.id;
  v_fecha := to_char(new.fecha, 'DD/MM');
  v_cuando := case when new.fecha = (now() at time zone 'America/Mexico_City')::date then 'hoy'
                   when new.fecha = (now() at time zone 'America/Mexico_City')::date + 1 then 'mañana ' || v_fecha
                   else 'el ' || v_fecha end;
  if new.estado = 'cancelado' then
    v_titulo := 'Comedor: pedido cancelado';
    v_cuerpo := coalesce(new.trabajador_nombre, 'Alguien') || ' canceló su comida de ' || v_cuando || '.';
  else
    v_titulo := 'Comedor: alguien se anotó';
    v_cuerpo := coalesce(new.trabajador_nombre, 'Alguien') || ' pidió ' || coalesce(v_platillos, 'comida') || ' para ' || v_cuando
             || coalesce(' · ' || nullif(new.nota, ''), '') || '.';
  end if;
  perform public.fn_push_aviso(v_a, v_titulo, v_cuerpo, '/comedor?tab=cocina');
  return null;
end $$;

create constraint trigger comedor_pedidos_aviso
  after insert or update of estado on public.comedor_pedidos
  deferrable initially deferred
  for each row execute function public.comedor_pedidos_aviso();
