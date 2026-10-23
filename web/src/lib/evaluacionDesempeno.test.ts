import { test } from "node:test";
import assert from "node:assert/strict";
import { calificar, criteriosCompletos, htmlEvaluacion, nivelDe, periodoSugerido, puntosCriterios, puntosTareas, type ResumenTareas } from "./evaluacionDesempeno.ts";

const R: ResumenTareas = { total: 10, hechas: 8, a_tiempo: 6, tarde: 2, vencidas: 1, pendientes: 1, cambios_fecha: 1, como_responsable: 7, dias_con_entrada: 20, dias_habiles: 22 };

test("puntos por tareas: 60 % hechas, 40 % a tiempo, menos cambios de fecha", () => {
  // 80 % hechas → 48; 75 % a tiempo de las hechas → 30; 1 cambio de fecha → −2.
  assert.equal(puntosTareas(R), 76);
  assert.equal(puntosTareas({ ...R, total: 0 }), null);
  assert.equal(puntosTareas({ ...R, hechas: 0, a_tiempo: 0, cambios_fecha: 0 }), 0);
  assert.equal(puntosTareas({ ...R, hechas: 10, a_tiempo: 10, cambios_fecha: 9 }), 90); // castigo tope 10
});

test("criterios 1-5 a 0-100 y calificación final", () => {
  assert.equal(puntosCriterios({}), null);
  assert.equal(puntosCriterios({ calidad: 5, puntualidad: 3 }), 80);
  const c = calificar(R, { calidad: 4, puntualidad: 4, responsabilidad: 4, equipo: 4, iniciativa: 4, actitud: 4 });
  assert.equal(c.criterios, 80);
  assert.equal(c.calificacion, 78.4); // 76 × 0.4 + 80 × 0.6
  assert.equal(c.nivel, "bueno");
  assert.equal(calificar({ ...R, total: 0 }, { calidad: 5 }).calificacion, 100); // sin tareas: solo criterios
  assert.equal(calificar(R, {}).calificacion, 76); // sin criterios: solo tareas
  assert.equal(calificar({ ...R, total: 0 }, {}).nivel, "sin_datos");
  assert.equal(nivelDe(90), "sobresaliente");
  assert.equal(nivelDe(59.9), "bajo");
  assert.equal(criteriosCompletos({ calidad: 4 }), false);
});

test("periodo sugerido", () => {
  assert.deepEqual(periodoSugerido("2026-10-23", "mes"), { desde: "2026-09-01", hasta: "2026-09-30" });
  assert.deepEqual(periodoSugerido("2026-10-23", "trimestre"), { desde: "2026-07-23", hasta: "2026-10-23" });
  assert.deepEqual(periodoSugerido("2026-03-05", "semestre"), { desde: "2025-09-05", hasta: "2026-03-05" });
});

test("formato imprimible", () => {
  const html = htmlEvaluacion(
    {
      nombre: "Jonathan <Cáceres>", puesto: "Supervisor", empresa: "ERG", area: "Obra", jefe: "Jorge", fecha_ingreso: "2024-02-01",
      periodo_desde: "2026-07-01", periodo_hasta: "2026-09-30", evaluador: "Eréndira", fecha: "2026-10-23",
      datos: { persona: { nombre: "Jonathan", puesto: null, area: null, fecha_ingreso: null, jefe: null, empresa: null }, resumen: R, tareas: [{ id: "1", titulo: "Subir plano", tablero: "Obra X", tablero_id: "t", fecha_limite: "2026-08-01", hecha: true, hecha_en: "2026-07-30", a_tiempo: true, vencida: false, responsable: true, cambios_fecha: 0 }] },
      criterios: { calidad: 4 }, fortalezas: "Ordenado", mejoras: null, acuerdos: "Cerrar pendientes", firmada: true,
    },
    null,
  );
  assert.match(html, /Jonathan &lt;Cáceres&gt;/);
  assert.match(html, /FIRMADA/);
  assert.match(html, /Subir plano.*A tiempo/s);
  assert.match(html, /Calificación: 78\.4 \/ 100/); // 76 × 0.4 + 80 × 0.6
});
