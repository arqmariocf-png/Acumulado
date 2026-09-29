import { test } from "node:test";
import assert from "node:assert/strict";
import { armarTesoreria, semaforoTesoreria } from "./tesoreria.ts";

test("semaforoTesoreria: rojo si lo pendiente rebasa el saldo", () => {
  const s = semaforoTesoreria({ saldo_final: 1000, salidas: 0, pendientes_hoy: 1500, pagados_hoy: 0 });
  assert.equal(s.color, "rojo");
  assert.equal(s.disponible, -500);
});

test("semaforoTesoreria: ámbar mientras falte pagar", () => {
  const s = semaforoTesoreria({ saldo_final: 5000, salidas: 0, pendientes_hoy: 1200, pagados_hoy: 0 });
  assert.equal(s.color, "ambar");
  assert.equal(s.disponible, 3800);
});

test("semaforoTesoreria: ámbar si lo pagado aún no aparece en el banco, verde cuando cuadra", () => {
  assert.equal(semaforoTesoreria({ saldo_final: 5000, salidas: 0, pendientes_hoy: 0, pagados_hoy: 1200 }).color, "ambar");
  assert.equal(semaforoTesoreria({ saldo_final: 5000, salidas: 0, pendientes_hoy: 0, pagados_hoy: 1200 }).sin_reflejar, 1200);
  assert.equal(semaforoTesoreria({ saldo_final: 3800, salidas: 1200, pendientes_hoy: 0, pagados_hoy: 1200 }).color, "verde");
  assert.equal(semaforoTesoreria({ saldo_final: 0, salidas: 0, pendientes_hoy: 0, pagados_hoy: 0 }).color, "gris");
});

test("armarTesoreria cruza saldos y pagos por empresa; efectivo aparte; vencidos cuentan como hoy", () => {
  const filas = armarTesoreria(
    [
      { empresa_id: "a", empresa_nombre: "Alfa", saldo_final: 1000, salidas: 200 },
      { empresa_id: "a", empresa_nombre: "Alfa", saldo_final: 500, salidas: 0 },
    ],
    [
      { empresa_id: "a", empresa_nombre: "Alfa", monto: 300, fecha_programada: "2026-09-29", estatus: "pendiente", pagado_en: null, metodo: "transferencia" },
      { empresa_id: "a", empresa_nombre: "Alfa", monto: 100, fecha_programada: "2026-09-20", estatus: "pendiente", pagado_en: null, metodo: "transferencia" },
      { empresa_id: "a", empresa_nombre: "Alfa", monto: 50, fecha_programada: "2026-09-29", estatus: "pendiente", pagado_en: null, metodo: "efectivo" },
      { empresa_id: "a", empresa_nombre: "Alfa", monto: 200, fecha_programada: "2026-09-29", estatus: "pagado", pagado_en: "2026-09-29", metodo: "transferencia" },
      { empresa_id: "a", empresa_nombre: "Alfa", monto: 999, fecha_programada: "2026-10-05", estatus: "pendiente", pagado_en: null, metodo: "transferencia" },
      { empresa_id: "b", empresa_nombre: "Beta", monto: 10, fecha_programada: "2026-09-29", estatus: "pendiente", pagado_en: null, metodo: "transferencia" },
    ],
    "2026-09-29",
  );
  assert.equal(filas.length, 2);
  const a = filas[0];
  assert.equal(a.empresa_nombre, "Alfa");
  assert.equal(a.saldo_final, 1500);
  assert.equal(a.salidas, 200);
  assert.equal(a.pendientes_hoy, 400);
  assert.equal(a.efectivo_hoy, 50);
  assert.equal(a.pagados_hoy, 200);
  assert.equal(a.n_pendientes, 3);
  assert.equal(semaforoTesoreria(a).color, "ambar");
  assert.equal(filas[1].saldo_final, 0);
});
