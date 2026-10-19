import { test } from "node:test";
import assert from "node:assert/strict";
import { amortizar, documentoAfiliacion, documentoConsentimiento, documentoPagare, htmlDocumentoFirmado, pagosMinimosConInteres } from "./creditoNomina.ts";

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

test("sin intereses: el monto entre los pagos, como antes", () => {
  const a = amortizar(1000, 0, 16, 3, "2026-10-23");
  assert.equal(a.interes, 0);
  assert.equal(a.total, 1000);
  assert.equal(a.descuentoPorPago, 333.34);
  assert.deepEqual(a.filas.map((f) => f.pago), [333.34, 333.34, 333.32]);
  assert.equal(a.cat, 0);
});

test("con intereses: sistema francés semanal, IVA sobre intereses y CAT", () => {
  // $5,000 a 60 % anual en 10 semanas: i = 0.60/52.
  const a = amortizar(5000, 60, 16, 10, "2026-10-23");
  const i = 0.6 / 52;
  const pago = (5000 * i) / (1 - Math.pow(1 + i, -10));
  assert.equal(a.interes, Math.round((pago * 10 - 5000) * 100) / 100);
  assert.equal(a.iva, Math.round(a.interes * 0.16 * 100) / 100);
  assert.equal(a.total, Math.round((5000 + a.interes + a.iva) * 100) / 100);
  assert.equal(a.descuentoPorPago, Math.ceil((a.total / 10) * 100) / 100);
  // La tabla cuadra con los totales.
  assert.equal(sum(a.filas.map((f) => f.pago)), a.total);
  assert.equal(sum(a.filas.map((f) => f.capital)), 5000);
  assert.equal(sum(a.filas.map((f) => f.interes)), a.interes);
  assert.equal(sum(a.filas.map((f) => f.iva)), a.iva);
  assert.equal(a.filas[9].saldo, 0);
  assert.equal(a.filas[9].fecha, "2026-12-25");
  // El interés va bajando semana con semana.
  assert.ok(a.filas[0].interes > a.filas[8].interes);
  assert.equal(a.cat, Math.round((Math.pow(1 + i, 52) - 1) * 1000) / 10);
});

test("pagos mínimos para caber en la capacidad de pago", () => {
  assert.equal(pagosMinimosConInteres(5000, 60, 16, 1200, 26, "2026-10-23"), 5);
  assert.equal(pagosMinimosConInteres(5000, 60, 16, 100, 26, "2026-10-23"), null);
});

const base = {
  trabajador: "Jonathan Cáceres",
  puesto: "Supervisor",
  patron: { razon_social: "ERGODINOVA, S.A. DE C.V.", rfc: "ERG000000AA0" },
  financiera: { razon_social: "FINANCIERA LOMA, S.A. DE C.V." },
  ciudad: "Puebla, Puebla",
  fecha: "2026-10-19",
};

test("afiliación y consentimiento: nombres, ley y firma electrónica", () => {
  const af = documentoAfiliacion(base);
  assert.equal(af.tipo, "afiliacion");
  assert.match(af.texto, /Jonathan Cáceres, con puesto de Supervisor/);
  assert.match(af.texto, /FINANCIERA LOMA/);
  assert.match(af.texto, /artículo 111/);
  assert.match(af.texto, /Código de Comercio/);
  assert.match(af.texto, /diecinueve de octubre de dos mil veintiséis/);
  const co = documentoConsentimiento({ ...base, financiera: null });
  assert.match(co.texto, /autorizo expresamente a ERGODINOVA/);
  assert.doesNotMatch(co.texto, /FINANCIERA/);
});

test("pagaré: total en letra, tabla de fechas e intereses de la financiera", () => {
  const a = amortizar(1000, 0, 16, 2, "2026-10-23");
  const sinInteres = documentoPagare({ ...base, acreedor: base.patron, concepto: "Préstamo", amortizacion: a, tasaMoratoria: 0 });
  assert.match(sinInteres.texto, /Bueno por \$1,000\.00/);
  assert.match(sinInteres.texto, /UN MIL PESOS 00\/100|MIL PESOS 00\/100/);
  assert.match(sinInteres.texto, /sin intereses/);
  assert.match(sinInteres.texto, /23\/10\/2026/);
  assert.doesNotMatch(sinInteres.texto, /moratorios/);
  const b = amortizar(5000, 60, 16, 10, "2026-10-23");
  const conInteres = documentoPagare({ ...base, acreedor: base.financiera, concepto: "Préstamo", amortizacion: b, tasaMoratoria: 90 });
  assert.match(conInteres.texto, /a la orden de FINANCIERA LOMA/);
  assert.match(conInteres.texto, /60 % anual/);
  assert.match(conInteres.texto, /moratorios a la tasa de 90 % anual/);
  assert.match(conInteres.texto, /veinticinco de diciembre de dos mil veintiséis/);
});

test("impresión del documento firmado con su constancia", () => {
  const html = htmlDocumentoFirmado({
    titulo: "Pagaré <x>",
    contenido: "PAGARÉ\n\nDebo y pagaré",
    firma: "data:image/png;base64,AAAA",
    hash: "abc123",
    firmante_nombre: "Jonathan",
    firmado_en: "2026-10-19T18:00:00Z",
    ip: "1.2.3.4",
    version: "borrador-2026-10-19",
  });
  assert.match(html, /<h1>PAGARÉ<\/h1>/);
  assert.match(html, /Pagaré &lt;x&gt;/);
  assert.match(html, /abc123/);
  assert.match(html, /IP 1\.2\.3\.4/);
});
