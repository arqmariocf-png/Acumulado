import { test } from "node:test";
import assert from "node:assert/strict";
import { csvViajes, enPeriodo, filtrarViajes, htmlBitacoraViajes, htmlManifiestoResiduos, importeViaje, kmViaje, periodoMes, porMes, resumenPorUnidad, revisarGasto, revisarViaje, totalesResumen, type Gasto, type Viaje } from "./volteo.ts";

const base: Viaje = {
  id: "v1", empresa_id: "aep", unidad_id: "u1", folio: "VJ-AEP-0001", fecha: "2026-11-20", hora_salida: "08:00", hora_regreso: null, chofer_id: null, chofer_nombre: "Israel",
  tipo: "flete", cliente: "Constructora Loma", cliente_empresa_id: null, proyecto_id: null, origen: "Banco de arena", destino: "Obra Olinia", material: "Arena",
  cantidad: 14, unidad_medida: "m3", viajes: 2, precio: 250, importe: 3500, cobrado: true, cobrado_en: "2026-11-20", forma_cobro: null, referencia_cobro: null, orden_venta_id: null,
  km_inicial: 1000, km_final: 1060, manifiesto_folio: null, manifiesto_registro: null, residuo_tipo: null, ticket: "T-1", estado: "terminado", notas: null, created_by_nombre: "Mario",
};
const gasto: Gasto = { id: "g1", empresa_id: "aep", unidad_id: "u1", viaje_id: null, folio: "GU-AEP-0001", fecha: "2026-11-20", tipo: "diesel", descripcion: "Carga", litros: 20, monto: 520, proveedor: "Pemex", referencia: null, km: 1000, created_by_nombre: "Israel" };

test("importe del viaje: cantidad × precio, por viaje, o lo capturado", () => {
  assert.equal(importeViaje({ cantidad: 14, unidad_medida: "m3", viajes: 2, precio: 250 }), 3500);
  assert.equal(importeViaje({ cantidad: 0, unidad_medida: "viaje", viajes: 3, precio: 1200 }), 3600);
  assert.equal(importeViaje({ cantidad: null, unidad_medida: "m3", viajes: 2, precio: 800 }), 1600, "sin cantidad cobra por viaje");
  assert.equal(importeViaje({ cantidad: 14, unidad_medida: "m3", viajes: 1, precio: 250, importe: 3000 }), 3000, "lo capturado manda");
  assert.equal(importeViaje({ cantidad: 14, unidad_medida: "m3", viajes: 1, precio: "" }), 0);
});

test("kilometraje y validación", () => {
  assert.equal(kmViaje({ km_inicial: 1000, km_final: 1060 }), 60);
  assert.equal(kmViaje({ km_inicial: 1000, km_final: 900 }), null);
  assert.equal(kmViaje({ km_inicial: "", km_final: "10" }), null);
  const ok = { unidad_id: "u1", fecha: "2026-11-20", tipo: "flete", cantidad: "14", unidad_medida: "m3", viajes: "2", precio: "250", importe: "", km_inicial: "1000", km_final: "1060" };
  assert.equal(revisarViaje(ok), null);
  assert.equal(revisarViaje({ ...ok, unidad_id: "" }), "Elige la unidad.");
  assert.equal(revisarViaje({ ...ok, viajes: "1.5" }), "Los viajes deben ser un entero mayor a cero.");
  assert.equal(revisarViaje({ ...ok, km_final: "900" }), "El kilometraje final debe ser mayor o igual al inicial.");
  assert.equal(revisarViaje({ ...ok, tipo: "residuos", manifiesto_folio: "" }), "Para residuos de manejo especial anota el folio del manifiesto.");
  assert.equal(revisarViaje({ ...ok, tipo: "residuos", manifiesto_folio: "TRCMD-217" }), null);
  assert.equal(revisarGasto({ unidad_id: "u1", fecha: "2026-11-20", tipo: "diesel", monto: "520", litros: "20" }), null);
  assert.equal(revisarGasto({ unidad_id: "u1", fecha: "2026-11-20", tipo: "diesel", monto: "0", litros: "" }), "Escribe el monto.");
});

