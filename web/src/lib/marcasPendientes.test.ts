import { test } from "node:test";
import assert from "node:assert/strict";
import { pendientesPorEnviar, yaRegistrada } from "./marcasPendientes.ts";

test("una marca local que ya está en el servidor se reconoce (±2 min, mismo tipo)", () => {
  const registros = [{ tipo: "entrada", created_at: "2026-10-09T14:07:21.000Z" }];
  assert.equal(yaRegistrada({ tipo: "entrada", marcadaEn: "2026-10-09T14:07:20.500Z" }, registros), true);
  assert.equal(yaRegistrada({ tipo: "salida", marcadaEn: "2026-10-09T14:07:20.500Z" }, registros), false);
  assert.equal(yaRegistrada({ tipo: "entrada", marcadaEn: "2026-10-09T14:12:00.000Z" }, registros), false);
});

test("las rechazadas no bloquean las marcas nuevas", () => {
  assert.deepEqual(pendientesPorEnviar([{ id: 1, error: "más de 7 días" }, { id: 2, error: null }, { id: 3 }]).map((m) => m.id), [2, 3]);
});
