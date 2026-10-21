import { test } from "node:test";
import assert from "node:assert/strict";
import { LOGO_MAXIMO, logoParaImprimir, logoValido, medidasLogo } from "./logoEmpresa.ts";

test("solo png, jpeg o webp en base64 y no más grande que el máximo", () => {
  assert.equal(logoValido("data:image/png;base64,AAAA"), true);
  assert.equal(logoValido("data:image/jpeg;base64,AAAA"), true);
  assert.equal(logoValido("data:image/svg+xml;base64,AAAA"), false);
  assert.equal(logoValido("https://x/logo.png"), false);
  assert.equal(logoValido(null), false);
  assert.equal(logoValido("data:image/png;base64," + "A".repeat(LOGO_MAXIMO)), false);
});

test("el logo cabe en la caja sin deformarse ni agrandarse", () => {
  assert.deepEqual(medidasLogo(1200, 240), { ancho: 600, alto: 120 });
  assert.deepEqual(medidasLogo(400, 800), { ancho: 120, alto: 240 });
  assert.deepEqual(medidasLogo(300, 100), { ancho: 300, alto: 100 });
  assert.deepEqual(medidasLogo(0, 100), { ancho: 0, alto: 0 });
});

test("documento: el logo subido o el archivo de siempre", () => {
  assert.equal(logoParaImprimir("data:image/png;base64,AAAA", "MCC", "https://a"), "data:image/png;base64,AAAA");
  assert.equal(logoParaImprimir(null, "MCC", "https://a"), "https://a/logos/mcc.png");
  assert.equal(logoParaImprimir("roto", " erg ", "https://a"), "https://a/logos/erg.png");
  assert.equal(logoParaImprimir(null, "", "https://a"), null);
});
