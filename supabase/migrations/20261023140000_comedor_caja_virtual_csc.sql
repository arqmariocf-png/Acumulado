-- El comedor ya no es empresa (23-oct-2026, Mario: "comedor, por el momento
-- sácalo como empresa porque no va a contabilizar; solo será una caja virtual
-- para descuentos vía nómina y para llevar el control del área, y estaría
-- dentro de CSC"). La empresa COM se desactiva (no tenía cuentas, perfiles,
-- órdenes, platillos ni pedidos) y el comedor queda colgado de CSC:
-- comedor_config.empresa_id = CSC; los platillos, menús y pedidos nuevos van
-- con esa empresa. El descuento sigue yendo a la empresa de cada trabajador.
--
-- Ya aplicado en producción (comedor_caja_virtual_csc).

update public.comedor_config c
   set empresa_id = csc.id, updated_at = now(),
       notas = coalesce(c.notas || ' · ', '') || 'Caja virtual dentro de CSC desde 23-oct-2026; no contabiliza como empresa.'
  from public.empresas com, public.empresas csc
 where c.empresa_id = com.id and com.codigo = 'COM' and csc.codigo = 'CSC' and csc.grupo_id = com.grupo_id;

update public.comedor_platillos p set empresa_id = csc.id
  from public.empresas com, public.empresas csc
 where p.empresa_id = com.id and com.codigo = 'COM' and csc.codigo = 'CSC' and csc.grupo_id = com.grupo_id;

update public.comedor_menu m set empresa_id = csc.id
  from public.empresas com, public.empresas csc
 where m.empresa_id = com.id and com.codigo = 'COM' and csc.codigo = 'CSC' and csc.grupo_id = com.grupo_id;

update public.comedor_pedidos p set empresa_id = csc.id
  from public.empresas com, public.empresas csc
 where p.empresa_id = com.id and com.codigo = 'COM' and csc.codigo = 'CSC' and csc.grupo_id = com.grupo_id;

update public.empresas set activo = false, nombre = 'Comedor (caja virtual, dentro de CSC)' where codigo = 'COM';
