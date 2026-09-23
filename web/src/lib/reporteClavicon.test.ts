import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlReporteClavicon, resumenLotes } from "./reporteClavicon.ts";

test("resumenLotes cuenta abiertos, terminados y atrasados", () => {
  const r = resumenLotes([
    { folio: "L1", producto: "Malla", proyecto: null, cantidad_planeada: 10, cantidad_producida: 0, fecha_inicio: "2026-09-01", fecha_estimada_embarque: "2026-09-05", estado: "en_proceso", avance_pct: 0 },
    { folio: "L2", producto: "Malla", proyecto: null, cantidad_planeada: 10, cantidad_producida: 10, fecha_inicio: "2026-09-01", fecha_estimada_embarque: "2026-09-05", estado: "terminada", avance_pct: 100 },
    { folio: "L3", producto: "Clavo", proyecto: null, cantidad_planeada: 10, cantidad_producida: 0, fecha_inicio: "2026-09-20", fecha_estimada_embarque: "2099-01-01", estado: "planeada", avance_pct: 0 },
  ]);
  assert.equal(r.abiertos, 2);
  assert.equal(r.terminados, 1);
  assert.equal(r.atrasados, 1);
});

test("htmlReporteClavicon arma secciones y escapa", () => {
  const html = htmlReporteClavicon({
    empresa: "Mallas y Clavos <Clavicón>",
    rfc: "MCC1",
    fecha: "2026-09-23",
    semanaInicio: "2026-09-21",
    semanaFin: "2026-09-26",
    elaboro: "Mario",
    lotes: [{ folio: "Lote 1", producto: "Malla 6-6", proyecto: "Obra A", cantidad_planeada: 100, cantidad_producida: 40, fecha_inicio: "2026-09-21", fecha_estimada_embarque: "2026-09-25", estado: "en_proceso", avance_pct: 40 }],
    operaciones: [{ fecha: "2026-09-23", inicio: "08:00", fin: "10:00", maquina: "Soldadora 1", lote: "Lote 1", paso: "Soldado", estado: "programada", minutos_programados: 120, minutos_reales: null }],
    carga: [{ maquina: "Soldadora 1", minutos: 120, pct: 3 }],
    stockMateria: [{ nombre: "Alambrón", unidad: "kg", stock: 500, costo_promedio: 18.5 }],
    stockProducto: [],
    costeoMes: [{ producto: "Malla 6-6", lotes: 2, cantidad: 200, costo_total: 50000, costo_unitario: 250 }],
    entradasSinOc: 2,
    remisionesMes: 5,
  });
  assert.match(html, /Mallas y Clavos &lt;Clavicón&gt;/);
  assert.match(html, /REPORTE DE PLANTA/);
  assert.match(html, /23 de septiembre de 2026/);
  assert.match(html, /Soldadora 1/);
  assert.match(html, /Alambrón/);
  assert.match(html, /\$50,000\.00/);
  assert.match(html, /Entradas MP sin OC<\/span><b class="rojo">2/);
});
