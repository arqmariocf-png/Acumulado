-- Datos base del spec (sección 1, 4.3, 4.4). Semilla, no fixtures de prueba:
-- esto es lo mínimo para que la app arranque con el catálogo real de empresas
-- y las reglas de clasificación ya validadas en el proceso manual.

insert into public.empresas (nombre, codigo) values
  ('Aceros y Envasados de Puebla', 'AEP'),
  ('Ergodinova', 'ERG'),
  ('Constructora, Supervisión y Consultoría LOMA', 'CSC'),
  ('Mario Contreras Farfán', 'MCF'),
  ('Loma Racing Team', 'LRT'),
  ('QX Soluciones Globales en Tecnología y Software Empresarial', 'QX'),
  ('Vigueta Bovedilla y Bloques Balken', 'VBB'),
  ('Mallas y Clavos Clavicón', 'MCC');

insert into public.reglas_clasificacion (palabra_clave, etiqueta, orden) values
  ('TRASPASO', 'N/A - TRASPASO ENTRE CUENTAS PROPIAS', 10),
  ('COMISION', 'N/A - COMISION BANCARIA', 20),
  ('PRESTAMO', 'N/A - PRESTAMO INTERCOMPAÑIA', 30),
  ('SYS', 'N/A - NOMINA (SUELDOS Y SALARIOS)', 40),
  ('DEVOLUCION ERROR', 'N/A - DEVOLUCION POR ERROR', 50),
  ('DEPOSITO ERROR', 'N/A - DEPOSITO POR ERROR', 60),
  ('DEVOLUCION', 'N/A - DEVOLUCION', 70),
  ('ESCRITURA', 'N/A - PAGO NOTARIAL/ESCRITURA', 80),
  ('RENTA', 'N/A - RENTA', 90),
  ('FINIQUITO', 'N/A - FINIQUITO LABORAL', 100),
  ('COMPENSACION', 'N/A - COMPENSACION', 110),
  ('RECUPERACION CREDITO', 'N/A - RECUPERACION CREDITO', 120),
  ('SIN MOVIMIENTOS', 'N/A - SIN MOVIMIENTOS', 130);

comment on table public.reglas_clasificacion is
  'orden importa: DEVOLUCION ERROR/DEPOSITO ERROR deben evaluarse antes que DEVOLUCION a secas para no perder la etiqueta más específica.';

insert into public.excepciones_proveedor (proveedor, descripcion_regla, hasta_mes_siguiente, dias_tolerancia) values
  ('BBVA México', 'Factura hasta el mes siguiente', true, null),
  ('CEMEX', 'Complemento de pago dentro del mes o hasta 5 días después del corte', false, 5),
  ('Bodega Cruz Azul del Centro', 'Complemento de pago dentro del mes o hasta 5 días después del corte', false, 5);
