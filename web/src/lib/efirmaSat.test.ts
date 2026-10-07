import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoEfirma, revisarArchivos } from "./efirmaSat.ts";

const hoy = new Date("2026-10-07T12:00:00Z");

test("estado de vigencia de la e.firma", () => {
  assert.equal(estadoEfirma(null, hoy), "sin_efirma");
  assert.equal(estadoEfirma("2026-10-01T00:00:00Z", hoy), "vencida");
  assert.equal(estadoEfirma("2026-11-20T00:00:00Z", hoy), "por_vencer");
  assert.equal(estadoEfirma("2028-05-01T00:00:00Z", hoy), "vigente");
});

test("revisión de archivos antes de subir", () => {
  const cer = { name: "aep.cer", size: 1500 };
  const key = { name: "Claveprivada_FIEL_AEL.key", size: 1300 };
  assert.equal(revisarArchivos(cer, key, "x"), null);
  assert.equal(revisarArchivos(null, key, "x"), "Falta el archivo .cer.");
  assert.match(revisarArchivos(key, cer, "x") ?? "", /\.cer/);
  assert.match(revisarArchivos(cer, key, "") ?? "", /contraseña/);
  assert.match(revisarArchivos({ name: "a.cer", size: 900_000 }, key, "x") ?? "", /KB/);
});
