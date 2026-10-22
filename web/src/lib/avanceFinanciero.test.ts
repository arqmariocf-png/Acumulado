import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularAvance, FILTRO_INICIAL, mesEnFiltro, mesesEntre, repartoMensual, revisarPresupuesto, semaforoObra, type ObraAvance, type PresupuestoObra, type RealMes } from "./avanceFinanciero.ts";

test("meses entre dos fechas y reparto parejo o en curva S", () => {
  assert.deepEqual(mesesEntre("2026-11-01", "2027-02-01"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  const parejo = [...repartoMensual(1000, "2026-01", "2026-03", "parejo").values()];
  assert.deepEqual(parejo, [333.33, 333.33, 333.34]);
  const s = [...repartoMensual(1000, "2026-01", "2026-04", "curva_s").values()];
  assert.equal(Math.round(s.reduce((a, b) => a + b, 0) * 100) / 100, 1000);
  assert.ok(s[0] < s[1] && s[3] < s[2], "poco al principio y al final");
  assert.equal(repartoMensual(0, "2026-01", "2026-03", "parejo").size, 0);
});

test("filtro de año y periodo", () => {
  assert.equal(mesEnFiltro("2025-05", { anio: null, periodo: "todo" }), true);
  assert.equal(mesEnFiltro("2025-05", { anio: 2026, periodo: "todo" }), false);
  assert.equal(mesEnFiltro("2026-05", { anio: 2026, periodo: "T2" }), true);
  assert.equal(mesEnFiltro("2026-07", { anio: 2026, periodo: "T2" }), false);
  assert.equal(mesEnFiltro("2026-07", { anio: 2026, periodo: "07" }), true);
});

test("semáforo de la obra", () => {
  assert.equal(semaforoObra(0, 500, 50), "sin_presupuesto");
  assert.equal(semaforoObra(1000, 1200, 90), "rebasado");
  assert.equal(semaforoObra(1000, 700, 50), "desfase"); // 70 % ejercido vs 50 % físico
  assert.equal(semaforoObra(1000, 550, 50), "en_linea");
  assert.equal(semaforoObra(1000, 900, null), "en_linea");
});

test("avance por obra, empresa, categoría y mes con filtros", () => {
  const obras: ObraAvance[] = [
    { id: "a", nombre: "Escuela", empresa_id: "csc", empresa_codigo: "CSC", tareas: 10, hechas: 5 },
    { id: "b", nombre: "Nave", empresa_id: "erg", empresa_codigo: "ERG", tareas: 0, hechas: 0 },
    { id: "c", nombre: "Sin nada", empresa_id: "erg", empresa_codigo: "ERG", tareas: 3, hechas: 1 },
  ];
  const pres: PresupuestoObra[] = [
    { proyecto_id: "a", categoria: "materiales", monto: 1000, mes_inicio: "2026-01-01", mes_fin: "2026-02-01", reparto: "parejo" },
    { proyecto_id: "a", categoria: "mano_obra", monto: 600, mes_inicio: "2026-01-01", mes_fin: "2026-03-01", reparto: "parejo" },
  ];
  const real: RealMes[] = [
    { proyecto_id: "a", mes: "2026-01", categoria: "materiales", real: 700, pagado: 400 },
    { proyecto_id: "a", mes: "2026-02", categoria: "mano_obra", real: 300, pagado: 300 },
    { proyecto_id: "b", mes: "2025-12", categoria: "subcontratos", real: 250, pagado: 0 },
  ];
  const r = calcularAvance(obras, real, pres, FILTRO_INICIAL);
  assert.equal(r.total.presupuesto, 1600);
  assert.equal(r.total.real, 1250);
  assert.equal(r.total.pagado, 700);
  assert.equal(r.total.pendiente, 550);
  assert.equal(r.porObra.length, 2); // "Sin nada" no sale
  const a = r.porObra.find((x) => x.obra.id === "a")!;
  assert.equal(a.ejercidoPct, 62.5);
  assert.equal(a.fisicoPct, 50);
  assert.equal(a.semaforo, "desfase"); // 62.5 % vs 50 %
  assert.equal(r.porObra.find((x) => x.obra.id === "b")!.semaforo, "sin_presupuesto");
  assert.equal(r.obrasConAlerta, 1);
  assert.deepEqual(r.porEmpresa.map((e) => e.codigo), ["CSC", "ERG"]);
  assert.equal(r.porCategoria.find((c) => c.categoria === "materiales")!.real, 700);
  assert.deepEqual(r.porMes.map((m) => m.mes), ["2025-12", "2026-01", "2026-02", "2026-03"]);
  assert.equal(r.porMes[1].presupuesto, 700); // 500 materiales + 200 mano de obra
  assert.equal(r.porMes[3].diferenciaAcum, 350); // 1600 − 1250
  assert.deepEqual(r.anios, [2026, 2025]);

  // Enero de 2026, solo materiales: el semáforo sigue siendo de toda la obra.
  const ene = calcularAvance(obras, real, pres, { ...FILTRO_INICIAL, anio: 2026, periodo: "01", categoria: "materiales" });
  assert.equal(ene.total.presupuesto, 500);
  assert.equal(ene.total.real, 700);
  assert.equal(ene.porObra[0].disponible, -200); // en enero se gastó más de lo presupuestado
  assert.equal(ene.porObra[0].semaforo, "desfase"); // de toda la obra: 700 de 1000 (70 %) vs 50 % físico
});

test("revisión de la captura", () => {
  assert.equal(revisarPresupuesto({ materiales: 100 }, "2026-01", "2026-03"), null);
  assert.match(revisarPresupuesto({}, "2026-05", "2026-03")!, /antes/);
  assert.match(revisarPresupuesto({ fletes: -1 }, "2026-01", "2026-03")!, /Fletes/);
});
