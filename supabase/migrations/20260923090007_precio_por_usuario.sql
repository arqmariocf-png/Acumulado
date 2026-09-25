-- ── Cobro por usuario, con escalones por volumen ────────────────────────
--
-- Cambia el modelo: antes era una mensualidad fija por organización; ahora se
-- cobra POR USUARIO, y el precio unitario baja al llegar a ciertos paquetes.
--
--   1 a 4 usuarios   $1,500 c/u
--   5 a 9 usuarios   $1,300 c/u
--   10 a 19 usuarios $1,100 c/u
--   20 o más         $900 c/u
--
-- El escalón aplica a TODOS los usuarios, no solo a los adicionales: al llegar
-- a 5, los cinco pagan $1,300. Es lo que la gente entiende por "paquete" y da
-- un incentivo claro para pasar de 4 a 5. (En Stripe esto es una tarifa
-- escalonada con tiers_mode=volume; nosotros solo mandamos la cantidad.)
--
-- Los escalones son DATOS, no código: cambiar precios o agregar un escalón es
-- un renglón en esta tabla, no una migración de lógica.

create table public.plan_escalones (
  plan_clave text not null references public.planes (clave) on delete cascade,
  desde_usuarios integer not null check (desde_usuarios >= 1),
  precio_unitario_centavos integer not null check (precio_unitario_centavos >= 0),
  primary key (plan_clave, desde_usuarios)
);

comment on table public.plan_escalones is
  'Precio unitario por escalón de volumen. Aplica el escalón más alto cuyo desde_usuarios no rebase el número de usuarios facturables, y ese precio se cobra por TODOS los usuarios.';

insert into public.plan_escalones (plan_clave, desde_usuarios, precio_unitario_centavos) values
  ('estandar', 1, 150000),
  ('estandar', 5, 130000),
  ('estandar', 10, 110000),
  ('estandar', 20, 90000);

-- La mensualidad fija deja de existir: el precio sale de los escalones y del
-- número de usuarios. Dejarla ahí sería una segunda fuente de verdad que se
-- desincroniza en cuanto alguien cambie un precio en un solo lado.
-- v_suscripcion la leía, así que cae primero y se rehace más abajo.
drop view public.v_suscripcion;
alter table public.planes drop column precio_mensual_centavos;

-- ── Quién cuenta para la factura ────────────────────────────────────────
-- Solo usuarios activos con rol asignado. Un usuario recién registrado que
-- todavía nadie autorizó ('pendiente') no se cobra -- si no, cualquiera que se
-- registre solo le subiría la cuenta al cliente. Y desactivar a alguien tiene
-- que bajar la factura el mes siguiente, o el cliente no tiene forma de
-- dejar de pagar por quien ya no trabaja ahí.
-- El conteo real vive en una sola función. No se expone: Supabase publica por
-- RPC toda función de `public`, y sin esto cualquier usuario autenticado
-- podría preguntar cuánta gente tiene la organización de otro -- que es
-- exactamente cuánto le están cobrando a la competencia.
create or replace function public.usuarios_facturables_interno(p_grupo_id uuid)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::integer
  from public.profiles p
  where p.grupo_id = p_grupo_id
    and p.activo
    and p.rol <> 'pendiente'
$$;

revoke execute on function public.usuarios_facturables_interno(uuid) from public;
-- Los edge functions la llaman con la service_role key para mandarle la
-- cantidad a la pasarela; ahí no hay sesión de usuario contra la cual acotar.
grant execute on function public.usuarios_facturables_interno(uuid) to service_role;

-- La versión pública sí responde, pero solo de la organización propia: es la
-- que usa la vista, que corre como el usuario que consulta.
create or replace function public.usuarios_facturables(p_grupo_id uuid)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select case
    when public.grupo_en_alcance(p_grupo_id) then public.usuarios_facturables_interno(p_grupo_id)
    else 0
  end
$$;

create or replace function public.precio_unitario_centavos(p_plan_clave text, p_usuarios integer)
returns integer
language sql
stable
set search_path = public
as $$
  select e.precio_unitario_centavos
  from public.plan_escalones e
  where e.plan_clave = p_plan_clave
    and e.desde_usuarios <= greatest(coalesce(p_usuarios, 0), 1)
  order by e.desde_usuarios desc
  limit 1
$$;

-- ── Vista de suscripción, ahora con el desglose ─────────────────────────
-- Se rehace completa: cambia el juego de columnas, y de todos modos ya se
-- había tenido que tirar para poder quitar precio_mensual_centavos.
create view public.v_suscripcion with (security_invoker = true) as
select
  s.grupo_id,
  s.plan_clave,
  p.nombre as plan_nombre,
  p.moneda,
  public.usuarios_facturables(s.grupo_id) as usuarios_facturables,
  public.precio_unitario_centavos(s.plan_clave, public.usuarios_facturables(s.grupo_id)) as precio_unitario_centavos,
  public.usuarios_facturables(s.grupo_id)
    * public.precio_unitario_centavos(s.plan_clave, public.usuarios_facturables(s.grupo_id)) as total_mensual_centavos,
  s.estado,
  s.periodo_fin,
  s.gracia_hasta,
  s.dias_gracia,
  s.pasarela,
  s.metodo_pago_marca,
  s.metodo_pago_ultimos4,
  public.suscripcion_permite_escribir(s.grupo_id) as puede_escribir,
  case
    when s.estado = 'periodo_gracia' then s.gracia_hasta
    when s.estado in ('activa', 'prueba') then s.periodo_fin
  end as escribe_hasta
from public.suscripciones s
join public.planes p on p.clave = s.plan_clave;

alter table public.plan_escalones enable row level security;

create policy plan_escalones_select on public.plan_escalones
  for select using (public.auth_rol() <> 'pendiente');

create policy plan_escalones_insert on public.plan_escalones for insert with check (public.auth_admin_global());
create policy plan_escalones_update on public.plan_escalones for update using (public.auth_admin_global()) with check (public.auth_admin_global());
create policy plan_escalones_delete on public.plan_escalones for delete using (public.auth_admin_global());
