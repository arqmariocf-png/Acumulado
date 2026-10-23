import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync, createVerify } from "node:crypto";
import {
  estadoDeVerificacion,
  filaCfdi,
  leerCfdiXml,
  leerDescarga,
  leerSolicitud,
  leerToken,
  leerVerificacion,
  rangoSiguiente,
  sobreAutenticacion,
  sobreSolicitud,
  sobreVerificacion,
  type Firmador,
} from "../../sat-descarga-masiva/sat.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
const firmador: Firmador = {
  sha1Base64: (t) => createHash("sha1").update(t, "utf8").digest("base64"),
  firmarBase64: (t) => createSign("RSA-SHA1").update(t, "utf8").sign(privateKey, "base64"),
  certificadoBase64: "MIICERT",
  emisorNombre: "CN=AC DEL SAT,O=SERVICIO DE ADMINISTRACION TRIBUTARIA",
  numeroSerie: "123",
};

test("autenticación: timestamp firmado con su digest", () => {
  const xml = sobreAutenticacion(firmador, new Date("2026-10-13T18:00:00Z"), "uuid-x-1");
  assert.match(xml, /<u:Created>2026-10-13T18:00:00\.000Z<\/u:Created><u:Expires>2026-10-13T18:05:00\.000Z<\/u:Expires>/);
  const ts = '<u:Timestamp xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" u:Id="_0"><u:Created>2026-10-13T18:00:00.000Z</u:Created><u:Expires>2026-10-13T18:05:00.000Z</u:Expires></u:Timestamp>';
  assert.ok(xml.includes(`<DigestValue>${firmador.sha1Base64(ts)}</DigestValue>`));
  const si = xml.match(/<SignedInfo[\s\S]*?<\/SignedInfo>/)![0];
  const firma = xml.match(/<SignatureValue>([^<]+)</)![1];
  assert.ok(createVerify("RSA-SHA1").update(si).verify(publicKey, firma, "base64"));
  assert.match(xml, /URI="#uuid-x-1"/);
});

test("solicitud de recibidos: atributos ordenados, digest del nodo sin firma", () => {
  const xml = sobreSolicitud(firmador, { rfc: "AEL131023CS1", tipo: "recibido", fechaInicial: "2026-01-01T00:00:00", fechaFinal: "2026-10-12T23:59:59", tipoSolicitud: "CFDI", estadoComprobante: "Vigente" });
  const attrs = 'EstadoComprobante="Vigente" FechaFinal="2026-10-12T23:59:59" FechaInicial="2026-01-01T00:00:00" RfcReceptor="AEL131023CS1" RfcSolicitante="AEL131023CS1" TipoSolicitud="CFDI"';
  assert.ok(xml.includes(`<des:SolicitaDescargaRecibidos><des:solicitud ${attrs}><Signature`));
  const digerido = `<des:SolicitaDescargaRecibidos xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx"><des:solicitud ${attrs}></des:solicitud></des:SolicitaDescargaRecibidos>`;
  assert.ok(xml.includes(`<DigestValue>${firmador.sha1Base64(digerido)}</DigestValue>`));
  assert.match(xml, /<X509SerialNumber>123<\/X509SerialNumber>/);
  assert.doesNotMatch(xml, /RfcEmisor/);
  const emitidos = sobreSolicitud(firmador, { rfc: "AEL131023CS1", tipo: "emitido", fechaInicial: "a", fechaFinal: "b", tipoSolicitud: "CFDI" });
  assert.match(emitidos, /<des:SolicitaDescargaEmitidos><des:solicitud FechaFinal="b" FechaInicial="a" RfcEmisor="AEL131023CS1" RfcSolicitante="AEL131023CS1" TipoSolicitud="CFDI">/);
  assert.match(sobreVerificacion(firmador, "X", "abc"), /<des:solicitud IdSolicitud="abc" RfcSolicitante="X">/);
});

test("lee las respuestas del SAT", () => {
  assert.equal(leerToken('<s:Body><AutenticaResponse><AutenticaResult>eyJ0b2tlbg</AutenticaResult></AutenticaResponse></s:Body>'), "eyJ0b2tlbg");
  const s = leerSolicitud('<SolicitaDescargaRecibidosResult IdSolicitud="4e80345d-917f" RfcSolicitante="X" CodEstatus="5000" Mensaje="Solicitud Aceptada"/>');
  assert.deepEqual(s, { idSolicitud: "4e80345d-917f", codEstatus: "5000", mensaje: "Solicitud Aceptada" });
  const v = leerVerificacion('<VerificaSolicitudDescargaResult CodEstatus="5000" EstadoSolicitud="3" CodigoEstadoSolicitud="5000" NumeroCFDIs="12" Mensaje="Solicitud Aceptada"><IdsPaquetes>P_01</IdsPaquetes><IdsPaquetes>P_02</IdsPaquetes></VerificaSolicitudDescargaResult>');
  assert.deepEqual(v.paquetes, ["P_01", "P_02"]);
  assert.equal(v.numeroCfdis, 12);
  assert.equal(estadoDeVerificacion(v), "terminada");
  assert.equal(estadoDeVerificacion({ ...v, estadoSolicitud: 2, paquetes: [] }), "en_proceso");
  assert.equal(estadoDeVerificacion({ ...v, codigoEstadoSolicitud: "5004" }), "vacia");
  assert.equal(estadoDeVerificacion({ ...v, estadoSolicitud: 5 }), "rechazada");
  const d = leerDescarga('<s:Header><h:respuesta CodEstatus="5000" Mensaje="Solicitud Aceptada" xmlns:h="x"/></s:Header><s:Body><RespuestaDescargaMasivaTercerosSalida><Paquete>UEsDBA==</Paquete></RespuestaDescargaMasivaTercerosSalida></s:Body>');
  assert.deepEqual(d, { codEstatus: "5000", mensaje: "Solicitud Aceptada", paqueteBase64: "UEsDBA==" });
});

