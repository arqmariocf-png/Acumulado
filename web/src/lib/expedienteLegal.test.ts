import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoVencimiento, resumenExpediente, textoVencimiento, venceSugerido } from "./expedienteLegal.ts";

test("semáforo de vencimiento", () => {
  assert.deepEqual(estadoVencimiento(null, "2026-10-02"), { estado: "sin_vencimiento", dias: null });
  assert.deepEqual(estadoVencimiento("2026-10-01", "2026-10-02"), { estado: "vencido", dias: -1 });
  assert.deepEqual(estadoVencimiento("2026-10-02", "2026-10-02"), { estado: "por_vencer", dias: 0 });
  assert.deepEqual(estadoVencimiento("2026-11-01", "2026-10-02"), { estado: "por_vencer", dias: 30 });
  assert.deepEqual(estadoVencimiento("2026-11-02", "2026-10-02"), { estado: "vigente", dias: 31 });
  assert.equal(textoVencimiento("2026-09-22", "2026-10-02"), "vencido hace 10 d");
  assert.equal(textoVencimiento("2026-10-02", "2026-10-02"), "vence hoy");
  assert.equal(textoVencimiento("2026-10-12", "2026-10-02"), "vence en 10 d");
});

test("vencimiento sugerido por tipo", () => {
  assert.equal(venceSugerido("opinion_sat", "2026-10-02"), "2026-11-01");
  assert.equal(venceSugerido("licencia_funcionamiento", "2026-01-15"), "2027-01-15");
  assert.equal(venceSugerido("acta_constitutiva", "2026-01-15"), null);
  assert.equal(venceSugerido("opinion_sat", null), null);
});

test("resumen del expediente", () => {
  const r = resumenExpediente(
    [
      { vence: "2026-09-01", storage_path: "x" },
      { vence: "2026-10-20", storage_path: null },
      { vence: null, storage_path: "y" },
    ],
    [
      { tipo: "protocolizacion", estatus: "pendiente" },
      { tipo: "protocolizacion", estatus: "en_notaria" },
      { tipo: "protocolizacion", estatus: "protocolizada" },
      { tipo: "observacion", estatus: "pendiente" },
    ],
    "2026-10-02",
  );
  assert.deepEqual(r, { vencidos: 1, porVencer: 1, vigentes: 1, sinArchivo: 1, pendientesProtocolizar: 2 });
});
