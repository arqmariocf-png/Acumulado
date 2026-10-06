import { test } from "node:test";
import assert from "node:assert/strict";
import { diasDesde, esContabilidad, lunesDeSemana, veTesoreriaEnInicio } from "./puestos.ts";

test("contabilidad y tesorería son por persona, no por rol", () => {
  const belen = { rol: "corporativo", modulos: ["legal", "contabilidad"] };
  const delia = { rol: "corporativo", modulos: ["tesoreria"] };
  assert.equal(esContabilidad(belen), true);
  assert.equal(veTesoreriaEnInicio(belen), false);
  assert.equal(veTesoreriaEnInicio(delia), true);
  assert.equal(veTesoreriaEnInicio({ rol: "direccion" }), true);
  assert.equal(veTesoreriaEnInicio({ rol: "corporativo", modulos: [] }), false);
});

test("semana y días", () => {
  assert.equal(lunesDeSemana("2026-10-09"), "2026-10-05"); // viernes
  assert.equal(lunesDeSemana("2026-10-11"), "2026-10-05"); // domingo
  assert.equal(diasDesde("2026-08-26", "2026-10-06"), 41);
  assert.equal(diasDesde(null, "2026-10-06"), null);
});
