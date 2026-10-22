import { test } from "node:test";
import assert from "node:assert/strict";
import { esIos, modoImpresion } from "./modoImpresion.ts";

const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";

test("iPhone y iPad usan blob; la computadora escribe el HTML", () => {
  assert.equal(modoImpresion(IPHONE, "iPhone", 5), "blob");
  assert.equal(modoImpresion(SAFARI_MAC, "MacIntel", 5), "blob"); // iPad que se presenta como Mac
  assert.equal(modoImpresion(SAFARI_MAC, "MacIntel", 0), "escribir");
  assert.equal(modoImpresion("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140", "Win32", 0), "escribir");
  assert.equal(esIos("Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile", "Linux armv8l", 5), false);
});
