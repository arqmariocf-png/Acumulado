import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bloqueos,
  calendarioDescuentos,
  descuentoPorPago,
  dictamen,
  nivelPorClave,
  pagosMinimos,
  proximoViernes,
  puntaje,
  topesLegales,
  type FactoresEstudio,
} from "./cuentaNomina.ts";

const base: FactoresEstudio = {
  meses_antiguedad: 30,
  sueldo_semanal: 4000,
  checa: true,
  constancia_30: 76,
  cumplimiento_30: 88,
  activos_perdidos: 0,
  herramienta_vencida: 0,
  cargos_liquidados: 0,
  cargos_liquidados_tarde: 0,
  atraso: 0,
};

test("topes de ley con el salario mínimo 2026 ($315.04 diarios)", () => {
  assert.deepEqual(topesLegales(4000), { deudaMaxima: 17142.86, descuentoMaximo: 538.42 });
  assert.deepEqual(topesLegales(2600), { deudaMaxima: 11142.86, descuentoMaximo: 118.42 });
  assert.equal(topesLegales(2205).descuentoMaximo, 0); // gana el mínimo
  assert.equal(topesLegales(null).deudaMaxima, 0);
});

test("puntaje: antigüedad, asistencia, cumplimiento, cuidado e historial", () => {
  const p = puntaje(base);
  assert.deepEqual(
    p.partes.map((x) => [x.clave, x.puntos]),
    [["antiguedad", 30], ["puntualidad", 11], ["cumplimiento", 13], ["cuidado", 10], ["pago", 12]],
  );
  assert.equal(p.total, 76);
  // Sin checador ni tareas: neutro (la mitad).
  assert.equal(puntaje({ ...base, checa: false, cumplimiento_30: null }).total, 67);
  // Pagar a tiempo sube; perder herramienta baja.
  assert.equal(puntaje({ ...base, cargos_liquidados: 3 }).partes[4].puntos, 30);
  assert.equal(puntaje({ ...base, activos_perdidos: 1, herramienta_vencida: 1 }).partes[3].puntos, 2);
  assert.equal(puntaje({ ...base, atraso: 100 }).partes[4].puntos, 0);
});

test("dictamen: nivel, línea dentro de ley y lo que falta para subir", () => {
  const d = dictamen(base);
  assert.equal(d.nivel.clave, "oro");
  // 75% de un mes = 12,857 pero el tope semanal manda: 538.42 × 8 = 4,307 → 4,300.
  assert.equal(d.lineaSugerida, 4300);
  assert.equal(d.plazo, 8);
  assert.deepEqual(d.siguiente && [d.siguiente.nivel.clave, d.siguiente.faltan], ["diamante", 9]);
  const dia = dictamen({ ...base, cargos_liquidados: 3, constancia_30: 100, cumplimiento_30: 100 });
  assert.equal(dia.nivel.clave, "diamante");
  assert.equal(dia.lineaSugerida, 6450); // 538.42 × 12
  assert.equal(dia.siguiente, null);
});

test("bloqueos: antigüedad, atraso, sin sueldo o salario mínimo", () => {
  assert.deepEqual(bloqueos({ ...base, meses_antiguedad: 1 }), ["Menos de 3 meses de antigüedad"]);
  assert.deepEqual(bloqueos({ ...base, sueldo_semanal: null }), ["Falta el sueldo semanal"]);
  assert.deepEqual(bloqueos({ ...base, sueldo_semanal: 2100 }), ["Gana el mínimo: la ley no permite descontarle"]);
  const d = dictamen({ ...base, atraso: 50 });
  assert.equal(d.nivel.clave, "sin_acceso");
  assert.equal(d.lineaSugerida, 0);
  assert.equal(nivelPorClave("nada").clave, "sin_acceso");
});

test("pagos y calendario de descuentos (viernes, sin intereses)", () => {
  assert.equal(pagosMinimos(1000, 538.42), 2);
  assert.equal(pagosMinimos(1076.84, 538.42), 2);
  assert.equal(pagosMinimos(100, 0), Infinity);
  assert.equal(descuentoPorPago(1000, 3), 333.34);
  assert.equal(proximoViernes("2026-10-18"), "2026-10-23");
  assert.equal(proximoViernes("2026-10-23"), "2026-10-23");
  assert.deepEqual(calendarioDescuentos(1000, 3, "2026-10-23"), [
    { fecha: "2026-10-23", monto: 333.34 },
    { fecha: "2026-10-30", monto: 333.34 },
    { fecha: "2026-11-06", monto: 333.32 },
  ]);
});
