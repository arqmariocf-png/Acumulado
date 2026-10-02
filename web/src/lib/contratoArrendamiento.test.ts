import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docContratoArrendamiento,
  fechaContrato,
  faltantesArrendamiento,
  htmlContratoArrendamiento,
  mesesDePlazo,
  nombreArchivoArrendamiento,
  PENAS_DEFAULT,
  parteDesdePerfil,
  periodoRenovacion,
  rentaEnLetras,
  textoArrendamiento,
  textoPlazo,
  type DatosArrendamiento,
} from "./contratoArrendamiento.ts";

// El contrato firmado CSC → Ergodinova del 1-sep-2023.
const ergo: DatosArrendamiento = {
  folio: "ARR-CSC-0001",
  arrendador: {
    tipo_persona: "moral",
    razon_social: "Constructora Super y Consultoria Loma S.A. de C.V.",
    rfc: "CSC100514JB7",
    representante: "Mario Contreras Farfán",
    cargo: "Administrador único",
    domicilio: "Puebla, Pue.",
  },
  arrendatario: {
    tipo_persona: "moral",
    razon_social: "ERGODINOVA S.A. de C.V.",
    rfc: "ERG08519940",
    representante: "Jaime Sierra Farfán",
    cargo: "Administrador único",
    domicilio: "Puebla, Pue.",
  },
  fiador: { nombre: "Jaime Sierra Farfán", domicilio: "Calle Luis Donaldo Colosio 912, Col. Luis Donaldo Colosio, C.P. 72490, Puebla" },
  inmueble: { domicilio: "Prolongación 13 Oriente 1823, San Bernardino Tlaxcalancingo, San Andrés Cholula, C.P. 72820", metros: 2000, uso: "bodega y oficinas" },
  renta: 15000,
  iva_incluido: true,
  dia_pago: 1,
  forma_pago: "efectivo",
  inicio: "2023-09-01",
  fin: "2024-08-31",
  ...PENAS_DEFAULT,
  exclusividad_giro: true,
  ciudad_firma: "Puebla, Pue.",
  fecha_firma: "2023-09-01",
};

test("plazo y fechas en letra", () => {
  assert.equal(mesesDePlazo("2023-09-01", "2024-08-31"), 12);
  assert.equal(mesesDePlazo("2023-09-01", "2025-08-31"), 24);
  assert.equal(mesesDePlazo("2023-09-01", "2024-02-29"), 6);
  assert.equal(textoPlazo("2023-09-01", "2024-08-31"), "un año forzoso");
  assert.equal(textoPlazo("2023-09-01", "2025-08-31"), "dos años forzosos");
  assert.equal(textoPlazo("2023-09-01", "2024-02-29"), "seis meses forzosos");
  assert.equal(textoPlazo("2023-09-01", "2023-09-30"), "un mes forzoso");
  assert.equal(fechaContrato("2023-09-01"), "el día primero del mes de septiembre del año 2023");
  assert.equal(fechaContrato("2024-08-31"), "el día treinta y uno del mes de agosto del año 2024");
});

test("renta en letra", () => {
  assert.equal(rentaEnLetras(15000), "$15,000.00 (QUINCE MIL PESOS 00/100 M.N.)");
  assert.equal(rentaEnLetras(21500.5), "$21,500.50 (VEINTIÚN MIL QUINIENTOS PESOS 50/100 M.N.)");
});

test("contrato de Ergodinova: 21 cláusulas con fiador, 20 sin él", () => {
  const t = textoArrendamiento(ergo);
  const clausulas = t.filter((p) => p.tipo === "clausula");
  assert.equal(clausulas.length, 21);
  assert.equal(clausulas[0].encabezado, "PRIMERA.");
  assert.equal(clausulas[20].encabezado, "VIGÉSIMA PRIMERA.");
  assert.match(t[0].texto, /CONSTA DE 2,000 METROS CUADRADOS/);
  assert.match(t[0].texto, /Y COMO FIADOR EL SEÑOR JAIME SIERRA FARFÁN/);
  const tercera = clausulas[2].texto;
  assert.match(tercera, /\$15,000\.00 \(QUINCE MIL PESOS 00\/100 M\.N\.\) incluyendo el 16%/);
  assert.match(tercera, /el día primero de cada mes/);
  assert.match(tercera, /en efectivo/);
  assert.match(clausulas[3].texto, /un año forzoso, contando como fecha de inicio el día primero del mes de septiembre del año 2023/);
  assert.equal(t.filter((p) => p.tipo === "inciso").length, 5);
  assert.match(t.at(-1)!.texto, /^Firmado en la ciudad de Puebla, Pue\., el día primero/);

  const sinFiador = textoArrendamiento({ ...ergo, fiador: null, iva_incluido: false, forma_pago: "transferencia" });
  const cs = sinFiador.filter((p) => p.tipo === "clausula");
  assert.equal(cs.length, 20);
  assert.ok(!sinFiador.some((p) => /FIADOR/.test(p.texto)));
  assert.match(cs[2].texto, /más el 16%/);
  assert.match(cs[2].texto, /transferencia electrónica/);
});

test("faltantes", () => {
  assert.deepEqual(faltantesArrendamiento(ergo), []);
  const f = faltantesArrendamiento({
    ...ergo,
    arrendatario: { ...ergo.arrendatario, rfc: null, representante: null },
    fiador: { nombre: "X", domicilio: null },
    renta: 0,
    fin: "2023-08-01",
  });
  assert.deepEqual(f, [
    "RFC del arrendatario",
    "Representante del arrendatario",
    "Renta mensual",
    "La fecha de fin debe ser posterior al inicio",
    "Domicilio del fiador",
  ]);
});

test("HTML, Word y nombre de archivo", () => {
  const html = htmlContratoArrendamiento(ergo);
  assert.match(html, /<h2>CLÁUSULAS<\/h2>/);
  assert.match(html, /ARRENDADOR/);
  assert.match(html, /FIADOR/);
  assert.match(html, /ARR-CSC-0001/);
  const doc = docContratoArrendamiento(ergo);
  assert.match(doc, /urn:schemas-microsoft-com:office:word/);
  assert.ok(!doc.includes("window.print"));
  assert.equal(nombreArchivoArrendamiento(ergo, "doc"), "Arrendamiento ARR-CSC-0001 ERGODINOVA.doc");
});

test("renovación y parte desde el perfil legal", () => {
  assert.deepEqual(periodoRenovacion("2023-09-01", "2024-08-31"), { inicio: "2024-09-01", fin: "2025-08-31" });
  assert.deepEqual(periodoRenovacion("2024-01-01", "2024-06-30"), { inicio: "2024-07-01", fin: "2024-12-31" });
  assert.deepEqual(periodoRenovacion("2024-01-15", "2025-01-14"), { inicio: "2025-01-15", fin: "2026-01-14" });
  assert.deepEqual(parteDesdePerfil({ razon_social: "", rfc: "CSC100514JB7", representante_legal_nombre: "MARIO", representante_legal_puesto: "ADMINISTRADOR ÚNICO", domicilio_legal: "Puebla" }, "CSC"), {
    tipo_persona: "moral",
    razon_social: "CSC",
    rfc: "CSC100514JB7",
    representante: "MARIO",
    cargo: "ADMINISTRADOR ÚNICO",
    domicilio: "Puebla",
  });
  assert.equal(parteDesdePerfil(null, "ERG").rfc, null);
});
