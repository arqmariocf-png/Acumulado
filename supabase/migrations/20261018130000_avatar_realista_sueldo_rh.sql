-- 18-oct-2026 (Mario):
--  1) "El avatar me gustaría más realista": además del pixel-art (PNG) se
--     acepta un retrato realista retocado en el navegador (JPEG de 192 px).
--     Mismo tope de 60 KB.
--  2) "En recursos humanos Raúl, Eréndira y Fernando estipulan el salario de
--     cada uno de los trabajadores": el sueldo semanal de la cuenta de nómina
--     solo lo fija RH (o el admin). Dirección sigue autorizando líneas, pero
--     con el sueldo que puso RH o el del contrato vigente. Queda quién y
--     cuándo lo fijó.
-- Ya aplicado en producción (avatar_realista_sueldo_rh).

alter table public.personajes drop constraint if exists personajes_avatar_check;
alter table public.personajes add constraint personajes_avatar_check
  check ((avatar like 'data:image/png;base64,%' or avatar like 'data:image/jpeg;base64,%') and length(avatar) <= 60000);

alter table public.cuentas_nomina
  add column if not exists sueldo_por uuid references auth.users (id),
  add column if not exists sueldo_por_nombre text,
  add column if not exists sueldo_en timestamptz;

create or replace function public.cuentas_nomina_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_deuda numeric; v_contrato numeric;
begin
  select grupo_id into new.grupo_id from public.profiles where id = new.profile_id;
  if new.grupo_id is null then raise exception 'La persona no tiene organización.'; end if;
  if new.sueldo_semanal is distinct from (case when tg_op = 'INSERT' then null else old.sueldo_semanal end) then
    if auth.uid() is not null and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol in ('rh', 'admin')) then
      select ct.sueldo_semanal into v_contrato
        from public.contrataciones ct join public.personal pe on pe.id = ct.personal_id
       where pe.profile_id = new.profile_id and ct.estatus = 'vigente'
       order by ct.fecha_inicio desc nulls last limit 1;
      if new.sueldo_semanal is distinct from v_contrato then
        raise exception 'El sueldo semanal lo fija Recursos Humanos.';
      end if;
    end if;
    new.sueldo_por := auth.uid();
    new.sueldo_en := now();
    select nullif(btrim(nombre), '') into new.sueldo_por_nombre from public.profiles where id = auth.uid();
  end if;
  if new.linea > 0 then
    if new.sueldo_semanal is null then raise exception 'Captura el sueldo semanal antes de autorizar una línea.'; end if;
    select deuda_maxima into v_deuda from public.fn_nomina_topes(new.grupo_id, new.sueldo_semanal);
    if new.linea > v_deuda + 0.005 then
      raise exception 'La línea (%) pasa del salario de un mes (%): art. 110-I LFT.', new.linea, v_deuda;
    end if;
  end if;
  if tg_op = 'INSERT' or new.linea is distinct from old.linea or new.nivel is distinct from old.nivel or new.plazo_max_semanas is distinct from old.plazo_max_semanas then
    new.autorizada_por := auth.uid();
    new.autorizada_en := now();
    select nullif(btrim(nombre), '') into new.autorizada_por_nombre from public.profiles where id = auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