test("resumen por unidad: ingresos, gastos, utilidad, km/l", () => {
  const v2: Viaje = { ...base, id: "v2", folio: "VJ-AEP-0002", importe: 1500, cobrado: false, km_inicial: 1060, km_final: 1100, viajes: 1, cantidad: 6 };
  const cancelado: Viaje = { ...base, id: "v3", importe: 9999, estado: "cancelado" };
  const otra: Viaje = { ...base, id: "v4", unidad_id: "u2", importe: 100, cobrado: false, km_inicial: null, km_final: null };
  const [u1, u2] = resumenPorUnidad([base, v2, cancelado, otra], [gasto, { ...gasto, id: "g2", tipo: "casetas", monto: 80, litros: null }]);
  assert.equal(u1.unidad_id, "u1");
  assert.equal(u1.viajes, 3);
  assert.equal(u1.cargas, 2);
  assert.equal(u1.cantidad_m3, 20);
  assert.equal(u1.ingresos, 5000);
  assert.equal(u1.cobrado, 3500);
  assert.equal(u1.por_cobrar, 1500);
  assert.equal(u1.gastos, 600);
  assert.equal(u1.combustible, 520);
  assert.equal(u1.litros, 20);
  assert.equal(u1.km, 100);
  assert.equal(u1.km_por_litro, 5);
  assert.equal(u1.costo_por_km, 6);
  assert.equal(u1.utilidad, 4400);
  assert.equal(u1.margen_pct, 88);
  assert.deepEqual(u1.gastos_por_tipo, { diesel: 520, casetas: 80 });
  assert.equal(u2.ingresos, 100);
  assert.equal(u2.km_por_litro, null);
  const t = totalesResumen([u1, u2]);
  assert.equal(t.ingresos, 5100);
  assert.equal(t.utilidad, 4500);
  assert.equal(t.margen_pct, 88.2);
});

test("periodo y por mes", () => {
  assert.deepEqual(periodoMes("2026-11"), { desde: "2026-11-01", hasta: "2026-11-30" });
  assert.deepEqual(periodoMes("2026-02"), { desde: "2026-02-01", hasta: "2026-02-28" });
  assert.equal(enPeriodo("2026-11-30", periodoMes("2026-11")), true);
  assert.equal(enPeriodo("2026-12-01", periodoMes("2026-11")), false);
  const meses = porMes([base, { ...base, fecha: "2026-10-05", importe: 1000 }, { ...base, fecha: "2026-10-06", importe: 1, estado: "cancelado" }], [gasto]);
  assert.deepEqual(meses, [
    { mes: "2026-10", ingresos: 1000, gastos: 0, utilidad: 1000 },
    { mes: "2026-11", ingresos: 3500, gastos: 520, utilidad: 2980 },
  ]);
});

test("filtro, CSV y documentos", () => {
  assert.equal(filtrarViajes([base], "olinia").length, 1);
  assert.equal(filtrarViajes([base], "t-1").length, 1);
  assert.equal(filtrarViajes([base], "grava").length, 0);
  const csv = csvViajes([base], () => "Freightliner");
  assert.ok(csv.startsWith("Folio,Fecha,Unidad"));
  assert.ok(csv.includes("VJ-AEP-0001,2026-11-20,Freightliner,Israel,Flete (acarreo),Constructora Loma,Banco de arena,Obra Olinia,Arena,14,m3,2,250,3500,sí,1000,1060,60,,T-1,terminado,"));
  const residuo: Viaje = { ...base, tipo: "residuos", residuo_tipo: "Chatarra", manifiesto_folio: "M-7" };
  const m = htmlManifiestoResiduos({ razon_social: "Aceros y Envasados de Puebla", registro: "TRCMD-217-2304/2025" }, { nombre: "Israel", placas: "ABC1234", unidad: "Freightliner" }, [residuo]);
  assert.ok(m.includes("TRCMD-217-2304/2025") && m.includes("Chatarra") && m.includes("Manifiesto(s) M-7") && m.includes("ABC1234"));
  const b = htmlBitacoraViajes("AEP", { nombre: "Freightliner", placas: "ABC1234" }, periodoMes("2026-11"), [base], [gasto]);
  assert.ok(b.includes("Bitácora de viajes") && b.includes("$3,500.00") && b.includes("$520.00") && b.includes("$2,980.00"));
});
