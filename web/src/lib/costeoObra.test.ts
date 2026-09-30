import { test } from "node:test";
import assert from "node:assert/strict";
import { diasObra, leerPresupuestoPegado, porcentajeTabulador, resumenCosteo, type CosteoContrato } from "./costeoObra.ts";

const tab = [
  { km_hasta: 50, porcentaje: 12 },
  { km_hasta: 150, porcentaje: 15 },
  { km_hasta: 300, porcentaje: 18 },
];

test("tabulador por km", () => {
  assert.equal(porcentajeTabulador(40, tab), 12);
  assert.equal(porcentajeTabulador(50, tab), 12);
  assert.equal(porcentajeTabulador(51, tab), 15);
  assert.equal(porcentajeTabulador(900, tab), 18);
  assert.equal(porcentajeTabulador(null, tab), null);
  assert.equal(porcentajeTabulador(10, []), null);
});

test("días de obra incluyen ambos extremos", () => {
  assert.equal(diasObra("2026-10-01", "2026-10-31"), 31);
  assert.equal(diasObra(null, "2026-10-31"), null);
});

const contrato: CosteoContrato = {
  folio_contrato: "OC-123",
  fecha_inicio: "2026-10-01",
  fecha_fin: "2026-11-15",
  subtotal: 1_000_000,
  iva: 160_000,
  m2: 400,
  ubicacion: "Río Frío",
  latitud: null,
  longitud: null,
  km: 80,
  plano_id: null,
  indirectos_pct: null,
  notas: null,
};

test("utilidad pronóstico: indirectos sobre directos + IMSS", () => {
  const r = resumenCosteo(
    contrato,
    [{ orden: 1, clave: null, concepto: "Obra", unidad: "lote", cantidad: 1, precio_unitario: 1_000_000 }],
    [
      { tipo: "contratista", nombre: "Albañilería", especialidad: null, cantidad: 1, unidad: null, costo_unitario: 500_000, notas: null },
      { tipo: "personal", nombre: "Residente", especialidad: null, cantidad: 7, unidad: "semana", costo_unitario: 10_000, notas: null },
    ],
    30_000,
    tab,
    { n_oc: 3, subtotal: 100_000, total: 116_000, pagado: 50_000 },
  );
  assert.equal(r.total, 1_160_000);
  assert.equal(r.dias, 46);
  assert.equal(r.directos, 570_000);
  assert.equal(r.pctIndirectos, 15);
  assert.equal(r.origenIndirectos, "tabulador");
  assert.equal(r.indirectos, 90_000); // 15 % de 600,000
  assert.equal(r.costoTotal, 690_000);
  assert.equal(r.utilidad, 310_000);
  assert.equal(r.margenPct, 31);
  assert.equal(r.ventaM2, 2500);
  assert.equal(r.costoM2, 1725);
  assert.deepEqual(r.alertas, []);
});

test("% propio gana al tabulador y avisa lo que falta", () => {
  const r = resumenCosteo({ ...contrato, indirectos_pct: 10, m2: null }, [], [
    { tipo: "personal", nombre: "Cabo", especialidad: null, cantidad: 1, unidad: null, costo_unitario: 1000, notas: null },
  ], null, tab, null);
  assert.equal(r.origenIndirectos, "propio");
  assert.equal(r.pctIndirectos, 10);
  assert.ok(r.alertas.some((a) => a.includes("presupuesto original")));
  assert.ok(r.alertas.some((a) => a.includes("seguro social")));
  assert.ok(r.alertas.some((a) => a.includes("m²")));
});

test("pegar presupuesto desde Excel", () => {
  const texto = [
    "Clave\tConcepto\tUnidad\tCantidad\tP.U.\tImporte",
    "A-01\tDemolición de muros\tm2\t120\t$85.50\t10,260.00",
    "",
    "Firme de concreto\tm2\t1,200\t350",
    "Subtotal\t\t\t\t",
  ].join("\n");
  const r = leerPresupuestoPegado(texto);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { orden: 1, clave: "A-01", concepto: "Demolición de muros", unidad: "m2", cantidad: 120, precio_unitario: 85.5 });
  assert.equal(r[1].clave, null);
  assert.equal(r[1].cantidad, 1200);
});
