import { test } from "node:test";
import assert from "node:assert/strict";
import { armarReporteChecador, csvReporteChecador, formatoHoras, htmlReporteChecador, totalesPorPersona, type MarcaReporte } from "./reporteChecador.ts";

// 9-oct-2026 en México = UTC-6.
const m = (profile_id: string, nombre: string, tipo: MarcaReporte["tipo"], horaMx: string, fecha = "2026-10-09", anulada = false): MarcaReporte => ({
  profile_id,
  nombre,
  tipo,
  created_at: new Date(`${fecha}T${horaMx}:00-06:00`).toISOString(),
  anulada,
});

test("día completo: 4 etapas y horas activas sin la comida", () => {
  const filas = armarReporteChecador([
    m("a", "Ana", "entrada", "08:00"),
    m("a", "Ana", "comida_inicio", "14:00"),
    m("a", "Ana", "comida_fin", "15:00"),
    m("a", "Ana", "salida", "18:30"),
  ]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].fecha, "2026-10-09");
  assert.equal(filas[0].minutos, 9.5 * 60);
  assert.deepEqual(filas[0].faltan, []);
  assert.equal(formatoHoras(filas[0].minutos), "9:30 h");
});

test("sin comida cuenta todo; sin salida no hay horas; anuladas no cuentan", () => {
  const filas = armarReporteChecador([
    m("b", "Beto", "entrada", "09:00"),
    m("b", "Beto", "salida", "17:00"),
    m("c", "Caro", "entrada", "08:10"),
    m("c", "Caro", "salida", "12:00", "2026-10-09", true),
  ]);
  const beto = filas.find((f) => f.nombre === "Beto")!;
  assert.equal(beto.minutos, 8 * 60);
  assert.deepEqual(beto.faltan, ["salida a comer", "regreso de comer"]);
  const caro = filas.find((f) => f.nombre === "Caro")!;
  assert.equal(caro.minutos, null);
  assert.ok(caro.faltan.includes("salida"));
});

test("entrada repetida toma la primera y salida la última; separa días; totales", () => {
  const filas = armarReporteChecador([
    m("a", "Ana", "entrada", "08:05"),
    m("a", "Ana", "entrada", "08:00"),
    m("a", "Ana", "salida", "16:00"),
    m("a", "Ana", "salida", "17:00"),
    m("a", "Ana", "entrada", "08:00", "2026-10-08"),
    m("a", "Ana", "salida", "14:00", "2026-10-08"),
  ]);
  assert.deepEqual(filas.map((f) => f.fecha), ["2026-10-09", "2026-10-08"]);
  assert.equal(filas[0].minutos, 9 * 60);
  const t = totalesPorPersona(filas).get("a")!;
  assert.equal(t.minutos, 15 * 60);
  assert.equal(t.dias, 2);
  assert.ok(csvReporteChecador(filas).includes('"Ana","2026-10-09","08:00"'));
  assert.ok(htmlReporteChecador(filas, "semana").includes("landscape"));
});

test("hoy sin salida está en turno, no cuenta como sin cerrar", () => {
  const ahora = new Date("2026-10-09T13:00:00-06:00");
  const filas = armarReporteChecador([m("a", "Ana", "entrada", "08:00"), m("a", "Ana", "entrada", "08:00", "2026-10-08")], ahora);
  const hoy = filas.find((f) => f.fecha === "2026-10-09")!;
  const ayer = filas.find((f) => f.fecha === "2026-10-08")!;
  assert.equal(hoy.enTurno, true);
  assert.equal(ayer.enTurno, false);
  assert.equal(totalesPorPersona(filas).get("a")!.incompletos, 1);
});
