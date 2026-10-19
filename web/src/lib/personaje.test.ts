import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avanceDelDia,
  claseDe,
  dialogoNpc,
  logros,
  misionesDelDia,
  nivelDe,
  oficios,
  pixelar,
  retocarRetrato,
  rangoDe,
  recorteCentral,
  xpParaNivel,
  type HojaPersonaje,
  type StatsPersonaje,
} from "./personaje.ts";

const stats: StatsPersonaje = {
  xp: 124,
  tareas_terminadas: 9,
  dias_checados: 11,
  tarjetas_creadas: 0,
  comentarios: 1,
  cumplimiento_30: 75,
  constancia_30: 80,
  iniciativa_30: 0,
  colaboracion_30: 5,
  racha: 6,
  checa: true,
  hechas_hoy: 1,
  pendientes_hoy: 2,
  vencidas: 1,
};

test("nivel por experiencia: sube rápido al principio", () => {
  assert.equal(xpParaNivel(2), 50);
  assert.equal(xpParaNivel(5), 500);
  assert.deepEqual(nivelDe(0), { nivel: 1, desde: 0, hasta: 50, progreso: 0 });
  assert.deepEqual(nivelDe(124), { nivel: 2, desde: 50, hasta: 150, progreso: 74 });
  assert.equal(nivelDe(150).nivel, 3);
  assert.equal(rangoDe(1), "Aprendiz");
  assert.equal(rangoDe(6), "Veterano");
});

test("clase según el puesto y oficios por módulo", () => {
  assert.equal(claseDe("supervisor").nombre, "Capitán de obra");
  assert.equal(claseDe("corporativo", ["legal", "contabilidad"]).nombre, "Escriba del reino");
  assert.equal(claseDe("rol_nuevo").nombre, "Aventurero");
  assert.deepEqual(oficios(["precios", "tareas", "tareas", "desconocido"]), ["Precios unitarios", "Tareas"]);
});

const hoja: HojaPersonaje = {
  hoy: "2026-10-19",
  stats,
  misiones: [
    { id: "a", titulo: "Subir Adquira", tablero_id: "tb", tablero: "Contabilidad", fecha_limite: "2026-10-16", columna: "Por hacer", papel: "responsable", vencida: true },
    { id: "b", titulo: "Revisar planos", tablero_id: "tb", tablero: "Obra", fecha_limite: "2026-10-19", columna: "En progreso", papel: "corresponsable", vencida: false },
  ],
  hechas_hoy: [{ id: "c", titulo: "Cotizar malla", tablero_id: "tb" }],
  proximas_7: 3,
  sin_fecha: 1,
  marcas_hoy: ["entrada"],
};

test("misiones del día: atrasadas primero, checador, hoy y lo terminado al final", () => {
  const m = misionesDelDia(hoja);
  assert.deepEqual(m.map((x) => x.clave), ["t-a", "c-entrada", "c-comida_inicio", "c-comida_fin", "c-salida", "t-b", "h-c"]);
  assert.equal(m[0].urgente, true);
  assert.equal(m[1].hecha, true);
  assert.match(m[5].detalle, /corresponsable/);
  assert.equal(m[0].liga, "/tareas/tb?tarjeta=a");
  assert.deepEqual(avanceDelDia(m), { hechas: 2, total: 7, pct: 29, xpGanable: 20 });
  const sinChecador = misionesDelDia({ ...hoja, stats: { ...stats, checa: false } });
  assert.equal(sinChecador.length, 3);
});

test("el NPC habla según cómo va el día", () => {
  const m = misionesDelDia(hoja);
  assert.match(dialogoNpc("Belén Vergara", m, 9, stats), /^Belén, tienes 1 misión atrasada\. Empieza por «Subir Adquira»/);
  const sinAtraso = m.filter((x) => !x.urgente);
  assert.match(dialogoNpc("Belén", sinAtraso, 16, stats), /^¡Vas bien, Belén! 2 de 6\. Sigue con «Salida a comer»/);
  assert.match(dialogoNpc("Belén", sinAtraso.map((x) => ({ ...x, hecha: true })), 18, stats), /Misión cumplida.*6 días seguidos/);
  assert.match(dialogoNpc("Belén", [], 8, stats), /^¡Buen día, Belén! Hoy no tienes misiones/);
});

test("logros", () => {
  const l = logros(stats, false);
  assert.equal(l.find((x) => x.clave === "avatar")?.logrado, false);
  assert.equal(l.find((x) => x.clave === "primera")?.logrado, true);
  assert.equal(l.find((x) => x.clave === "racha5")?.logrado, true);
  assert.equal(l.find((x) => x.clave === "aldia")?.logrado, false);
});

test("pixel-art: óvalo transparente, paleta y contorno", () => {
  const lado = 10;
  const datos = new Uint8ClampedArray(lado * lado * 4);
  for (let i = 0; i < datos.length; i += 4) {
    datos[i] = 230;
    datos[i + 1] = 185;
    datos[i + 2] = 150;
    datos[i + 3] = 255;
  }
  const s = pixelar(datos, lado);
  const px = (x: number, y: number) => Array.from(s.slice((y * lado + x) * 4, (y * lado + x) * 4 + 4));
  assert.equal(px(0, 0)[3], 0); // esquina fuera del óvalo
  assert.deepEqual(px(5, 5), [243, 212, 176, 255]); // piel clara de la paleta (con contraste)
  assert.deepEqual(px(5, 0), [20, 18, 24, 255]); // contorno arriba
  assert.deepEqual(recorteCentral(640, 480), { x: 80, y: 0, lado: 480 });
  assert.deepEqual(recorteCentral(480, 640, 1.25), { x: 48, y: 105, lado: 384 });
});

test("retrato realista: estira niveles, aviva color y oscurece esquinas", () => {
  const lado = 20;
  const datos = new Uint8ClampedArray(lado * lado * 4);
  // Foto lavada: mitad 100, mitad 150 (poco contraste), con un tono cálido.
  for (let p = 0; p < lado * lado; p++) {
    const v = p < (lado * lado) / 2 ? 100 : 150;
    datos.set([v + 10, v, v - 10, 255], p * 4);
  }
  const s = retocarRetrato(datos, lado, { vineta: 0 });
  const px = (x: number, y: number) => Array.from(s.slice((y * lado + x) * 4, (y * lado + x) * 4 + 4));
  const [r1, g1, b1, a1] = px(10, 2); // zona oscura
  const [, g2] = px(10, 17); // zona clara
  assert.equal(a1, 255);
  assert.ok(g2 - g1 > 50 * 1.5, "el contraste sube");
  assert.ok(r1 - b1 > 20, "el color se aviva");
  const v = retocarRetrato(datos, lado);
  const vx = (x: number, y: number) => v[(y * lado + x) * 4 + 1];
  assert.equal(v[(10 * lado + 10) * 4 + 1], s[(10 * lado + 10) * 4 + 1]); // el centro no cambia
  assert.ok(g2 - vx(10, 17) <= 3, "cerca del centro casi nada");
  assert.ok(vx(0, 19) < g2, "la esquina se oscurece");
});
