import { test } from "node:test";
import assert from "node:assert/strict";
import { AREAS_REPORTE, LISTA_AREAS, alertasArea, filasSeccion, formatear, renglonesEvolucionArea, resumenArea, semN, semPct, semaforoArea, semaforoDe, valorIndicador, type ReporteArea } from "./reporteAreas.ts";

function finanzas(extra: Record<string, number | null> = {}): ReporteArea {
  return {
    area: "finanzas",
    desde: "2026-10-07",
    hasta: "2026-11-05",
    dias: 30,
    indicadores: {
      saldo_bancos: 1234567, cuentas_activas: 19, cuentas_sin_estado_7d: 0,
      pagos_vencidos: 0, pagos_vencidos_monto: 0, pagos_7d: 4, pagos_7d_monto: 50000,
      pagados_periodo: 74, pagados_periodo_monto: 900000, pagos_sin_comprobante: 0, pct_sin_comprobante: 0,
      oc_por_autorizar: 0, oc_por_autorizar_monto: 0, oc_con_saldo: 40, oc_con_saldo_monto: 300000, oc_vencidas: 0, oc_vencidas_monto: 0,
      cxp_deuda: 150000, cxp_lineas: 500000, cxp_proveedores: 4, cxp_rojos: 0,
      deuda_financiera: 0, deuda_creditos: 0, prestamos_30d: 0,
      movimientos_periodo: 200, conciliados_pct: 90, en_revision: 10, gastos_por_revisar: 0,
      ...extra,
    },
    secciones: { saldos_por_empresa: [{ empresa: "AEP", cuentas: 3, saldo: 1000, al: "2026-11-04" }], pagos_vencidos: [] },
  };
}

test("las 8 áreas tienen configuración completa y coherente", () => {
  assert.equal(LISTA_AREAS.length, 8);
  for (const area of LISTA_AREAS) {
    const c = AREAS_REPORTE[area];
    assert.equal(c.clave, area);
    assert.ok(c.titulo && c.cubre && c.ruta.startsWith("/"), area);
    assert.ok(c.indicadores.length >= 5, `${area}: indicadores`);
    const destacados = c.indicadores.filter((i) => i.destacado);
    assert.ok(destacados.length >= 4 && destacados.length <= 8, `${area}: ${destacados.length} destacados`);
    assert.ok(c.secciones.length >= 3, `${area}: secciones`);
    assert.ok(c.porRevisar.length >= 2, `${area}: porRevisar`);
    for (const i of c.indicadores) assert.ok(!i.liga || i.liga.startsWith("/"), `${area}.${i.clave}: liga`);
    for (const s of c.secciones) {
      assert.ok(s.columnas.length >= 2, `${area}.${s.clave}: columnas`);
      if (s.barras) {
        assert.ok(s.columnas.some((col) => col.clave === s.barras!.etiqueta), `${area}.${s.clave}: barras.etiqueta`);
        assert.ok(s.columnas.some((col) => col.clave === s.barras!.valor), `${area}.${s.clave}: barras.valor`);
      }
    }
    const claves = c.indicadores.map((i) => i.clave);
    assert.equal(new Set(claves).size, claves.length, `${area}: claves repetidas`);
  }
});

test("formatear y semáforos", () => {
  assert.equal(formatear(1234.6, "n"), "1,235");
  assert.equal(formatear(1234.6, "money"), "$ 1,235");
  assert.equal(formatear(85.4, "pct"), "85 %");
  assert.equal(formatear(12, "dias"), "12 d");
  assert.equal(formatear("2026-11-05", "fecha"), "05/11");
  assert.equal(formatear(null, "money"), "—");
  assert.equal(formatear(true), "sí");
  assert.equal(semN(5)(0), "verde");
  assert.equal(semN(5)(5), "ambar");
  assert.equal(semN(5)(6), "rojo");
  assert.equal(semN(5)(null), "gris");
  assert.equal(semPct(85, 60)(90), "verde");
  assert.equal(semPct(85, 60)(70), "ambar");
  assert.equal(semPct(85, 60)(10), "rojo");
});

test("finanzas sin pendientes: sin alertas, semáforo verde y resumen con cifras", () => {
  const d = finanzas();
  assert.deepEqual(alertasArea(d), []);
  assert.equal(semaforoArea(d), "verde");
  const r = resumenArea(d);
  assert.ok(r.length >= 3);
  assert.ok(r[0].includes("$ 1,234,567"));
  const saldo = AREAS_REPORTE.finanzas.indicadores[0];
  assert.equal(valorIndicador(saldo, d.indicadores), "$ 1,234,567");
  assert.equal(semaforoDe(saldo, d.indicadores), "verde");
  assert.equal(filasSeccion(d, "saldos_por_empresa").length, 1);
  assert.deepEqual(filasSeccion(d, "no_existe"), []);
});

test("finanzas con pagos vencidos y proveedores en rojo: alertas rojas primero", () => {
  const d = finanzas({ pagos_vencidos: 3, pagos_vencidos_monto: 45000, cxp_rojos: 1, oc_por_autorizar: 2, oc_por_autorizar_monto: 8000, conciliados_pct: 40 });
  const a = alertasArea(d);
  assert.ok(a.length >= 4);
  assert.equal(a[0].nivel, "rojo");
  assert.ok(a[0].texto.includes("3 pago(s)"));
  assert.ok(a.every((x, i) => i === 0 || a[i - 1].nivel === "rojo" || x.nivel === "ambar"));
  assert.equal(semaforoArea(d), "rojo");
  assert.ok(a.every((x) => x.ruta.startsWith("/")));
});

test("renglones de evolución salen de los indicadores del área con su formato", () => {
  const r = renglonesEvolucionArea("mantenimiento");
  assert.equal(r.length, AREAS_REPORTE.mantenimiento.indicadores.length);
  const abiertos = r.find((x) => x.clave === "folios_abiertos");
  assert.ok(abiertos);
  assert.equal(abiertos.masEsMejor, false);
  assert.equal(abiertos.formato, "n");
});

test("cada área da alertas y resumen con indicadores vacíos (sin tronar)", () => {
  for (const area of LISTA_AREAS) {
    const d: ReporteArea = { area, desde: "2026-10-07", hasta: "2026-11-05", dias: 30, indicadores: {}, secciones: {} };
    assert.ok(Array.isArray(alertasArea(d)), area);
    assert.ok(resumenArea(d).length >= 1, area);
    assert.ok(["verde", "ambar", "rojo"].includes(semaforoArea(d)), area);
  }
});
