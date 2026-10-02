import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cifraYLetra,
  docContratoCredito,
  faltantesContrato,
  fechaCifraYLetra,
  fechaEnLetras,
  htmlContratoCredito,
  interesEnLetras,
  letraYCifra,
  montoEnLetras,
  nombreArchivoContrato,
  numeroALetras,
  sociedadEntreComillas,
  textoContrato,
  textoFirma,
  type DatosContrato,
} from "./contratoCredito.ts";

// Los datos del contrato que mandaron los abogados (AEP → RAMSICON).
const RAMSICON: DatosContrato = {
  folio: "CTO-AEP-0001",
  proveedor: {
    razon_social: "ACEROS Y ENVASADOS DE PUEBLA, S.A. DE C.V.",
    representante_nombre: "ERENDIRA SOLIS TECUATL",
    representante_puesto: "ADMINISTRADOR ÚNICO",
    representante_tratamiento: "LA C.",
    representante_titulo: "LICENCIADA",
    objeto_social: "comercialización, distribución, importación, exportación",
    rfc: "AEL131023CS1",
    constitucion: { numero: "7354", volumen: "1126", fecha: "2013-10-23", notario: "Licenciado Arturo Díaz González", notaria: "43", distrito: "Puebla" },
    poderes: { numero: "43752", volumen: "500", fecha: "2018-05-08", notario: "Licenciada María Emilia Sesma Téllez", notaria: "3", distrito: "Cholula, Puebla" },
    domicilio: "Prolongación 13 oriente número 1823, San Bernardino Tlaxcalancingo, San Andrés Cholula, Puebla, código postal 72820",
    correo: "arq.mariocf@gmail.com",
    telefono: "222 136 65 80",
  },
  comprador: {
    razon_social: "RAMSICON, S.A. DE C.V.",
    tipo_persona: "moral",
    representante_nombre: "MANUEL RAMÍREZ SAINZ",
    representante_cargo: "APODERADO LEGAL",
    representante_tratamiento: "EL C.",
    rfc: "RAM0210042V9",
    domicilio_legal: "Vía Atlixcayotl número 6511, interior 38, San Andrés Cholula, Puebla, Código Postal 72820",
    correos: "marthazm@ramsicon.com ; manuelrs@ramsicon.com",
    telefonos: "222 263 7762 / 222 263 7749",
    obligado_solidario_nombre: "MANUEL RAMÍREZ SAINZ",
    legales: {
      constitutiva_numero: "12652",
      constitutiva_volumen: "182",
      constitutiva_fecha: "2002-10-04",
      constitutiva_notaria: "33",
      constitutiva_ciudad: "Puebla, Puebla",
      registro_lugar: "Puebla",
      registro_numero: "1,862",
      registro_tomo: "2002",
      registro_fecha: "2002-11-11",
      poder_numero: "71040",
      poder_volumen: "1454",
      poder_fecha: "2018-09-06",
      poder_notario: "MARIO SALAZAR MARTÍNEZ",
      poder_notaria: "42",
      poder_ciudad: "la Heroica Ciudad de Puebla de Zaragoza, Puebla",
      poder_otorgante: "el Ingeniero MANUEL RAMÍREZ IBAÑEZ",
      poder_facultades: "Poder General para Pleitos y Cobranzas",
    },
  },
  monto: 150000,
  interes_moratorio_pct: 3,
  fecha_firma: "2026-08-01",
  ciudad_firma: "Heroica Puebla de Zaragoza, Estado de Puebla",
};

test("números en letra como los escriben los abogados", () => {
  assert.equal(numeroALetras(7354), "siete mil trescientos cincuenta y cuatro");
  assert.equal(numeroALetras(71040), "setenta y un mil cuarenta");
  assert.equal(numeroALetras(43752), "cuarenta y tres mil setecientos cincuenta y dos");
  assert.equal(numeroALetras(1126), "mil ciento veintiséis");
  assert.equal(numeroALetras(21000), "veintiún mil");
  assert.equal(numeroALetras(100), "cien");
  assert.equal(numeroALetras(2002), "dos mil dos");
  assert.equal(letraYCifra("7354"), "siete mil trescientos cincuenta y cuatro (7,354)");
  assert.equal(cifraYLetra("12652"), "12,652 (doce mil seiscientos cincuenta y dos)");
});

test("monto, interés y fechas", () => {
  assert.equal(montoEnLetras(150000), "CIENTO CINCUENTA MIL PESOS 00/100 MONEDA NACIONAL");
  assert.equal(montoEnLetras(1000000), "UN MILLÓN DE PESOS 00/100 MONEDA NACIONAL");
  assert.equal(montoEnLetras(1250.5), "MIL DOSCIENTOS CINCUENTA PESOS 50/100 MONEDA NACIONAL");
  assert.equal(montoEnLetras(21), "VEINTIÚN PESOS 00/100 MONEDA NACIONAL");
  assert.equal(interesEnLetras(3), "3% (tres por ciento)");
  assert.equal(interesEnLetras(2.5), "2.5% (dos punto cinco por ciento)");
  assert.equal(fechaEnLetras("2013-10-23"), "veintitrés de octubre de dos mil trece");
  assert.equal(fechaCifraYLetra("2002-10-04"), "4 (cuatro) de octubre de 2002 (dos mil dos)");
  assert.equal(textoFirma("Heroica Puebla de Zaragoza, Estado de Puebla", "2026-08-01"), "En consecuencia, lo firman por duplicado en la Heroica Puebla de Zaragoza, Estado de Puebla, a los 01 días del mes de Agosto de 2026, quedando un ejemplar en poder de cada una de “LAS PARTES”.");
});

