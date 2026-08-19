import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearPdfEstadoCuentaBanBajio } from "./pdf-estado-cuenta.ts";
import { TEXTO_REAL_ESTADO_CUENTA_BALKEN_JULIO_2026 } from "./pdf-estado-cuenta.fixture.ts";

test("parsea el PDF real de BanBajío (Balken, julio 2026): 14 movimientos, cuadra con lo que el banco declara", () => {
  const r = parsearPdfEstadoCuentaBanBajio(TEXTO_REAL_ESTADO_CUENTA_BALKEN_JULIO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  // El propio PDF declara "TOTAL DE MOVIMIENTOS EN EL PERIODO 14".
  assert.equal(r.movimientos.length, 14);
  // El propio PDF declara "SALDO TOTAL* $ 40,727.21".
  assert.equal(r.movimientos[r.movimientos.length - 1].saldo, 40727.21);
});

test("clasifica correctamente cargo vs abono usando el delta de saldo, no el orden de las columnas", () => {
  const r = parsearPdfEstadoCuentaBanBajio(TEXTO_REAL_ESTADO_CUENTA_BALKEN_JULIO_2026);
  const comision = r.movimientos[0];
  assert.equal(comision.nombreRazonSocial, "COMISION ADMINISTRACION DE PAQUETE DE SERVICIOS");
  assert.equal(comision.cargoTotal, 500);
  assert.equal(comision.abonoTotal, null);
  assert.equal(comision.fechaPago, "2026-07-01");

  const deposito = r.movimientos.find((m) => m.folio === "2624276")!;
  assert.equal(deposito.nombreRazonSocial, "DEPÓSITO SPEI:TRASPASO");
  assert.equal(deposito.abonoTotal, 32000);
  assert.equal(deposito.cargoTotal, null);
  assert.equal(deposito.fechaPago, "2026-07-03");
});

test("una fila sin número de referencia (comisión, pago a crédito) deja folio en null en vez de un valor inventado", () => {
  const r = parsearPdfEstadoCuentaBanBajio(TEXTO_REAL_ESTADO_CUENTA_BALKEN_JULIO_2026);
  assert.equal(r.movimientos[0].folio, null);
});

test("las líneas de metadata de un depósito SPEI (INSTITUCIÓN EMISORA, ORDENANTE, CLAVE DE RASTREO...) no generan movimientos falsos", () => {
  const r = parsearPdfEstadoCuentaBanBajio(TEXTO_REAL_ESTADO_CUENTA_BALKEN_JULIO_2026);
  const nombres = r.movimientos.map((m) => m.nombreRazonSocial);
  assert.ok(!nombres.some((n) => n?.includes("INSTITUCIÓN EMISORA")));
  assert.ok(!nombres.some((n) => n?.includes("CLAVE DE RASTREO")));
});

test("si el total de movimientos parseado no cuadra con lo que el PDF declara, se reporta error de documento y no se inserta nada", () => {
  // Se le quita la última línea de movimiento real (31 JUL) para simular una
  // extracción incompleta -- el documento sigue diciendo que hay 14.
  const textoIncompleto = TEXTO_REAL_ESTADO_CUENTA_BALKEN_JULIO_2026.replace(
    "31 JUL 2669769 DEPÓSITO SPEI:TRASPASO $ 32,000.00 $ 40,727.21\n",
    "",
  );
  const r = parsearPdfEstadoCuentaBanBajio(textoIncompleto);
  assert.match(r.errorDocumento ?? "", /declara 14 movimientos.*13/);
  assert.equal(r.movimientos.length, 0);
});

test("un PDF sin la sección SALDO INICIAL...SALDO TOTAL reporta errorDocumento en vez de reventar", () => {
  const r = parsearPdfEstadoCuentaBanBajio("cualquier otro texto sin esa estructura");
  assert.match(r.errorDocumento ?? "", /año/);
});
