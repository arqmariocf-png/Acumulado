import { test } from "node:test";
import assert from "node:assert/strict";
import { columnaHecha, esColumnaHecha, esErrorDeCandado, esNombreDeCierre, textoCierre } from "./cierreTarjetaReglas.ts";

test("la última columna por orden es Hecho, sin importar el orden del arreglo", () => {
  const cols = [
    { id: "hecho", orden: 2 },
    { id: "por-hacer", orden: 0 },
    { id: "en-proceso", orden: 1 },
  ];
  assert.equal(columnaHecha(cols), "hecho");
  assert.equal(esColumnaHecha(cols, "hecho"), true);
  assert.equal(esColumnaHecha(cols, "en-proceso"), false);
  assert.equal(columnaHecha([]), null);
  assert.equal(esColumnaHecha([], "x"), false);
});

test("tableros con columnas después de Hecho (RH · Actividades: Hecho → Archivados): las dos cierran, se termina en Hecho", () => {
  const cols = [
    { id: "ph", orden: 0, nombre: "Por hacer" },
    { id: "ep", orden: 1, nombre: "En progreso" },
    { id: "h", orden: 2, nombre: "Hecho" },
    { id: "a", orden: 3, nombre: "Archivados" },
  ];
  assert.equal(columnaHecha(cols), "h");
  assert.equal(esColumnaHecha(cols, "h"), true);
  assert.equal(esColumnaHecha(cols, "a"), true);
  assert.equal(esColumnaHecha(cols, "ep"), false);
  assert.equal(esNombreDeCierre("Terminadas"), true);
  assert.equal(esNombreDeCierre("Finalizó"), true);
  assert.equal(esNombreDeCierre("Formatos"), false);
  assert.equal(esNombreDeCierre(null), false);
});

test("solo el mensaje del candado dispara la solicitud; otros errores se propagan", () => {
  assert.equal(esErrorDeCandado("Dar por terminada una tarea requiere autorización de tu jefe inmediato: …"), true);
  assert.equal(esErrorDeCandado("La fecha compromiso ya está fijada (2026-11-20). Cambiarla requiere autorización de tu jefe inmediato"), true);
  assert.equal(esErrorDeCandado("new row violates row-level security policy"), false);
  assert.equal(esErrorDeCandado(null), false);
});

test("texto de la solicitud", () => {
  assert.equal(textoCierre({ solicitante_nombre: "Jonathan", titulo: "Colar losa", nota: "quedó lista", tablero: "Parque Real 63" }), "Jonathan terminó «Colar losa» (Parque Real 63): quedó lista");
  assert.equal(textoCierre({ solicitante_nombre: null, titulo: "X", nota: null, tablero: "T" }), "Alguien terminó «X» (T)");
});
