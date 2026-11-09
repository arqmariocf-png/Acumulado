import { test } from "node:test";
import assert from "node:assert/strict";
import { choqueReserva, filtrarUnidades, normalizarPlacas, resumenAverias, reservasDelDia, revisarAveria, revisarReserva, revisarUnidad, semaforoUnidad, semanaDe, sumarDias, unidadesLibres } from "./logistica.ts";

const reservas = [
  { id: "r1", unidad_id: "u1", desde: "2026-11-10T08:00:00", hasta: "2026-11-10T14:00:00", estado: "programada" as const, titulo: "Viaje a Teziutlán" },
  { id: "r2", unidad_id: "u1", desde: "2026-11-11T09:00:00", hasta: "2026-11-12T18:00:00", estado: "cancelada" as const, titulo: "Cancelada" },
  { id: "r3", unidad_id: "u2", desde: "2026-11-10T07:00:00", hasta: "2026-11-10T20:00:00", estado: "en_curso" as const, titulo: "Obra Parque Real" },
];

test("unidad: nombre, empresa, año y placas repetidas", () => {
  assert.equal(revisarUnidad({ nombre: "N", empresa_id: "e1" }), "Escribe el nombre de la unidad (ej. Camioneta NP300 blanca).");
  assert.equal(revisarUnidad({ nombre: "NP300", empresa_id: "" }), "Elige la empresa dueña de la unidad.");
  assert.equal(revisarUnidad({ nombre: "NP300", empresa_id: "e1", anio: "1900" }), "El año no es válido.");
  assert.equal(revisarUnidad({ nombre: "NP300", empresa_id: "e1", placas: "abc-12-34" }, [{ id: "x", empresa_id: "e1", placas: "ABC1234" }]), "Ya hay una unidad con placas ABC1234 en esa empresa.");
  assert.equal(revisarUnidad({ nombre: "NP300", empresa_id: "e1", placas: "abc-12-34" }, [{ id: "x", empresa_id: "e1", placas: "ABC1234" }], "x"), null);
  assert.equal(revisarUnidad({ nombre: "NP300", empresa_id: "e2", placas: "abc-12-34", anio: 2019 }, [{ id: "x", empresa_id: "e1", placas: "ABC1234" }]), null);
  assert.equal(normalizarPlacas(" xy-9 8z "), "XY98Z");
  assert.equal(normalizarPlacas(""), null);
});

test("reservas: no se enciman las vivas; las canceladas no estorban", () => {
  assert.equal(choqueReserva({ unidad_id: "u1", desde: "2026-11-10T13:00:00", hasta: "2026-11-10T15:00:00" }, reservas)?.id, "r1");
  assert.equal(choqueReserva({ unidad_id: "u1", desde: "2026-11-10T14:00:00", hasta: "2026-11-10T16:00:00" }, reservas), null);
  assert.equal(choqueReserva({ unidad_id: "u1", desde: "2026-11-11T10:00:00", hasta: "2026-11-11T12:00:00" }, reservas), null);
  assert.equal(choqueReserva({ id: "r1", unidad_id: "u1", desde: "2026-11-10T09:00:00", hasta: "2026-11-10T15:00:00" }, reservas), null);
  assert.match(revisarReserva({ unidad_id: "u1", desde: "2026-11-10T13:00:00", hasta: "2026-11-10T15:00:00", titulo: "Otro viaje" }, reservas) ?? "", /ya está reservada: Viaje a Teziutlán/);
  assert.equal(revisarReserva({ unidad_id: "u1", desde: "2026-11-10T15:00:00", hasta: "2026-11-10T14:00:00", titulo: "Otro viaje" }, reservas), "La hora de regreso debe ser después de la salida.");
  assert.equal(revisarReserva({ unidad_id: "u3", desde: "2026-11-10T15:00:00", hasta: "2026-11-10T16:00:00", titulo: "Otro viaje" }, reservas, [{ id: "u3", estado: "baja" }]), "Esa unidad está dada de baja.");
  assert.equal(revisarReserva({ unidad_id: "u1", desde: "2026-11-10T15:00:00", hasta: "2026-11-10T16:00:00", titulo: "Otro viaje" }, reservas), null);
  assert.deepEqual(unidadesLibres([{ id: "u1", estado: "activa" }, { id: "u2", estado: "activa" }, { id: "u3", estado: "taller" }], reservas, "2026-11-10T12:00:00", "2026-11-10T13:00:00"), []);
  assert.deepEqual(unidadesLibres([{ id: "u1", estado: "activa" }, { id: "u2", estado: "activa" }], reservas, "2026-11-10T21:00:00", "2026-11-10T22:00:00"), ["u1", "u2"]);
});

