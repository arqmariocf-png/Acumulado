-- Prueba de 20261112090000_catalogos_backoffice_api.sql: los catálogos de
-- proveedores e items del backoffice (api_proveedores_aut / api_items_aut)
-- entran a `proveedores`, `proveedores_datos_bancarios` y `compras_items`
-- sin pisar lo capturado aquí; el texto libre de cuenta/CLABE se limpia; se
-- deduplica por clave / descripción; repetir no duplica; un usuario que no es
-- el admin maestro no puede llamarlas.

\set ON_ERROR_STOP on

\echo '── 0. Limpieza de cuenta / CLABE'
do $$
begin
  if public.fn_clabe_de_texto('Cuenta: 0112771810 CLABE: 012650001127718104') <> '012650001127718104' then raise exception 'FALLA clabe 1'; end if;
  if public.fn_cuenta_de_texto('Cuenta: 0112771810 CLABE: 012650001127718104') <> '0112771810' then raise exception 'FALLA cuenta 1'; end if;
  if public.fn_clabe_de_texto('Cuenta 044 293 2504  CLABE 012 650 0044 2932 5043') <> '012650004429325043' then raise exception 'FALLA clabe 2'; end if;
  if public.fn_cuenta_de_texto('Cuenta 044 293 2504  CLABE 012 650 0044 2932 5043') <> '0442932504' then raise exception 'FALLA cuenta 2'; end if;
  if public.fn_clabe_de_texto('002863701954045833') <> '002863701954045833' then raise exception 'FALLA clabe 3'; end if;
  if public.fn_cuenta_de_texto('002863701954045833') is not null then raise exception 'FALLA cuenta 3'; end if;
  if public.fn_clabe_de_texto('Cuenta, CLABE, CIE, Referencia, Etcétera...') is not null then raise exception 'FALLA clabe 4'; end if;
  if public.fn_cuenta_de_texto('Cuenta, CLABE, CIE, Referencia, Etcétera...') is not null then raise exception 'FALLA cuenta 4'; end if;
  if public.fn_clabe_de_texto('CLABE 002863701954045834') is not null then raise exception 'FALLA clabe 5 (dígito verificador)'; end if;
  if public.fn_cuenta_de_texto('4063065940') <> '4063065940' then raise exception 'FALLA cuenta 5'; end if;
  raise notice 'OK: cuenta y CLABE del texto libre';
end $$;

-- Ficha capturada aquí antes de la importación (su RFC y sus bancarios no se
-- pisan). Primero los bancarios: el trigger proveedores_rfc_a_bancarios crea
-- el renglón bancario al dar de alta la ficha con RFC.
insert into public.proveedores_datos_bancarios (clave, nombre, banco, clabe, rfc, grupo_id, origen)
values (public.fn_proveedor_clave('Ferretería Capturada SA de CV'), 'Ferretería Capturada SA de CV', 'BBVA', '072180012558129298', 'FCA010101AB1',
        (select id from public.grupos where codigo = 'LOMA'), 'captura');
insert into public.proveedores (grupo_id, nombre, rfc, telefono)
values ((select id from public.grupos where codigo = 'LOMA'), 'Ferretería Capturada SA de CV', 'FCA010101AB1', '2221234567');

\echo '── 1. Proveedores: alta, limpieza, dedupe y sin pisar lo capturado'
do $$
declare
  r jsonb;
  v record;
  datos jsonb := '[
    {"id": 1, "nombre_razon_social": "ADOCRETOS DE PUEBLA", "apellido": null, "RFC": "APU-860423-9U0", "banco": "BANCOMER",
     "cuenta": "Cuenta: 0192061058, CLABE: 012905001920610581", "direccon": "25 Poniente", "num_ext": "2112", "num_int": "B", "CP": "72440",
     "colonia": "Los Volcanes", "ciudad": "Puebla", "estado": "Puebla", "pais": "México", "correo": "Ventas@Adocretos.mx", "telefono": "2221112233", "activo": "activo"},
    {"id": 2, "nombre_razon_social": "adocretos de puebla", "apellido": null, "RFC": null, "banco": null, "cuenta": null, "direccon": null, "num_ext": null,
     "num_int": null, "CP": null, "colonia": null, "ciudad": null, "estado": null, "pais": null, "correo": null, "telefono": null, "activo": "activo"},
    {"id": 3, "nombre_razon_social": "FIAMMA EXTINTORES", "apellido": "Brenda Itzel Rivera Castro", "RFC": "no tiene", "banco": null,
     "cuenta": "Cuenta, CLABE, CIE, Referencia, Etcétera...", "direccon": null, "num_ext": null, "num_int": null, "CP": null, "colonia": null,
     "ciudad": null, "estado": null, "pais": null, "correo": null, "telefono": null, "activo": "activo"},
    {"id": 4, "nombre_razon_social": "DIEGO AGUIRRE SANCHEZ", "apellido": "AGUIRRE SANCHEZ", "RFC": null, "banco": "Banorte",
     "cuenta": "127650013107469783", "direccon": null, "num_ext": null, "num_int": null, "CP": null, "colonia": null, "ciudad": null, "estado": null,
     "pais": null, "correo": null, "telefono": null, "activo": "activo"},
    {"id": 5, "nombre_razon_social": "Ferretería Capturada SA de CV", "apellido": null, "RFC": "OTR010101XX1", "banco": "Santander",
     "cuenta": "CLABE: 014180655092059744", "direccon": "Calle 1", "num_ext": null, "num_int": null, "CP": null, "colonia": null, "ciudad": null,
     "estado": null, "pais": null, "correo": null, "telefono": "9999999999", "activo": "activo"},
    {"id": 6, "nombre_razon_social": "   ", "apellido": null, "RFC": null, "banco": null, "cuenta": null, "activo": "activo"}
  ]'::jsonb;
