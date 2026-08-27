import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearPdfEstadoCuentaBanBajio } from "./pdf-estado-cuenta.ts";
import { TEXTO_REAL_BANBAJIO_CONECTA_MALLAS_AGOSTO_2026 } from "./pdf-estado-cuenta-banbajio-conecta.fixture.ts";

test("parsea el PDF real de BanBajío formato 'Conecta BanBajío' (Mallas y Clavos Clavicón, cuenta 9403, agosto 2026): 24 movimientos, cuadra exacto con lo que el banco declara", () => {
  const r = parsearPdfEstadoCuentaBanBajio(TEXTO_REAL_BANBAJIO_CONECTA_MALLAS_AGOSTO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 24);

  const sumaAbonos = Math.round(r.movimientos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
  const sumaCargos = Math.round(r.movimientos.reduce((a, m) => a + (m.cargoTotal ?? 0), 0) * 100) / 100;
  assert.equal(sumaAbonos, 137000);
  assert.equal(sumaCargos, 119379.71);
});

test("los movimientos quedan en orden cronológico (más antiguo primero), aunque el PDF los lista al revés", () => {
  const r = parsearPdfEstadoCuentaBanBajio(TEXTO_REAL_BANBAJIO_CONECTA_MALLAS_AGOSTO_2026);
  const primero = r.movimientos[0];
  const ultimo = r.movimientos[r.movimientos.length - 1];
  assert.equal(primero.fechaPago, "2026-08-03");
  assert.equal(primero.cargoTotal, 11799.71);
  assert.equal(primero.saldo, 8215.05);
  assert.equal(ultimo.fechaPago, "2026-08-21");
  assert.equal(ultimo.abonoTotal, 30000);
  assert.equal(ultimo.saldo, 37635.05);
});

test("un monto embebido en la descripción (ej. 'por (17,000.00) mxn') no se cuenta como el monto real del renglón -- se usan los últimos 2 montos de la línea", () => {
  const r = parsearPdfEstadoCuentaBanBajio(TEXTO_REAL_BANBAJIO_CONECTA_MALLAS_AGOSTO_2026);
  const traspaso = r.movimientos.find((m) => m.nombreRazonSocial?.includes("Recibo # 3340703018852"))!;
  assert.ok(traspaso, "debe existir el SPEI enviado con recibo 3340703018852 mencionado en la descripción");
  assert.equal(traspaso.cargoTotal, 17000);
  assert.equal(traspaso.saldo, 7635.05);
  assert.doesNotMatch(traspaso.nombreRazonSocial ?? "", /\$/);
});

test("un movimiento con monto $0.00 (IVA/Comisión sin cobro) se clasifica como cargo por convención, no bloquea el documento", () => {
  const r = parsearPdfEstadoCuentaBanBajio(TEXTO_REAL_BANBAJIO_CONECTA_MALLAS_AGOSTO_2026);
  const ceros = r.movimientos.filter((m) => m.cargoTotal === 0);
  assert.ok(ceros.length > 0, "debe haber al menos un movimiento de $0.00");
  for (const m of ceros) {
    assert.equal(m.abonoTotal, null);
  }
});

test("un PDF sin ninguno de los dos encabezados conocidos reporta el mismo error genérico de siempre", () => {
  const r = parsearPdfEstadoCuentaBanBajio("cualquier otro texto sin la tabla");
  assert.match(r.errorDocumento ?? "", /No se pudo determinar el año/);
});