test("calendario: semana lunes a domingo y reservas que tocan el día", () => {
  assert.deepEqual(semanaDe("2026-11-11"), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  assert.equal(semanaDe("2026-11-15")[0], "2026-11-09");
  assert.equal(sumarDias("2026-11-09", 7), "2026-11-16");
  assert.deepEqual(reservasDelDia(reservas, "u1", "2026-11-10").map((r) => r.id), ["r1"]);
  assert.deepEqual(reservasDelDia(reservas, "u1", "2026-11-11").map((r) => r.id), []);
  assert.deepEqual(reservasDelDia(reservas, "u1", "2026-11-11", true).map((r) => r.id), ["r2"]);
  assert.deepEqual(reservasDelDia(reservas, "u2", "2026-11-10").map((r) => r.id), ["r3"]);
});

test("averías: validación, semáforo de la unidad y resumen", () => {
  assert.equal(revisarAveria({ unidad_id: "", descripcion: "x", gravedad: "leve" }), "Elige la unidad con la avería.");
  assert.equal(revisarAveria({ unidad_id: "u1", descripcion: "ruido", gravedad: "leve" }), "Describe la avería (qué falla, desde cuándo).");
  assert.equal(revisarAveria({ unidad_id: "u1", descripcion: "Se calienta el motor en subida", gravedad: "grave", kilometraje: "-1" }), "El kilometraje no es válido.");
  assert.equal(revisarAveria({ unidad_id: "u1", descripcion: "Se calienta el motor en subida", gravedad: "grave", kilometraje: "125000" }), null);
  const averias = [
    { unidad_id: "u1", estado: "abierta" as const, gravedad: "leve" as const, costo: null },
    { unidad_id: "u2", estado: "abierta" as const, gravedad: "grave" as const, costo: null },
    { unidad_id: "u2", estado: "resuelta" as const, gravedad: "media" as const, costo: 2500 },
    { unidad_id: "u4", estado: "en_taller" as const, gravedad: "media" as const, costo: null },
  ];
  assert.equal(semaforoUnidad({ id: "u1", estado: "activa" }, averias), "ambar");
  assert.equal(semaforoUnidad({ id: "u2", estado: "activa" }, averias), "rojo");
  assert.equal(semaforoUnidad({ id: "u3", estado: "activa" }, averias), "verde");
  assert.equal(semaforoUnidad({ id: "u4", estado: "taller" }, averias), "rojo");
  assert.equal(semaforoUnidad({ id: "u5", estado: "baja" }, averias), "gris");
  assert.deepEqual(resumenAverias(averias), { abiertas: 2, enTaller: 1, graves: 1, costoResueltas: 2500 });
});

test("filtro de unidades sin acentos", () => {
  const us = [
    { nombre: "Camión Kenworth", placas: "AB1234", folio: "UN-CSC-0001", marca: "Kenworth", modelo: "T680", chofer_nombre: "José Pérez" },
    { nombre: "NP300", placas: "XY9876", folio: "UN-CSC-0002", marca: "Nissan", modelo: null, chofer_nombre: null },
  ];
  assert.equal(filtrarUnidades(us, "camion").length, 1);
  assert.equal(filtrarUnidades(us, "jose").length, 1);
  assert.equal(filtrarUnidades(us, "xy98")[0].nombre, "NP300");
  assert.equal(filtrarUnidades(us, "").length, 2);
});
