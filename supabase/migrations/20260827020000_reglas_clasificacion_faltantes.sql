-- Reglas de clasificación que faltaban, encontradas revisando el Excel
-- maestro real de Delia (Acumulado_de_bancos_2026.xlsx, hoja "DB", ~4,800
-- movimientos reales de enero-agosto 2026 en las 8 empresas): categorías que
-- ella ya clasifica a mano como "no requiere factura" pero que el motor
-- todavía no reconocía. En todos los casos confirmados contra ese archivo,
-- "Nombre o Razón Social" es el banco mismo (BBVA, Banorte, Santander, Unión
-- de Crédito General) -- son operaciones bancarias internas (tarjeta
-- empresarial, disposición de crédito, pago a capital, retención, apertura
-- de cuenta), nunca un proveedor real, igual que TRASPASO/COMISION/RENTA.
--
-- DEVOLUCION PRESTAMO se agrega en orden 65 (entre DEPOSITO ERROR=60 y
-- DEVOLUCION=70) para que la etiqueta específica gane sobre la genérica
-- "N/A - DEVOLUCION", igual que ya hacen DEVOLUCION ERROR/DEPOSITO ERROR.
--
-- Deliberadamente NO se agrega una regla para "INTERES"/"INTERESES": en el
-- archivo real esas dos palabras tienen comportamiento distinto (INTERES
-- singular siempre sin factura real, INTERESES plural a veces sí trae una
-- factura/CFDI real) y como la búsqueda es por substring, una regla
-- "INTERES" atraparía ambas -- se deja sin clasificar (pendiente_revision,
-- el default seguro) en vez de arriesgar suprimir el cruce de factura en un
-- caso que sí la necesita. Tampoco se agrega "DOLARES": en el archivo real
-- no es una categoría de movimiento, es como Delia anota que una cuenta en
-- dólares no tuvo actividad ("Sin movimientos | DOLARES").
insert into public.reglas_clasificacion (palabra_clave, etiqueta, orden) values
  ('DEVOLUCION PRESTAMO', 'N/A - DEVOLUCION PRESTAMO INTERCOMPAÑIA', 65),
  ('TARJETA', 'N/A - TARJETA DE CRÉDITO EMPRESARIAL', 140),
  ('DISPOSICION', 'N/A - DISPOSICION DE CREDITO/EFECTIVO', 150),
  ('PAGO A CAPITAL', 'N/A - PAGO A CAPITAL (PRÉSTAMO BANCARIO)', 160),
  ('RETENCION', 'N/A - RETENCION BANCARIA', 170),
  ('APERTURA', 'N/A - APERTURA DE CUENTA/DIVISA', 180);
