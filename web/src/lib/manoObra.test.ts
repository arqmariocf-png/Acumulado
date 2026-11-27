import { test } from "node:test";
import assert from "node:assert/strict";
import { avanceConLista, avancePresupuesto, csvLista, domingoDe, filtrarPorTexto, htmlListaRaya, numeroSemana, revisarLista, revisarRenglon, sumarDias, textoSemana, totalesLista, type RenglonLista } from "./manoObra.ts";

const R = (x: Partial<RenglonLista>): RenglonLista => ({ trabajador_id: null, trabajador_nombre: "Juan Pérez", tipo_trabajador: "empleado", partida: "Albañilería", subpartida: "Oficial", dias: 6, monto: 2400, forma_pago: "transferencia", ...x });

test("semana de domingo a sábado con número ISO del sábado (como el backoffice)", () => {
  assert.equal(domingoDe("2026-09-10"), "2026-09-06");
  assert.equal(domingoDe("2026-09-06"), "2026-09-06");
  assert.equal(domingoDe("2026-09-12"), "2026-09-06");
  assert.equal(numeroSemana("2026-09-06"), 37);
  assert.equal(numeroSemana("2026-11-22"), 48);
  assert.equal(numeroSemana("2026-12-27"), 53);
  assert.equal(sumarDias("2026-11-22", 6), "2026-11-28");
  assert.equal(textoSemana("2026-11-22"), "Semana 48 · 22 nov al 28 nov 2026");
});

test("totales por forma de pago, gente y partida", () => {
  const t = totalesLista([
    R({}),
    R({ trabajador_nombre: "juan pérez ", partida: "Albañilería", subpartida: "Extra", monto: "600.5", forma_pago: "efectivo" }),
    R({ trabajador_id: "t2", trabajador_nombre: "Ana", partida: "Pintura", monto: 3000 }),
  ]);
  assert.equal(t.total, 6000.5);
  assert.equal(t.transferencia, 5400);
  assert.equal(t.efectivo, 600.5);
  assert.equal(t.trabajadores, 2);
  assert.deepEqual(t.porPartida, [{ partida: "Pintura", total: 3000 }, { partida: "Albañilería", total: 3000.5 }].sort((a, b) => b.total - a.total));
});

test("revisar renglón y lista", () => {
  assert.deepEqual(revisarRenglon({ trabajador_nombre: "x", partida: "p", monto: 1, dias: 6 }), []);
  assert.equal(revisarRenglon({ trabajador_nombre: " ", partida: "", monto: 0, dias: 9 }).length, 4);
  assert.equal(revisarLista([]).puede, false);
  const r = revisarLista([R({}), R({ trabajador_nombre: "JUAN PÉREZ" })]);
  assert.equal(r.puede, true);
  assert.equal(r.avisos.length, 1);
});

test("presupuesto contra lo pagado y la lista", () => {
  assert.deepEqual(avancePresupuesto({ partida: "A", subpartida: null, presupuesto: null, ejercido: 500 }), { total: 500, restante: null, pct: null, estado: "sin_presupuesto" });
  assert.equal(avancePresupuesto({ partida: "A", subpartida: null, presupuesto: 10000, ejercido: 5000 }).estado, "en_linea");
  assert.equal(avancePresupuesto({ partida: "A", subpartida: null, presupuesto: 10000, ejercido: 8000, conLista: 1500 }).estado, "por_agotarse");
  const x = avancePresupuesto({ partida: "A", subpartida: null, presupuesto: 10000, ejercido: 9000, conLista: 1500 });
  assert.equal(x.estado, "excedido");
  assert.equal(x.restante, -500);
  assert.equal(x.pct, 105);
  const a = avanceConLista([{ partida: "Albañileria", subpartida: "oficial", presupuesto: 10000, ejercido: 100 }], [R({}), R({ partida: "Pintura", subpartida: null, monto: 50 })]);
  assert.equal(a[0].conLista, 2400);
  assert.equal(a[1].partida, "Pintura");
  assert.equal(a[1].presupuesto, null);
});

test("buscar, imprimir y Excel", () => {
  assert.equal(filtrarPorTexto([{ n: "José López" }, { n: "Ana" }], "jose lop", (f) => [f.n]).length, 1);
  const l = { folio: "LR-ERG-0001", obra: "Nave 40", empresa: "Ergodinova", semana_inicio: "2026-11-22", estado: "enviada" as const, capturo: "RH", autorizo: null, fecha_pago: "2026-11-28", notas: null };
  const html = htmlListaRaya(l, [R({}), R({ trabajador_nombre: "<b>", forma_pago: "efectivo", monto: 100 })]);
  assert.match(html, /Lista de raya LR-ERG-0001/);
  assert.match(html, /Semana 48/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /\$2,500\.00/);
  const csv = csvLista(l, [R({ partida: "Obra, acabados" })]);
  assert.match(csv.split("\n")[1], /"Obra, acabados"/);
  assert.match(csv, /2026-11-28/);
});