begin
  r := public.fn_proveedores_desde_api(datos);
  if (r ->> 'nuevos')::int <> 3 or (r ->> 'actualizados')::int <> 1 or (r ->> 'recibidos')::int <> 4 then
    raise exception 'FALLA: resultado %', r;
  end if;

  select * into v from public.proveedores where clave = public.fn_proveedor_clave('ADOCRETOS DE PUEBLA');
  if v.nombre <> 'ADOCRETOS DE PUEBLA' or v.backoffice_id <> 1 or v.rfc <> 'APU8604239U0'
     or v.domicilio <> '25 Poniente 2112 int. B, Los Volcanes, C.P. 72440, Puebla, Puebla'
     or v.correo <> 'ventas@adocretos.mx' or v.telefono <> '2221112233' or v.contacto is not null then
    raise exception 'FALLA: Adocretos % % % % %', v.nombre, v.backoffice_id, v.rfc, v.domicilio, v.correo;
  end if;
  select * into v from public.proveedores_datos_bancarios where clave = public.fn_proveedor_clave('ADOCRETOS DE PUEBLA');
  if v.clabe <> '012905001920610581' or v.cuenta <> '0192061058' or v.rfc <> 'APU8604239U0' or v.origen <> 'backoffice' or v.banco <> 'BANCOMER' then
    raise exception 'FALLA: bancarios Adocretos % % %', v.clabe, v.cuenta, v.rfc;
  end if;

  select * into v from public.proveedores where clave = public.fn_proveedor_clave('FIAMMA EXTINTORES');
  if v.contacto <> 'Brenda Itzel Rivera Castro' or v.rfc is not null then raise exception 'FALLA: Fiamma % %', v.contacto, v.rfc; end if;
  if exists (select 1 from public.proveedores_datos_bancarios where clave = public.fn_proveedor_clave('FIAMMA EXTINTORES')) then
    raise exception 'FALLA: Fiamma no debía tener renglón bancario';
  end if;

  select * into v from public.proveedores where clave = public.fn_proveedor_clave('DIEGO AGUIRRE SANCHEZ');
  if v.contacto is not null then raise exception 'FALLA: apellido repetido en el nombre no es contacto'; end if;
  select * into v from public.proveedores_datos_bancarios where clave = public.fn_proveedor_clave('DIEGO AGUIRRE SANCHEZ');
  if v.clabe <> '127650013107469783' or v.cuenta is not null then raise exception 'FALLA: CLABE suelta % %', v.clabe, v.cuenta; end if;

  select * into v from public.proveedores where clave = public.fn_proveedor_clave('Ferretería Capturada SA de CV');
  if v.rfc <> 'FCA010101AB1' or v.telefono <> '2221234567' or v.domicilio <> 'Calle 1' or v.backoffice_id <> 5 then
    raise exception 'FALLA: la ficha capturada se pisó % % %', v.rfc, v.telefono, v.domicilio;
  end if;
  select * into v from public.proveedores_datos_bancarios where clave = public.fn_proveedor_clave('Ferretería Capturada SA de CV');
  if v.origen <> 'captura' or v.clabe <> '072180012558129298' or v.banco <> 'BBVA' or v.rfc <> 'FCA010101AB1' then
    raise exception 'FALLA: bancarios capturados se pisaron % % %', v.origen, v.clabe, v.banco;
  end if;

  r := public.fn_proveedores_desde_api(datos);
  if (r ->> 'nuevos')::int <> 0 or (r ->> 'actualizados')::int <> 0 or (r ->> 'bancarios')::int <> 0 then
    raise exception 'FALLA: repetir cambió algo %', r;
  end if;
  raise notice 'OK: proveedores % ', r;
end $$;

