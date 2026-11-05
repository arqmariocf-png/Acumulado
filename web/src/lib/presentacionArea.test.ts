import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlPresentacionArea, laminasArea } from "./presentacionArea.ts";
import { AREAS_REPORTE, LISTA_AREAS, type ReporteArea } from "./reporteAreas.ts";
import type { HistoricoGenerico } from "./historicoRh.ts";

function mantenimiento(): ReporteArea {
  return {
    area: "mantenimiento",
    desde: "2026-10-07",
    hasta: "2026-11-05",
    dias: 30,
    indicadores: {
      folios_total: 324, folios_abiertos: 120, esperando_autorizacion: 8, viejos_30: 60, recibidos_periodo: 30, finalizados_periodo: 25, cancelados: 17, saldo_calculado: 528380.62, sin_cobro: 30, sin_cobro_monto: 200000,
      monto_a_cobrar: 1328380.62, monto_cobrado: 800000, saldo_por_cobrar: 528380.62, finalizados_sin_pedido: 5, finalizados_sin_factura: 9,
      gasto_oc_periodo: 150000, oc_periodo: 12, mano_obra_periodo: 90000, personas_equipo: 6,
    },
    secciones: {
      por_etapa: [{ etapa: "Ejecución", n: 50, monto: 500000 }, { etapa: "Cotizado <&>", n: 30, monto: 300000 }],
      por_supervisor: [{ supervisor: "Carlos", abiertos: 40, finalizados_periodo: 10, monto: 400000 }],
      gasto_por_cliente: [{ cliente: "BBVA (cliente de la obra)", n: 10, monto: 140000 }, { cliente: "Oficinas Grupo Loma", n: 2, monto: 10000 }],
      folios_viejos: [{ folio: "F-1", sucursal: "Centro", recepcion: "2026-06-01", dias: 157, etapa: "Ejecución", supervisor: "Carlos", monto: 12000 }],
    },
  };
}

const cuenta = (html: string) => (html.match(/<section class="slide/g) ?? []).length;

test("presentación de mantenimiento: portada, resumen, qué atender, una lámina por sección y por revisar", () => {
  const d = mantenimiento();
  const html = htmlPresentacionArea(d, { organizacion: "Grupo Loma", hoy: "2026-11-05" });
  const cfg = AREAS_REPORTE.mantenimiento;
  assert.equal(cuenta(html), 4 + cfg.secciones.length);
  assert.equal(laminasArea(d), 4 + cfg.secciones.length);
  assert.ok(html.includes("Reporte de mantenimiento"));
  assert.ok(html.includes("Grupo Loma · Acumulado"));
  assert.ok(html.includes("07/10 – 05/11/2026"));
  assert.ok(html.includes("Resumen ejecutivo"));
  assert.ok(html.includes("Qué atender"));
  assert.ok(html.includes("Por revisar con el área"));
  for (const s of cfg.secciones) assert.ok(html.includes(`<h1>${s.titulo}</h1>`), s.titulo);
  // Escapa HTML de los datos y pinta barras (SVG) donde la sección lo pide.
  assert.ok(html.includes("Cotizado &lt;&amp;&gt;"));
  assert.ok(!html.includes("Cotizado <&>"));
  assert.ok(html.includes("<svg"));
  assert.ok(!html.includes("Evolución contra"));
});

test("con histórico del mismo periodo sale la lámina de evolución", () => {
  const d = mantenimiento();
  const previo: HistoricoGenerico = { desde: "2026-09-07", hasta: "2026-10-06", dias: 30, indicadores: { ...d.indicadores, folios_abiertos: 140, saldo_por_cobrar: 600000 }, generado_en: "2026-10-06T20:00:00Z" };
  const html = htmlPresentacionArea(d, { organizacion: "Grupo Loma", hoy: "2026-11-05", historico: [previo] });
  assert.equal(cuenta(html), 5 + AREAS_REPORTE.mantenimiento.secciones.length);
  assert.equal(laminasArea(d, [previo]), 5 + AREAS_REPORTE.mantenimiento.secciones.length);
  assert.ok(html.includes("Evolución contra los reportes anteriores"));
  assert.ok(html.includes("06/10/26"));
  assert.ok(html.includes("−20")); // folios abiertos bajaron 20 (mejora)
  // Un histórico de otro periodo (dias distinto) no se compara.
  const otro = htmlPresentacionArea(d, { organizacion: "Grupo Loma", hoy: "2026-11-05", historico: [{ ...previo, dias: 90 }] });
  assert.ok(otro.includes("Evolución contra")); // serieEvolucion no filtra por dias: la pantalla manda solo los del mismo periodo
});

test("todas las áreas arman presentación con datos vacíos", () => {
  for (const area of LISTA_AREAS) {
    const d: ReporteArea = { area, desde: "2026-10-07", hasta: "2026-11-05", dias: 30, indicadores: {}, secciones: {} };
    const html = htmlPresentacionArea(d, { organizacion: "X", hoy: "2026-11-05" });
    assert.equal(cuenta(html), 4 + AREAS_REPORTE[area].secciones.length, area);
    assert.ok(html.includes("Sin registros en el periodo."), area);
  }
});
