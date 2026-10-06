import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorDia, csvHistorial, lunesDe, moverRango, rangoAtajo, totalesHistorial, type PagoHistorial } from "./historialPagos.ts";

const pago = (x: Partial<PagoHistorial>): PagoHistorial => ({
  id: "p",
  empresa_id: "e",
  empresa_nombre: "AEP",
  beneficiario: "Cemex",
  concepto: null,
  monto: 100,
  fecha_programada: "2026-10-01",
  pagado_en: "2026-10-01",
  metodo: "transferencia",
  referencia: null,
  id_orden: null,
  oc_proyecto: null,
  comprobante_nombre: null,
  comprobante_path: null,
  confirmado_en: null,
  ...x,
});

test("semana lunes a domingo", () => {
  assert.equal(lunesDe("2026-10-06"), "2026-10-05"); // martes → lunes
  assert.equal(lunesDe("2026-10-11"), "2026-10-05"); // domingo
  assert.deepEqual(rangoAtajo("semana", "2026-10-06"), { desde: "2026-10-05", hasta: "2026-10-11" });
  assert.deepEqual(rangoAtajo("semana_pasada", "2026-10-06"), { desde: "2026-09-28", hasta: "2026-10-04" });
});

test("meses y días", () => {
  assert.deepEqual(rangoAtajo("mes", "2026-12-15"), { desde: "2026-12-01", hasta: "2026-12-31" });
  assert.deepEqual(rangoAtajo("mes_pasado", "2026-03-10"), { desde: "2026-02-01", hasta: "2026-02-28" });
  assert.deepEqual(rangoAtajo("ayer", "2026-10-01"), { desde: "2026-09-30", hasta: "2026-09-30" });
});

test("mover el rango conserva su largo", () => {
  assert.deepEqual(moverRango({ desde: "2026-10-05", hasta: "2026-10-11" }, -1), { desde: "2026-09-28", hasta: "2026-10-04" });
  assert.deepEqual(moverRango({ desde: "2026-10-06", hasta: "2026-10-06" }, 1), { desde: "2026-10-07", hasta: "2026-10-07" });
});

test("agrupa por día de pago, el más reciente primero", () => {
  const dias = agruparPorDia([
    pago({ id: "a", pagado_en: "2026-10-01", monto: 50 }),
    pago({ id: "b", pagado_en: "2026-10-02", monto: 10, comprobante_path: "x" }),
    pago({ id: "c", pagado_en: "2026-10-01", monto: 80 }),
  ]);
  assert.deepEqual(dias.map((d) => d.fecha), ["2026-10-02", "2026-10-01"]);
  assert.equal(dias[1].total, 130);
  assert.equal(dias[1].pagos[0].id, "c");
  assert.equal(dias[1].sinComprobante, 2);
  assert.equal(dias[0].sinComprobante, 0);
});

test("totales separan efectivo y CSV escapa comas", () => {
  const t = totalesHistorial([pago({ monto: 100, metodo: "efectivo" }), pago({ monto: 50, comprobante_path: "x" })]);
  assert.deepEqual(t, { n: 2, total: 150, efectivo: 100, transferencia: 50, sinComprobante: 1 });
  const csv = csvHistorial([pago({ beneficiario: "Cemex, SA" })]);
  assert.ok(csv.includes('"Cemex, SA"'));
});