\echo '── 2. Items: alta, dedupe por descripción, precio s/IVA, servicio, inactivos fuera'
insert into public.compras_items (grupo_id, descripcion, unidad, precio_referencia)
values ((select id from public.grupos where codigo = 'LOMA'), 'Cemento gris 50 kg', 'SACO', 200);
do $$
declare
  r jsonb;
  v record;
  datos jsonb := '[
    {"id": 10, "descripcion": "LÁMINA NEGRA CAL 18 4 X 10", "unidad": "PZA", "categoria": "Despalme", "familia": "Otros", "lleva_iva": 1,
     "ultimo_costo": 1160, "fecha_costo": "2026-10-19 12:28:28", "id_proveedor": 1, "proveedor": "FERRETERIA ZAPATA", "activo": 1},
    {"id": 11, "descripcion": "Lámina   negra cal 18 4 x 10", "unidad": "PZA", "categoria": null, "familia": "Otros", "lleva_iva": 1,
     "ultimo_costo": 2320, "fecha_costo": "2026-09-01 10:00:00", "id_proveedor": 1, "proveedor": "OTRO", "activo": 1},
    {"id": 12, "descripcion": "Constancia de terminación de obra", "unidad": "SRV", "categoria": "Despalme", "familia": "Servicio", "lleva_iva": 1,
     "ultimo_costo": 24966, "fecha_costo": "2026-10-16 16:09:46", "id_proveedor": 2, "proveedor": "TESORERIA MUNICIPAL", "activo": 1},
    {"id": 13, "descripcion": "TABIQUE", "unidad": "PZA", "categoria": null, "familia": "Agregados", "lleva_iva": 0,
     "ultimo_costo": 2.7, "fecha_costo": "2026-09-21 17:33:21", "id_proveedor": 3, "proveedor": "HUMBERTO FLORES", "activo": 1},
    {"id": 14, "descripcion": "Item dado de baja", "unidad": "PZA", "categoria": null, "familia": "Otros", "lleva_iva": 1,
     "ultimo_costo": 10, "fecha_costo": "2026-09-21 17:33:21", "id_proveedor": 3, "proveedor": "X", "activo": 2},
    {"id": 15, "descripcion": "CEMENTO GRIS 50 KG", "unidad": "PZA", "categoria": null, "familia": "Polvos", "lleva_iva": 1,
     "ultimo_costo": 232, "fecha_costo": "2026-10-01 00:00:00", "id_proveedor": 4, "proveedor": "CEMEX", "activo": 1}
  ]'::jsonb;
begin
  r := public.fn_items_desde_api(datos);
  if (r ->> 'nuevos')::int <> 3 or (r ->> 'actualizados')::int <> 1 or (r ->> 'recibidos')::int <> 4 then
    raise exception 'FALLA: resultado %', r;
  end if;

  select * into v from public.compras_items where public.normalizar_texto_sql(descripcion) = public.normalizar_texto_sql('LÁMINA NEGRA CAL 18 4 X 10');
  if v.backoffice_id <> 10 or v.precio_referencia <> 1000 or v.categoria <> 'material' or not v.iva or v.unidad <> 'PZA' or v.clave !~ '^IT-\d{4}$' then
    raise exception 'FALLA: lámina % % % %', v.backoffice_id, v.precio_referencia, v.categoria, v.clave;
  end if;
  if v.notas not like '%familia: Otros%' or v.notas not like '%último proveedor: FERRETERIA ZAPATA%' then raise exception 'FALLA: notas %', v.notas; end if;

  select * into v from public.compras_items where backoffice_id = 12;
  if v.categoria <> 'servicio' or v.precio_referencia <> 21522.41 then raise exception 'FALLA: servicio % %', v.categoria, v.precio_referencia; end if;

  select * into v from public.compras_items where backoffice_id = 13;
  if v.iva or v.precio_referencia <> 2.70 then raise exception 'FALLA: tabique sin IVA % %', v.iva, v.precio_referencia; end if;

  if exists (select 1 from public.compras_items where backoffice_id = 14) then raise exception 'FALLA: entró un item dado de baja'; end if;

  select * into v from public.compras_items where backoffice_id = 15;
  if v.descripcion <> 'Cemento gris 50 kg' or v.unidad <> 'SACO' or v.precio_referencia <> 200 then
    raise exception 'FALLA: el item capturado se pisó % % %', v.descripcion, v.unidad, v.precio_referencia;
  end if;

  r := public.fn_items_desde_api(datos);
  if (r ->> 'nuevos')::int <> 0 or (r ->> 'actualizados')::int <> 0 then raise exception 'FALLA: repetir cambió algo %', r; end if;
  raise notice 'OK: items %', r;
end $$;

\echo '── 3. Un usuario que no es el admin maestro no puede importar'
insert into auth.users (id, email) values ('cbcbcbcb-0000-0000-0000-000000000001', 'direccion.catalogos@test');
update public.profiles set nombre = 'Dirección catálogos', rol = 'direccion', todas_las_empresas = true,
  grupo_id = (select id from public.grupos where codigo = 'LOMA') where id = 'cbcbcbcb-0000-0000-0000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', 'cbcbcbcb-0000-0000-0000-000000000001', false);
do $$
begin
  begin
    perform public.fn_proveedores_desde_api('[]'::jsonb);
    raise exception 'FALLA: dirección pudo llamar fn_proveedores_desde_api';
  exception when insufficient_privilege then
    raise notice 'OK: dirección bloqueada (%)', sqlerrm;
  end;
  begin
    perform public.fn_items_desde_api('[]'::jsonb);
    raise exception 'FALLA: dirección pudo llamar fn_items_desde_api';
  exception when insufficient_privilege then
    raise notice 'OK: dirección bloqueada en items';
  end;
end $$;
reset role;
