import { test } from "node:test";
import assert from "node:assert/strict";
import {
  conteoPorEstado,
  faltaPorSurtir,
  filtrarHerramientas,
  htmlEtiquetas,
  htmlResguardo,
  resumenPorObra,
  semaforoDevolucion,
  sugerirParaRenglon,
  type Herramienta,
} from "./herramientas.ts";

const h = (folio: string, nombre: string, extra: Partial<Herramienta> = {}): Herramienta => ({
  id: folio,
  empresa_id: "csc",
  folio,
  nombre,
  categoria: "herramienta",
  marca: null,
  modelo: null,
  numero_serie: null,
  costo: null,
  fecha_compra: null,
  estado: "disponible",
  condicion: "buena",
  proyecto_id: null,
  responsable_id: null,
  responsable_nombre: null,
  asignada_en: null,
  devolver_el: null,
  notas: null,
  ...extra,
});

const lista = [
  h("HE-CSC-0001", "Rotomartillo", { marca: "Bosch", estado: "asignada", proyecto_id: "obraA", responsable_nombre: "Brenda", costo: 3500, devolver_el: "2026-10-15" }),
  h("HE-CSC-0002", "Rotomartillo", { marca: "Bosch", condicion: "regular" }),
  h("HE-CSC-0010", "Rotomartillo", { marca: "Makita" }),
  h("HE-CSC-0003", "Andamio tubular", { estado: "asignada", proyecto_id: "obraB", responsable_nombre: "Javier", costo: 1200, devolver_el: "2026-10-30" }),
  h("HE-CSC-0004", "Nivel láser", { estado: "asignada", proyecto_id: "obraB", responsable_nombre: "Javier", costo: 4800, devolver_el: "2026-10-18" }),
  h("HE-CSC-0005", "Revolvedora", { estado: "reparacion" }),
];

test("semáforo de devolución: solo lo que está en obra con fecha", () => {
  assert.equal(semaforoDevolucion(lista[0], "2026-10-17"), "vencida");
  assert.equal(semaforoDevolucion(lista[4], "2026-10-17"), "por_vencer");
  assert.equal(semaforoDevolucion(lista[3], "2026-10-17"), "a_tiempo");
  assert.equal(semaforoDevolucion(lista[1], "2026-10-17"), null);
  assert.equal(semaforoDevolucion({ estado: "asignada", devolver_el: null }, "2026-10-17"), null);
});

test("resumen por obra: vencidas primero, valor y responsables sin repetir", () => {
  const r = resumenPorObra(lista, "2026-10-17");
  assert.deepEqual(
    r.map((x) => [x.proyecto_id, x.piezas, x.valor, x.vencidas, x.responsables]),
    [
      ["obraA", 1, 3500, 1, ["Brenda"]],
      ["obraB", 2, 6000, 0, ["Javier"]],
    ],
  );
  assert.deepEqual(conteoPorEstado(lista), { disponible: 2, asignada: 3, reparacion: 1, baja: 0, extraviada: 0 });
});

test("búsqueda por palabras sin acentos, también por responsable y obra", () => {
  assert.deepEqual(filtrarHerramientas(lista, "laser nivel").map((x) => x.folio), ["HE-CSC-0004"]);
  assert.deepEqual(filtrarHerramientas(lista, "bosch").map((x) => x.folio), ["HE-CSC-0001", "HE-CSC-0002"]);
  assert.deepEqual(filtrarHerramientas(lista, "javier andamio").map((x) => x.folio), ["HE-CSC-0003"]);
  assert.deepEqual(filtrarHerramientas(lista, "paseo", (id) => (id === "obraA" ? "Paseo 6" : "")).map((x) => x.folio), ["HE-CSC-0001"]);
  assert.equal(filtrarHerramientas(lista, "  ").length, lista.length);
});

test("sugerencias para surtir: disponibles parecidas, buena condición y folio en orden", () => {
  assert.deepEqual(sugerirParaRenglon(lista, "rotomartillo").map((x) => x.folio), ["HE-CSC-0010", "HE-CSC-0002"]);
  assert.deepEqual(sugerirParaRenglon(lista, "taladro"), []);
  assert.equal(faltaPorSurtir({ cantidad: 3, surtido: 1 }), 2);
  assert.equal(faltaPorSurtir({ cantidad: 1, surtido: 2 }), 0);
});

test("resguardo con piezas, total, fechas en letra y firmas", () => {
  const html = htmlResguardo({
    empresa_nombre: "Constructora",
    empresa_codigo: "CSC",
    obra: "Paseo 6 <Ampliación>",
    responsable: "Brenda",
    fecha: "2026-10-17",
    folio_solicitud: "SH-CSC-0001",
    entrega_nombre: "Alma",
    piezas: [lista[0], lista[4]],
  });
  assert.match(html, /RESGUARDO DE HERRAMIENTA Y EQUIPO/);
  assert.match(html, /Paseo 6 &lt;Ampliación&gt;/);
  assert.match(html, /17 de octubre de 2026 · solicitud SH-CSC-0001/);
  assert.match(html, /2 piezas · valor total<\/th><th class="n">\$8,300\.00/);
  assert.match(html, /15 de octubre de 2026/);
  assert.match(html, /artículo 110/);
  assert.match(html, /Entrega \(almacén\)<br><strong>Alma/);
});

test("etiquetas con código de barras del folio", () => {
  const html = htmlEtiquetas([lista[0]], "CSC");
  assert.match(html, /<svg[^>]*>.*HE-CSC-0001<\/text><\/svg>/s);
  assert.match(html, /Rotomartillo/);
});