test("razón social entre comillas", () => {
  assert.equal(sociedadEntreComillas("RAMSICON, S.A. DE C.V."), "“RAMSICON”, S.A. DE C.V.");
  assert.equal(sociedadEntreComillas("ACEROS Y ENVASADOS DE PUEBLA S.A. DE C.V."), "“ACEROS Y ENVASADOS DE PUEBLA”, S.A. DE C.V.");
  assert.equal(sociedadEntreComillas("Juan Pérez"), "“Juan Pérez”");
});

test("el contrato de RAMSICON sale con los datos del que mandaron los abogados", () => {
  const t = textoContrato(RAMSICON).join("\n");
  assert.match(t, /POR SU ADMINISTRADOR ÚNICO LA C\. ERENDIRA SOLIS TECUATL/);
  assert.match(t, /REPRESENTADA EN ESTE ACTO POR SU APODERADO LEGAL EL C\. MANUEL RAMÍREZ SAINZ/);
  assert.match(t, /instrumento notarial número siete mil trescientos cincuenta y cuatro \(7,354\) volumen número mil ciento veintiséis \(1,126\) otorgado ante la fe pública del Licenciado Arturo Díaz González, titular de la Notaría Pública número cuarenta y tres del Distrito Judicial de Puebla el día veintitrés de octubre de dos mil trece\./);
  assert.match(t, /pasado ante la fe pública de la Licenciada María Emilia Sesma Téllez, titular de la Notaría Pública número tres del Distrito Judicial de Cholula, Puebla de fecha de protocolización el día ocho de mayo de dos mil dieciocho/);
  assert.match(t, /instrumento notarial número 12,652 \(doce mil seiscientos cincuenta y dos\), volumen número 182 \(ciento ochenta y dos\), de fecha 4 \(cuatro\) de octubre de 2002 \(dos mil dos\)/);
  assert.match(t, /bajo el número 1,862 \(mil ochocientos sesenta y dos\), del tomo 2002, de fecha 11 \(once\) de noviembre de 2002/);
  assert.match(t, /número 71,040 \(setenta y un mil cuarenta\), volumen número 1,454 \(mil cuatrocientos cincuenta y cuatro\), de fecha 6 \(seis\) de septiembre de 2018 \(dos mil dieciocho\), otorgado ante la fe del Licenciado MARIO SALAZAR MARTÍNEZ, Notario Titular de la Notaría Pública número 42 \(cuarenta y dos\)/);
  assert.match(t, /hasta por la cantidad máxima de: 150,000\.00 \(CIENTO CINCUENTA MIL PESOS 00\/100 MONEDA NACIONAL\)\./);
  assert.match(t, /interés moratorio equivalente al 3% \(tres por ciento\) mensual/);
  assert.match(t, /En este acto, el C\. MANUEL RAMÍREZ SAINZ comparece adicionalmente en su carácter personal/);
  assert.match(t, /• Correo electrónico: marthazm@ramsicon\.com ; manuelrs@ramsicon\.com/);
  assert.match(t, /a los 01 días del mes de Agosto de 2026/);
  assert.ok(!t.includes("{{"), "no quedan marcadores sin llenar");
  // Las 34 cláusulas del machote.
  assert.match(t, /TRIGÉSIMA CUARTA\. ACEPTACIÓN\./);
  assert.equal((t.match(/^(PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|SÉPTIMA|OCTAVA|NOVENA|DÉCIMA|VIGÉSIMA|TRIGÉSIMA)[A-ZÁÉÍÓÚ ]*\. /gm) ?? []).length, 34);
});

test("sin obligado solidario no sale la comparecencia ni su firma; persona física", () => {
  const d: DatosContrato = {
    ...RAMSICON,
    comprador: { ...RAMSICON.comprador, tipo_persona: "fisica", razon_social: "JUAN PÉREZ LÓPEZ", obligado_solidario_nombre: null, legales: { identificacion: "credencial para votar número 123" } },
  };
  const t = textoContrato(d).join("\n");
  assert.ok(!t.includes("comparece adicionalmente"));
  assert.match(t, /POR LA OTRA PARTE, EL C\. JUAN PÉREZ LÓPEZ, POR SU PROPIO DERECHO/);
  assert.match(t, /se identifica con credencial para votar número 123/);
  assert.ok(!docContratoCredito(d).includes("OBLIGADO SOLIDARIO"));
  assert.deepEqual(faltantesContrato(d), []);
});

test("faltantes, HTML, Word y nombre de archivo", () => {
  assert.deepEqual(faltantesContrato(RAMSICON), []);
  const vacio: DatosContrato = { ...RAMSICON, monto: 0, comprador: { ...RAMSICON.comprador, rfc: null, legales: {} } };
  assert.deepEqual(faltantesContrato(vacio), ["RFC del cliente", "Escritura constitutiva del cliente", "Poder del representante del cliente", "Monto de la línea de crédito"]);
  const html = htmlContratoCredito(RAMSICON);
  assert.match(html, /<h1>CONTRATO MERCANTIL DE SUMINISTRO CON LÍNEA DE CRÉDITO COMERCIAL<\/h1>/);
  assert.match(html, /LICENCIADA ERENDIRA SOLIS TECUATL/);
  assert.match(html, /“OBLIGADO SOLIDARIO”/);
  assert.match(docContratoCredito(RAMSICON), /urn:schemas-microsoft-com:office:word/);
  assert.equal(nombreArchivoContrato(RAMSICON, "doc"), "Contrato CTO-AEP-0001 RAMSICON.doc");
});
