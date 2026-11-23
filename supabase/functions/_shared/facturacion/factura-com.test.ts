import { test } from "node:test";
import assert from "node:assert/strict";
import { cabeceras, construirCfdi, cuerpoCliente, elegirClienteFacturaCom, hostDe, interpretarTimbrado, razonSocialSinRegimen, revisarConceptos, revisarReceptor, rfcValido, totalesConceptos } from "./factura-com.ts";

test("hosts y cabeceras", () => {
  assert.equal(hostDe("produccion"), "https://api.factura.com");
  assert.equal(hostDe("sandbox"), "https://sandbox.factura.com/api");
  assert.equal(hostDe("otro"), "https://sandbox.factura.com/api");
  assert.deepEqual(Object.keys(cabeceras("a", "b")), ["Content-Type", "F-PLUGIN", "F-Api-Key", "F-Secret-Key"]);
});

test("totales y cuerpo del CFDI", () => {
  const conceptos = [
    { descripcion: "Varilla 3/8", clave_prod_serv: "30102200", clave_unidad: "H87", unidad: "Pieza", cantidad: 10, precio: 122, iva: true },
    { descripcion: "Flete", clave_prod_serv: "78101800", clave_unidad: "E48", unidad: "Unidad de servicio", cantidad: 1, precio: 500, iva: false },
  ];
  assert.deepEqual(totalesConceptos(conceptos), { subtotal: 1720, iva: 195.2, total: 1915.2 });
  const c = construirCfdi({ receptor_uid: "abc", conceptos, uso_cfdi: "G03", serie_id: 1234, forma_pago: "03", metodo_pago: "PPD", condiciones_pago: "Crédito 30 días", num_orden: "IA-OV-0133", enviar_correo: false, regimen_fiscal_emisor: "601", lugar_expedicion: "72820" });
  assert.deepEqual(c.Receptor, { UID: "abc" });
  assert.equal(c.TipoDocumento, "factura");
  assert.equal(c.RegimenFiscal, 601);
  assert.equal(c.LugarExpedicion, "72820");
  assert.equal(c.Serie, 1234);
  assert.equal(c.MetodoPago, "PPD");
  assert.equal(c.NumOrder, "IA-OV-0133");
  const cs = c.Conceptos as Record<string, unknown>[];
  assert.equal(cs.length, 2);
  assert.equal(cs[0].ObjetoImp, "02");
  assert.deepEqual(cs[0].Impuestos, { Traslados: [{ Base: 1220, Impuesto: "002", TipoFactor: "Tasa", TasaOCuota: "0.16", Importe: 195.2 }], Retenidos: [], Locales: [] });
  assert.equal(cs[1].ObjetoImp, "01");
  assert.equal(cs[1].Impuestos, undefined);
  assert.equal(cs[1].Importe, 500);
});

test("respuesta de timbrado", () => {
  const ok = interpretarTimbrado({ response: "success", message: "Factura creada", UUID: "8ff503a2-c6b7-4a25-abcd-a25610e6b488", uid: "5c06fa8b3bbe6", SAT: { FechaTimbrado: "2026-11-23T10:00:00" }, INV: { Serie: "F", Folio: 1433 } });
  assert.equal(ok.ok, true);
  assert.equal(ok.uuid, "8FF503A2-C6B7-4A25-ABCD-A25610E6B488");
  assert.equal(ok.serie, "F");
  assert.equal(ok.folio, "1433");
  assert.equal(ok.uid, "5c06fa8b3bbe6");
  const err = interpretarTimbrado({ response: "error", message: { message: "CFDI33161 - Importe fuera de límite", messageDetail: "Traslado:Importe", status: "error" } });
  assert.equal(err.ok, false);
  assert.equal(err.mensaje, "CFDI33161 - Importe fuera de límite · Traslado:Importe");
  assert.equal(interpretarTimbrado({ response: "error", message: "Ya existe un CFDI con folio y serie [F-1]" }).mensaje, "Ya existe un CFDI con folio y serie [F-1]");
  assert.equal(interpretarTimbrado({ status: "error", message: { rfc: ["El campo rfc es requerido"] } }).mensaje, "rfc: El campo rfc es requerido");
});

test("receptor: RFC, razón social sin régimen, elegir cliente", () => {
  assert.equal(rfcValido("AEL131023CS1"), true);
  assert.equal(rfcValido("COFM890711MGA"), true);
  assert.equal(rfcValido("XAXX010101000"), true);
  assert.equal(rfcValido("ABC"), false);
  assert.equal(razonSocialSinRegimen("RAZON SOCIAL DE PRUEBA S.A. DE C.V."), "RAZON SOCIAL DE PRUEBA");
  assert.equal(razonSocialSinRegimen("Constructora, Supervisión y Consultoría Loma S.A. de C.V."), "Constructora, Supervisión y Consultoría Loma");
  assert.equal(razonSocialSinRegimen("Mario Contreras Farfán"), "Mario Contreras Farfán");
  const lista = [
    { UID: "1", RFC: "CSC100514JB7", RazonSocial: "CONSTRUCTORA SUPERVISION Y CONSULTORIA LOMA" },
    { UID: "2", RFC: "CSC100514JB7", RazonSocial: "CONSTRUCTORA LOMA" },
    { UID: "3", RFC: "ERG080519940", RazonSocial: "ERGODINOVA" },
  ];
  assert.equal(elegirClienteFacturaCom(lista, "Constructora, Supervisión y Consultoría Loma S.A. de C.V.", "csc100514jb7")?.UID, "1");
  assert.equal(elegirClienteFacturaCom(lista, "Otra razón", "CSC100514JB7"), null, "dos con el mismo RFC y ninguno empata");
  assert.equal(elegirClienteFacturaCom(lista, "Ergodinova SA de CV", "ERG080519940")?.UID, "3");
  assert.equal(elegirClienteFacturaCom(lista, "X", "XXX010101000"), null);
  assert.deepEqual(cuerpoCliente({ rfc: "csc100514jb7", razon_social: "Constructora Loma S.A. de C.V.", regimen_fiscal: "601", codigo_postal: "72820", email: "", uso_cfdi: "G03" }), {
    rfc: "CSC100514JB7", razons: "Constructora Loma", codpos: "72820", email: "sinreply@grupoloma.mx", usocfdi: "G03", regimen: "601", pais: "MEX",
  });
});

test("validaciones", () => {
  assert.deepEqual(revisarReceptor({ rfc: "CSC100514JB7", razon_social: "Loma", regimen_fiscal: "601", codigo_postal: "72820", uso_cfdi: "G03" }), []);
  assert.deepEqual(revisarReceptor({ rfc: "", razon_social: "", regimen_fiscal: "601 General", codigo_postal: "7282", uso_cfdi: "" }), [
    "El RFC del cliente no es válido (12 o 13 caracteres).",
    "Falta la razón social del cliente.",
    "Falta el régimen fiscal del cliente (clave de 3 dígitos, p. ej. 601).",
    "Falta el código postal fiscal del cliente (5 dígitos).",
    "Elige el uso del CFDI.",
  ]);
  assert.deepEqual(revisarConceptos([]), ["La orden no tiene partidas."]);
  assert.deepEqual(revisarConceptos([{ descripcion: "x", clave_prod_serv: "123", clave_unidad: "", cantidad: 0, precio: -1 }]), [
    "Partida 1: la clave de producto/servicio del SAT debe tener 8 dígitos.",
    "Partida 1: falta la clave de unidad del SAT (p. ej. H87).",
    "Partida 1: la cantidad debe ser mayor a cero.",
    "Partida 1: el precio no es válido.",
  ]);
});
