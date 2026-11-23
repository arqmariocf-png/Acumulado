import { test } from "node:test";
import assert from "node:assert/strict";
import { claveUnidadSugerida, conceptosDesdeOv, formaPagoSat, metodoPagoSugerido, puedeFacturar, receptorDesdeOv, regimenClave, regimenPorRfc, revisarFactura, totalesCaptura } from "./facturacion.ts";

test("unidad escrita → clave del SAT", () => {
  assert.deepEqual(claveUnidadSugerida("PZA"), { clave: "H87", nombre: "Pieza" });
  assert.deepEqual(claveUnidadSugerida("Pieza"), { clave: "H87", nombre: "Pieza" });
  assert.deepEqual(claveUnidadSugerida("KG"), { clave: "KGM", nombre: "Kilogramo" });
  assert.deepEqual(claveUnidadSugerida("M2"), { clave: "MTK", nombre: "Metro cuadrado" });
  assert.deepEqual(claveUnidadSugerida("SRV"), { clave: "E48", nombre: "Unidad de servicio" });
  assert.deepEqual(claveUnidadSugerida("H87"), { clave: "H87", nombre: "Pieza" });
  assert.deepEqual(claveUnidadSugerida("BTO"), { clave: "XSA", nombre: "Saco" });
  assert.equal(claveUnidadSugerida("xyz"), null);
  assert.equal(claveUnidadSugerida(null), null);
});

test("forma de pago, método y régimen", () => {
  assert.equal(formaPagoSat("Transferencia electrónica de fondos"), "03");
  assert.equal(formaPagoSat("Efectivo"), "01");
  assert.equal(formaPagoSat("Tarjeta de crédito"), "04");
  assert.equal(formaPagoSat("Tarjeta de débito"), "28");
  assert.equal(formaPagoSat("Cheque"), "02");
  assert.equal(formaPagoSat(null), "99");
  assert.equal(formaPagoSat("03"), "03");
  assert.equal(metodoPagoSugerido("credito"), "PPD");
  assert.equal(metodoPagoSugerido("anticipo"), "PPD");
  assert.equal(metodoPagoSugerido("contado"), "PUE");
  assert.equal(metodoPagoSugerido(null), "PUE");
  assert.equal(regimenClave("601 General de Ley Personas Morales"), "601");
  assert.equal(regimenClave("612"), "612");
  assert.equal(regimenClave(null), "");
  assert.equal(regimenPorRfc("COFM890711MGA"), "612");
  assert.equal(regimenPorRfc("CSC100514JB7"), "601");
  assert.equal(regimenPorRfc(""), "");
});

test("conceptos prellenados: partida > memoria > producto > default", () => {
  const cs = conceptosDesdeOv(
    [
      { id: "a", concepto: "Varilla 3/8", unidad: "PZA", cantidad: 10, precio_base: 122, iva: true, sat_code: "30102200", clave_unidad: null },
      { id: "b", concepto: "Cemento", unidad: "bto", cantidad: 2, precio_base: 230, iva: true, sat_code: null, clave_unidad: null, memoria: { clave_prod_serv: "30111601", clave_unidad: "XSA" } },
      { id: "c", concepto: "Flete", unidad: "SRV", cantidad: 1, precio_base: 500, iva: false, sat_code: null, clave_unidad: null, producto: { clave_prod_serv: "78101800", clave_unidad: null } },
      { id: "d", concepto: "Otro", unidad: "", cantidad: 1, precio_base: 1, iva: true, sat_code: null, clave_unidad: null },
      { id: "e", concepto: "", unidad: "PZA", cantidad: 1, precio_base: 1, iva: true, sat_code: null, clave_unidad: null },
      { id: "f", concepto: "Cero", unidad: "PZA", cantidad: 0, precio_base: 1, iva: true, sat_code: null, clave_unidad: null },
    ],
    { clave_prod_serv_default: "01010101", clave_unidad_default: "H87" },
  );
  assert.equal(cs.length, 4);
  assert.deepEqual(cs[0], { linea_id: "a", descripcion: "Varilla 3/8", unidad: "PZA", cantidad: 10, precio: 122, iva: true, clave_prod_serv: "30102200", clave_unidad: "H87" });
  assert.equal(cs[1].clave_prod_serv, "30111601");
  assert.equal(cs[1].clave_unidad, "XSA");
  assert.equal(cs[2].clave_prod_serv, "78101800");
  assert.equal(cs[2].clave_unidad, "E48");
  assert.equal(cs[2].iva, false);
  assert.equal(cs[3].clave_prod_serv, "01010101");
  assert.equal(cs[3].clave_unidad, "H87");
});

test("receptor prellenado y validación", () => {
  const clientes = [
    { id: "x", razon_social: "Ergodinova", rfc: null, regimen_fiscal: null, codigo_postal: null, email: null, uso_cfdi: null, coincide: false },
    { id: "y", razon_social: "RAMSICON, S.A. DE C.V.", rfc: "RAM0210042V9", regimen_fiscal: "601 General de Ley Personas Morales", codigo_postal: "72820", email: "m@r.com", uso_cfdi: null, coincide: true },
  ];
  const r = receptorDesdeOv("RAMSICON", clientes);
  assert.equal(r.cliente_id, "y");
  assert.equal(r.regimen_fiscal, "601");
  assert.equal(r.uso_cfdi, "G03");
  const sin = receptorDesdeOv("Mario Contreras Farfán", clientes.map((c) => ({ ...c, coincide: false })));
  assert.deepEqual(sin, { cliente_id: null, razon_social: "Mario Contreras Farfán", rfc: "", regimen_fiscal: "", codigo_postal: "", email: "", uso_cfdi: "G03" });
  const conceptos = [{ linea_id: "a", descripcion: "Varilla", unidad: "PZA", cantidad: 1, precio: 10, iva: true, clave_prod_serv: "30102200", clave_unidad: "H87" }];
  assert.deepEqual(revisarFactura({ receptor: { ...r, rfc: "RAM0210042V9" }, conceptos, forma_pago: "03", config: { con_llaves: true, serie_id: 5 } }), []);
  assert.deepEqual(revisarFactura({ receptor: sin, conceptos: [{ ...conceptos[0], clave_prod_serv: "", clave_unidad: "" }], forma_pago: "", config: null }), [
    "La empresa no tiene llaves de factura.com: captúralas en Contabilidad › Facturación.",
    "El RFC del cliente no es válido.",
    "Elige el régimen fiscal del cliente.",
    "El código postal fiscal del cliente debe tener 5 dígitos.",
    "Elige la forma de pago.",
    "Partida 1 (Varilla): falta la clave de producto/servicio del SAT (8 dígitos).",
    "Partida 1 (Varilla): falta la clave de unidad del SAT.",
  ]);
  assert.deepEqual(revisarFactura({ receptor: { ...r, rfc: "RAM0210042V9" }, conceptos, forma_pago: "03", config: { con_llaves: true, serie_id: null } })[0], "Elige la serie con la que se timbra en Contabilidad › Facturación.");
  assert.deepEqual(totalesCaptura(conceptos), { subtotal: 10, iva: 1.6, total: 11.6 });
  assert.equal(puedeFacturar({ rol: "corporativo" }), true);
  assert.equal(puedeFacturar({ rol: "almacen", modulos: ["contabilidad"] }), true);
  assert.equal(puedeFacturar({ rol: "almacen", modulos: [] }), false);
});
