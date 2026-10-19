-- "Proyecto X" al capturar órdenes (20-oct-2026, Laura: "no me sale proyecto X
-- en la base de datos de las empresas para subir OC"). fn_ordenes_catalogo_captura
-- lo quitaba a propósito de la lista de obras, pero en el backoffice es el
-- proyecto de lo que no es de una obra (301 OC en 7 empresas al 16-oct). Ahora
-- sale siempre, en cualquier empresa. Se reescribe por reemplazo sobre la
-- definición vigente. Ya aplicado en producción (catalogo_obras_proyecto_x).

do $x$
declare d text; n text;
begin
  d := pg_get_functiondef('public.fn_ordenes_catalogo_captura(boolean,uuid)'::regprocedure);
  n := replace(d, $r$     where public.normalizar_texto_sql(o.nombre) <> 'PROYECTO X'
$r$, '');
  n := replace(n, $r$        union all select p.nombre, null::date from public.proyectos p where p.activo and p.empresa_id = p_empresa
$r$, $r$        union all select p.nombre, null::date from public.proyectos p where p.activo and p.empresa_id = p_empresa
        union all select 'Proyecto X', null::date
$r$);
  if n = d or position('PROYECTO X' in n) > 0 then
    raise exception 'fn_ordenes_catalogo_captura no tenía la exclusión de Proyecto X esperada';
  end if;
  execute n;
end $x$;
