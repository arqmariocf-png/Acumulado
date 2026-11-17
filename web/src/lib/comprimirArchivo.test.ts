import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AHORRO_MINIMO,
  convieneComprimido,
  decidirCompresion,
  esPdfEscaneado,
  escalaParaLado,
  escalaPdf,
  fotoYaEstaBien,
  nombreComprimido,
  PDF_MINIMO_BYTES,
  textoCompresion,
} from "./comprimirArchivo.ts";

test("decidirCompresion: fotos sí, PDF solo si pesa, lo demás no", () => {
  assert.equal(decidirCompresion({ name: "foto.jpg", type: "image/jpeg", size: 4_000_000 }), "imagen");
  assert.equal(decidirCompresion({ name: "IMG_1.HEIC", type: "", size: 4_000_000 }), "imagen");
  assert.equal(decidirCompresion({ name: "captura.png", type: "image/png", size: 100 }), "imagen");
  assert.equal(decidirCompresion({ name: "logo.svg", type: "image/svg+xml", size: 100 }), "no");
  assert.equal(decidirCompresion({ name: "expediente.pdf", type: "application/pdf", size: 5_000_000 }), "pdf");
  assert.equal(decidirCompresion({ name: "cfdi.pdf", type: "application/pdf", size: PDF_MINIMO_BYTES - 1 }), "no");
  assert.equal(decidirCompresion({ name: "control.xlsm", type: "application/vnd.ms-excel.sheet.macroEnabled.12", size: 9_000_000 }), "no");
  assert.equal(decidirCompresion({ name: "plano.dwg", type: "", size: 20_000_000 }), "no");
});

test("escalaParaLado nunca agranda y respeta el lado mayor", () => {
  assert.equal(escalaParaLado(4000, 3000), 0.4);
  assert.equal(escalaParaLado(3000, 4000), 0.4);
  assert.equal(escalaParaLado(800, 600), 1);
  assert.equal(escalaParaLado(0, 0), 1);
  assert.equal(escalaParaLado(2000, 1000, 1000), 0.5);
});

test("fotoYaEstaBien: JPEG chico y dentro de 1600 px se deja igual", () => {
  assert.equal(fotoYaEstaBien({ name: "a.jpg", type: "image/jpeg", size: 200_000 }, 1200, 900), true);
  assert.equal(fotoYaEstaBien({ name: "a.jpg", type: "image/jpeg", size: 200_000 }, 4000, 3000), false);
  assert.equal(fotoYaEstaBien({ name: "a.jpg", type: "image/jpeg", size: 2_000_000 }, 1200, 900), false);
  assert.equal(fotoYaEstaBien({ name: "a.png", type: "image/png", size: 200_000 }, 1200, 900), false);
});

test("escalaPdf: 130 dpi sobre los 72 de pdf.js", () => {
  assert.ok(Math.abs(escalaPdf() - 130 / 72) < 1e-9);
  assert.equal(escalaPdf(72), 1);
});

test("esPdfEscaneado: casi sin texto = escaneado; con texto no se toca", () => {
  assert.equal(esPdfEscaneado([0, 0, 3]), true);
  assert.equal(esPdfEscaneado([12, 30, 20]), true);
  assert.equal(esPdfEscaneado([1500, 900]), false);
  assert.equal(esPdfEscaneado([0, 0, 0, 2000]), false);
  assert.equal(esPdfEscaneado([]), false);
});

test("convieneComprimido: solo si ahorra 15 % o más", () => {
  assert.equal(convieneComprimido(1000, 850), true);
  assert.equal(convieneComprimido(1000, 851), false);
  assert.equal(convieneComprimido(1000, 1200), false);
  assert.equal(convieneComprimido(1000, 0), false);
  assert.equal(AHORRO_MINIMO, 0.15);
});

test("nombreComprimido cambia la extensión y aguanta nombres raros", () => {
  assert.equal(nombreComprimido("IMG_0001.HEIC", "jpg"), "IMG_0001.jpg");
  assert.equal(nombreComprimido("expediente.ine.pdf", "pdf"), "expediente.ine.pdf");
  assert.equal(nombreComprimido("sin-extension", "jpg"), "sin-extension.jpg");
  assert.equal(nombreComprimido("", "pdf"), "archivo.pdf");
});

test("textoCompresion: MB → KB, y nada si no se comprimió", () => {
  assert.equal(textoCompresion({ tipo: "imagen", bytesOriginal: 3_900_000, bytesFinal: 290_000, comprimido: true }), "3.7 MB → 283 KB");
  assert.equal(textoCompresion({ tipo: "pdf", bytesOriginal: 5_300_000, bytesFinal: 900_000, comprimido: true }), "5.1 MB → 879 KB");
  assert.equal(textoCompresion({ tipo: "no", bytesOriginal: 100, bytesFinal: 100, comprimido: false }), null);
});
