-- Resumen físico-financiero de obras también para el rol empresa
-- (20-oct-2026, Mario: "agrega la pestaña de proyectos a Jorge"). Jorge
-- (empresa, ERG) ya veía Proyectos y cada obra, pero el resumen de todas las
-- obras de arriba solo lo veían el admin maestro y dirección. Ahora también el
-- rol empresa, acotado a las empresas de su alcance (Jorge: solo ERG).
-- Reescrita por reemplazo sobre la definición vigente.
-- Ya aplicado en producción (resumen_obras_rol_empresa).

do $x$
declare d text; n text;
begin
  d := pg_get_functiondef('public.fn_resumen_obras_director()'::regprocedure);
  n := replace(d, $r$public.auth_rol()::text = 'direccion' and e.id = any (public.auth_empresas_alcance())$r$,
                  $r$public.auth_rol()::text in ('direccion', 'empresa') and e.id = any (public.auth_empresas_alcance())$r$);
  if n = d then raise exception 'fn_resumen_obras_director no tenía la guarda de dirección esperada'; end if;
  execute n;
end $x$;
