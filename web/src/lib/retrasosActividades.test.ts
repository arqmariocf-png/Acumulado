import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActividadBase } from "./cumplimiento.ts";
import { diasRetraso, htmlFormatoRetrasos, retrasosPorPersona, textoRetraso } from "./retrasosActividades.ts";

const HOY = "2026-11-27";
const base = (x: Partial<ActividadBase> & { id: string }): ActividadBase => ({
  titulo: x.id, asignado_a: "a", fecha_limite: null, hecha: false, hecha_en: null, created_at: "2026-11-01T10:00:00Z", ...x,
});

test("diasRetraso: vencida cuenta hasta hoy, tarde hasta que se terminó", () => {
  assert.equal(diasRetraso(base({ id: "1", fecha_limite: "2026-11-13" }), HOY), 14);
  assert.equal(diasRetraso(base({ id: "2", fecha_limite: "2026-11-13", hecha: true, hecha_en: "2026-11-17T20:00:00Z" }), HOY), 4);
  assert.equal(diasRetraso(base({ id: "3", fecha_limite: "2026-11-13", hecha: true, hecha_en: "2026-11-12T20:00:00Z" }), HOY), 0);
  assert.equal(diasRetraso(base({ id: "4", fecha_limite: "2026-11-30" }), HOY), 0);
  assert.equal(diasRetraso(base({ id: "5" }), HOY), 0);
});

test("textoRetraso", () => {
  assert.equal(textoRetraso(1, "vencida"), "1 día de retraso");
  assert.equal(textoRetraso(4, "tarde"), "entregada con 4 días de retraso");
  assert.equal(textoRetraso(0, "vencida"), "");
});

test("retrasosPorPersona agrupa y ordena por días", () => {
  const r = retrasosPorPersona(
    [
      base({ id: "1", fecha_limite: "2026-11-13" }),
      base({ id: "2", fecha_limite: "2026-11-20", hecha: true, hecha_en: "2026-11-22T10:00:00Z" }),
      base({ id: "3", asignado_a: "b", fecha_limite: "2026-11-26" }),
      base({ id: "4", asignado_a: "c", fecha_limite: "2026-11-30" }),
    ],
    HOY,
    (id) => (id ?? "Sin asignar").toUpperCase(),
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].nombre, "A");
  assert.equal(r[0].dias_total, 16);
  assert.equal(r[0].vencidas, 1);
  assert.equal(r[0].tarde, 1);
  assert.equal(r[0].dias_max, 14);
  assert.equal(r[0].dias_promedio, 8);
  assert.equal(r[0].renglones[0].id, "1");
  assert.equal(r[1].dias_total, 1);
  const html = htmlFormatoRetrasos(r, { organizacion: "Grupo Loma", hoy: HOY });
  assert.match(html, /Retraso en la entrega de actividades/);
  assert.match(html, /sin terminar/);
  assert.match(html, /27\/11\/2026/);
});