const FACTURA = `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Fecha="2026-09-15T10:20:30" Total="1160.00" TipoDeComprobante="I" MetodoPago="PPD" FormaPago="99"><cfdi:Emisor Rfc="ACE010101AB1" Nombre="ACEROS &amp; MAS" RegimenFiscal="601"/><cfdi:Receptor Rfc="AEL131023CS1" Nombre="ACEROS Y ENVASADOS DE PUEBLA"/><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="45a9b49c-59e2-4593-8ea5-c1ceaba0a248"/></cfdi:Complemento></cfdi:Comprobante>`;
const PAGO = `<cfdi:Comprobante Fecha="2026-10-01T09:00:00" Total="0" TipoDeComprobante="P"><cfdi:Emisor Rfc="AEL131023CS1" Nombre="AEP"/><cfdi:Receptor Rfc="CLI010101AA1" Nombre="CLIENTE"/><cfdi:Complemento><pago20:Pagos><pago20:Totales MontoTotalPagos="300"/><pago20:Pago FechaPago="2026-09-30T12:00:00" Monto="100.50"><pago20:DoctoRelacionado IdDocumento="45a9b49c-59e2-4593-8ea5-c1ceaba0a248" ImpPagado="100.50"/></pago20:Pago><pago20:Pago FechaPago="2026-09-30T13:00:00" Monto="199.50"/></pago20:Pagos><tfd:TimbreFiscalDigital UUID="CDE63D72-C891-4767-A159-FC5636187EA6"/></cfdi:Complemento></cfdi:Comprobante>`;

const NOTA = `<cfdi:Comprobante Fecha="2026-10-02T09:00:00" Total="116" TipoDeComprobante="E" MetodoPago="PUE" FormaPago="15"><cfdi:CfdiRelacionados TipoRelacion="01"><cfdi:CfdiRelacionado UUID="45a9b49c-59e2-4593-8ea5-c1ceaba0a248"/></cfdi:CfdiRelacionados><cfdi:Emisor Rfc="AEL131023CS1" Nombre="AEP"/><cfdi:Receptor Rfc="CLI010101AA1" Nombre="CLIENTE"/><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="11111111-2222-3333-4444-555555555555"/></cfdi:Complemento></cfdi:Comprobante>`;

test("XML de CFDI a renglón de cfdi (factura y complemento de pago)", () => {
  const f = leerCfdiXml(FACTURA)!;
  assert.equal(f.uuid, "45A9B49C-59E2-4593-8EA5-C1CEABA0A248");
  assert.deepEqual(filaCfdi(f, "recibido"), {
    tipo: "recibido", rfc: "ACE010101AB1", folio: "45A9B49C-59E2-4593-8EA5-C1CEABA0A248", total: 1160, periodo: "202609",
    contraparte: "ACEROS & MAS", fecha: "2026-09-15", es_complemento_pago: false,
    tipo_comprobante: "I", metodo_pago: "PPD", forma_pago: "99", relacionados: [],
  });
  const p = filaCfdi(leerCfdiXml(PAGO)!, "emitido")!;
  assert.equal(p.total, 300);
  assert.equal(p.fecha, "2026-09-30");
  assert.equal(p.periodo, "202609");
  assert.equal(p.rfc, "CLI010101AA1");
  assert.equal(p.es_complemento_pago, true);
  assert.equal(p.tipo_comprobante, "P");
  assert.deepEqual(p.relacionados, [{ uuid: "45A9B49C-59E2-4593-8EA5-C1CEABA0A248", importe: 100.5, tipo_relacion: null }]);
  const nc = filaCfdi(leerCfdiXml(NOTA)!, "emitido")!;
  assert.equal(nc.tipo_comprobante, "E");
  assert.deepEqual(nc.relacionados, [{ uuid: "45A9B49C-59E2-4593-8EA5-C1CEABA0A248", importe: null, tipo_relacion: "01" }]);
  assert.equal(leerCfdiXml("<html/>"), null);
});

test("rango siguiente: desde el inicio del año o 3 días antes de lo último, hasta ayer", () => {
  assert.deepEqual(rangoSiguiente(null, "2026-10-13"), { fechaInicial: "2026-01-01T00:00:00", fechaFinal: "2026-10-12T23:59:59" });
  assert.deepEqual(rangoSiguiente("2026-10-12T23:59:59", "2026-10-14"), { fechaInicial: "2026-10-09T00:00:00", fechaFinal: "2026-10-13T23:59:59" });
  assert.equal(rangoSiguiente("2026-10-20T23:59:59", "2026-10-14"), null);
});
