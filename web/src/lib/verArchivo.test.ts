import { test } from "node:test";
import assert from "node:assert/strict";
import { claseArchivo, consultaFirmada, esFuenteArchivo, rutaVerArchivo, urlDescarga } from "./verArchivo.ts";

test("ruta de la app y consulta a la función", () => {
  assert.equal(rutaVerArchivo("rh", "abc-1"), "/archivo?f=rh&id=abc-1");
  assert.equal(consultaFirmada("rh", "abc-1"), "rh-documentos?documentoId=abc-1");
  assert.equal(consultaFirmada("checador", "x"), "checador-marcar?registroId=x");
  assert.equal(consultaFirmada("pago", "a b"), "pagos-comprobante?id=a%20b");
});

test("solo fuentes conocidas", () => {
  assert.equal(esFuenteArchivo("rh"), true);
  assert.equal(esFuenteArchivo("toString"), false);
  assert.equal(esFuenteArchivo("../admin"), false);
  assert.equal(esFuenteArchivo(null), false);
});

test("clase por extensión, ignorando el token", () => {
  assert.equal(claseArchivo("https://x.supabase.co/storage/v1/object/sign/cargas/rh/ine.PDF?token=abc.pdf"), "pdf");
  assert.equal(claseArchivo("https://x/cargas/foto.jpeg?token=1"), "imagen");
  assert.equal(claseArchivo("https://x/cargas/plano.dwg?token=1"), "otro");
});

test("descargar en vez de mostrar", () => {
  assert.equal(rutaVerArchivo("tarea", "a1", { descargar: "Plano Nave 2.pdf" }), "/archivo?f=tarea&id=a1&descargar=Plano%20Nave%202.pdf");
  assert.equal(rutaVerArchivo("tarea", "a1", { descargar: "" }), "/archivo?f=tarea&id=a1&descargar=");
  assert.equal(urlDescarga("https://x/sign/a.xlsx?token=t", "Presupuesto.xlsx"), "https://x/sign/a.xlsx?token=t&download=Presupuesto.xlsx");
  assert.equal(urlDescarga("https://x/a.pdf"), "https://x/a.pdf?download=");
});
