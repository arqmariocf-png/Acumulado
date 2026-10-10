import { test } from "node:test";
import assert from "node:assert/strict";
import { cargasPorDia, diasSinCarga, resumenPorEmpresa, type MovimientoResumen } from "./resumenInventario.ts";

const m = (o: Partial<MovimientoResumen>): MovimientoResumen => ({
  empresa_id: "AEP", tipo: "entrada", cantidad: 1, costo_unitario: null, fecha: "2026-10-07",
  es_ajuste: false, registrado_por: "u1", created_at: "2026-10-07T18:00:00Z", ...o,
});

test("agrupa por el día de captura en hora de México", () => {
  const dias = cargasPorDia([
    m({ cantidad: 2, costo_unitario: 10, orden_compra_id: "oc" }),
    m({ tipo: "salida", empresa_id: "MCC", registrado_por: "u2" }),
    // 02:00 UTC del 24 = 20:00 del 23 en México; fecha capturada otro día.
    m({ created_at: "2026-09-24T02:00:00Z", fecha: "2026-09-24", es_ajuste: true }),
  ]);
  assert.equal(dias.length, 2);
  assert.equal(dias[0].dia, "2026-10-07");
  assert.equal(dias[0].movimientos, 2);
  assert.equal(dias[0].entradas, 1);
  assert.equal(dias[0].salidas, 1);
  assert.equal(dias[0].valorEntradas, 20);
  assert.equal(dias[0].conOc, 1);
  assert.deepEqual(dias[0].empresas.sort(), ["AEP", "MCC"]);
  assert.equal(dias[0].quienes.length, 2);
  assert.equal(dias[1].dia, "2026-09-23");
  assert.equal(dias[1].conOtraFecha, 1);
  assert.equal(dias[1].ajustes, 1);
});

test("resumen por empresa suma almacenes por producto", () => {
  const r = resumenPorEmpresa(
    [
      { empresa_id: "AEP", producto_id: "p1", existencia: 3, valor: 30 },
      { empresa_id: "AEP", producto_id: "p1", existencia: -1, valor: -10 },
      { empresa_id: "AEP", producto_id: "p2", existencia: -2, valor: 0 },
      { empresa_id: "AEP", producto_id: "p3", existencia: 0, valor: 0 },
    ],
    [m({}), m({ created_at: "2026-09-03T16:00:00Z", fecha: "2026-09-03" })],
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].productos, 3);
  assert.equal(r[0].conExistencia, 1);
  assert.equal(r[0].negativos, 1);
  assert.equal(r[0].valor, 20);
  assert.equal(r[0].primeraCarga, "2026-09-03");
  assert.equal(r[0].ultimaCarga, "2026-10-07");
  assert.equal(r[0].diasConCarga, 2);
});

test("días hábiles sin captura", () => {
  assert.equal(diasSinCarga("2026-10-07", "2026-10-10"), 3); // jue, vie, sáb
  assert.equal(diasSinCarga("2026-10-10", "2026-10-12"), 1); // domingo no cuenta
  assert.equal(diasSinCarga(null, "2026-10-10"), null);
});
