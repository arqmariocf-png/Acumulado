-- Proyectos al día con el backoffice (Mario, 1-oct-2026: "¿cómo mantengo los
-- proyectos actualizados? no me sale PASEO 6 AMPLIACION y ya está en
-- backoffice"). El catálogo de proyectos se sembró una sola vez (Excel
-- maestro, 27-ago) y nada lo alimentaba después; el backoffice sí manda el
-- nombre del proyecto en cada OC (Proyecto) y OV (Project).
--
-- fn_proyectos_desde_backoffice(): da de alta los nombres que aparecen en
-- OC/OV del backoffice y no existen como proyecto (comparación sin
-- mayúsculas ni espacios de más). Empresa = la que más documentos tiene con
-- ese nombre; cliente = el de su OV más reciente. "PROYECTO X" no se da de
-- alta (es la bolsa genérica del backoffice). Nunca modifica ni borra
-- proyectos existentes. Corre al final de la sincronización horaria.

create or replace function public.fn_proyectos_desde_backoffice()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  with docs as (
    select empresa_id, trim(proyecto) as nombre, fecha_creacion as fecha, null::text as cliente
      from public.ordenes_compra where fuente = 'api' and nullif(trim(proyecto), '') is not null
    union all
    select empresa_id, trim(proyecto), fecha_ov, cliente
      from public.ordenes_venta where fuente = 'api' and nullif(trim(proyecto), '') is not null
  ), por_empresa as (
    select upper(nombre) as clave, empresa_id, count(*) as n
      from docs group by 1, 2
  ), elegido as (
    select distinct on (clave) clave, empresa_id from por_empresa order by clave, n desc, empresa_id
  ), nuevos as (
    select e.clave, e.empresa_id,
      (select d.nombre from docs d where upper(d.nombre) = e.clave order by d.fecha desc nulls last limit 1) as nombre,
      (select d.cliente from docs d where upper(d.nombre) = e.clave and d.cliente is not null order by d.fecha desc nulls last limit 1) as cliente
    from elegido e
    where e.clave <> 'PROYECTO X'
      and not exists (select 1 from public.proyectos p where upper(trim(p.nombre)) = e.clave)
  )
  insert into public.proyectos (nombre, empresa_id, cliente, activo)
  select nombre, empresa_id, cliente, true from nuevos;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.fn_proyectos_desde_backoffice() from public, anon, authenticated;

-- Al final de la sincronización horaria (ya aplicado en producción).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.alter_job(jobid, command := 'set statement_timeout = ''10min''; select public.sincronizar_catalogo_oc_ov(); select public.fn_proyectos_desde_backoffice();')
    from cron.job where jobname = 'sync-catalogo-oc-ov-horario';
  end if;
end $$;
