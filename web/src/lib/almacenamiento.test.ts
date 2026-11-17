import { test } from "node:test";
import assert from "node:assert/strict";
import { ahorroEstimado, crecimientoMensual, ladoParaCarpeta, mb, ordenarCandidatos, textoAvance } from "./almacenamiento.ts";

test("ladoParaCarpeta: checador a 800, lo demás a 1600", () => {
  assert.equal(ladoParaCarpeta("checador"), 800);
  assert.equal(ladoParaCarpeta("rh"), 1600);
  assert.equal(ladoParaCarpeta("tareas"), 1600);
});

test("mb formatea KB, MB y GB", () => {
  assert.equal(mb(500), "1 KB");
  assert.equal(mb(300 * 1024), "300 KB");
  assert.equal(mb(5.25 * 1024 * 1024), "5.3 MB");
  assert.equal(mb(1.03 * 1024 * 1024 * 1024), "1.03 GB");
});

test("textoAvance arma el resumen del progreso", () => {
  assert.equal(textoAvance({ hechos: 12, total: 74, ahorrados: 210.3 * 1024 * 1024, sinCambio: 0, errores: [] }), "12 de 74 · ahorrados 210.3 MB");
  assert.equal(textoAvance({ hechos: 74, total: 74, ahorrados: 0, sinCambio: 2, errores: ["x"] }), "74 de 74 · ahorrados 1 KB · 2 sin cambio · 1 error(es)");
});

test("ordenarCandidatos: los más pesados primero, sin tocar la lista original", () => {
  const lista = [
    { ruta: "a", mime: "application/pdf", bytes: 100, creado: "" },
    { ruta: "b", mime: "application/pdf", bytes: 900, creado: "" },
  ];
  assert.deepEqual(ordenarCandidatos(lista).map((c) => c.ruta), ["b", "a"]);
  assert.equal(lista[0].ruta, "a");
});

test("ahorroEstimado por tipo de carpeta", () => {
  const base = { archivos: 10, bytes: 1000, imagenes: 0, pdfs: 10, recomprimible: true, candidatos: 10, bytes_candidatos: 1000, ultimo: null };
  assert.equal(ahorroEstimado({ ...base, carpeta: "rh" }), 800);
  assert.equal(ahorroEstimado({ ...base, carpeta: "checador", imagenes: 10, pdfs: 0 }), 400);
  assert.equal(ahorroEstimado({ ...base, carpeta: "tareas", imagenes: 8, pdfs: 2 }), 600);
  assert.equal(ahorroEstimado({ ...base, carpeta: "planos", recomprimible: false }), 0);
  assert.equal(ahorroEstimado({ ...base, carpeta: "rh", candidatos: 0 }), 0);
});

test("crecimientoMensual con selfies de ~80 KB", () => {
  assert.equal(crecimientoMensual(1000), 80 * 1024 * 1000);
  assert.equal(crecimientoMensual(-5), 0);
});
