-- Membrete por empresa (Mario, 3/5-oct-2026: "cotización de Clavicón en hoja
-- membretada, con todos los datos de Clavicón para que se vea oficial y los
-- datos bancarios"). Datos públicos de la empresa que salen impresos en
-- cotizaciones, remisiones y órdenes de compra: razón social, domicilio
-- fiscal, teléfono, correo y la cuenta para depósitos (banco, cuenta, CLABE,
-- sucursal). Van en `empresas` porque los lee quien imprime (planta, almacén)
-- y no son secretos: se entregan al cliente para que pague. El logo vive en
-- web/public/logos/<codigo en minúsculas>.png.
--
-- Clavicón (MCC) se llena con su hoja membretada (Dropbox, Formatos) y su
-- hoja "DATOS BANCARIOS" (BBVA, CLABE validada con dígito verificador).
--
-- Ya aplicado en producción.

alter table public.empresas
  add column if not exists razon_social text,
  add column if not exists domicilio_fiscal text,
  add column if not exists telefono text,
  add column if not exists correo text,
  add column if not exists banco text,
  add column if not exists cuenta_bancaria text,
  add column if not exists clabe text,
  add column if not exists sucursal_bancaria text;

alter table public.empresas drop constraint if exists empresas_clabe_formato;
alter table public.empresas add constraint empresas_clabe_formato
  check (clabe is null or clabe ~ '^[0-9]{18}$');

update public.empresas set
  razon_social = 'MALLAS Y CLAVOS CLAVICON, S.A. DE C.V.',
  rfc = coalesce(rfc, 'MCC1801231U3'),
  domicilio_fiscal = 'Calle 20 de Noviembre No. 911, Col. San Bernardino Tlaxcalancingo, San Andrés Cholula, Puebla, C.P. 72820',
  telefono = '222 762 9385',
  correo = 'mallasyclavosclavicon@gmail.com',
  banco = 'BBVA (Bancomer)',
  cuenta_bancaria = '0112736381',
  clabe = '012650001127363818',
  sucursal_bancaria = '0511'
where codigo = 'MCC';
