import { test } from "node:test";
import assert from "node:assert/strict";
import {
  celdaCantidad,
  construirTarjetaPu,
  dinero,
  etiquetaEstado,
  porcentaje,
  textoCantidad,
  tituloTarjeta,
  type CabeceraPu,
  type RenglonPu,
} from "./pu-tarjeta.ts";

function cabecera(parcial: Partial<CabeceraPu> = {}): CabeceraPu {
  return {
    empresaNombre: "Constructora, Supervisión y Consultoría LOMA",
    proyectoNombre: "Obra Angelópolis",
    codigo: "MUR-TAB-01",
    concepto: "Muro de tabique rojo recocido de 12 cm",
    unidad: "M2",
    esAuxiliar: false,
    estado: "publicado",
    creadoPorNombre: "Supervisor CSC",
    factorNombre: "Base 2026",
    indirectosPct: 0.15,
    financiamientoPct: 0.01,
    utilidadPct: 0.1,
    cargosAdicionalesPct: 0.005,
    costoDirecto: 129.44,
    importeIndirectos: 19.42,
    importeFinanciamiento: 1.49,
    importeUtilidad: 15.03,
    importeCargosAdicionales: 0.83,
    precioUnitario: 166.21,
    insumosSinPrecio: 0,
    ...parcial,
  };
}

function renglon(parcial: Partial<RenglonPu> & Pick<RenglonPu, "tipo" | "importe">): RenglonPu {
  return {
    orden: 1,
    baseCalculo: "cantidad",
    codigo: "X-01",
    descripcion: "Insumo",
    unidad: "PZA",
    aportacion: 1,
    costoUnitario: parcial.importe,
    sinPrecio: false,
    proveedor: null,
    ...parcial,
  };
}

test("agrupa los renglones en el orden en que se imprime la tarjeta", () => {
  const t = construirTarjetaPu(cabecera(), [
    renglon({ orden: 3, tipo: "herramienta", baseCalculo: "pct_mano_obra", aportacion: 0.03, importe: 3.19 }),
    renglon({ orden: 1, tipo: "mano_obra", importe: 106.25 }),
    renglon({ orden: 2, tipo: "auxiliar", importe: 20.0 }),
  ]);

  assert.deepEqual(
    t.grupos.map((g) => g.titulo),
    ["Mano de obra", "Herramienta y equipo", "Básicos"],
  );
});

test("no imprime un grupo vacío", () => {
  const t = construirTarjetaPu(cabecera(), [renglon({ tipo: "material", importe: 10 })]);
  assert.deepEqual(
    t.grupos.map((g) => g.titulo),
    ["Materiales"],
  );
});

test("herramienta y equipo comparten un solo capítulo, con su subtotal junto", () => {
  const t = construirTarjetaPu(cabecera(), [
    renglon({ orden: 1, tipo: "herramienta", importe: 3.19 }),
    renglon({ orden: 2, tipo: "equipo", importe: 12.5 }),
  ]);

  assert.equal(t.grupos.length, 1);
  assert.equal(t.grupos[0].titulo, "Herramienta y equipo");
  assert.equal(t.grupos[0].renglones.length, 2);
  assert.equal(t.grupos[0].subtotal, 15.69);
});

test("los renglones de un grupo salen por orden de captura, no por como llegaron", () => {
  const t = construirTarjetaPu(cabecera(), [
    renglon({ orden: 9, tipo: "material", codigo: "B", importe: 1 }),
    renglon({ orden: 2, tipo: "material", codigo: "A", importe: 1 }),
  ]);
  assert.deepEqual(
    t.grupos[0].renglones.map((r) => r.codigo),
    ["A", "B"],
  );
});

test("el subtotal no arrastra ruido de punto flotante", () => {
  const t = construirTarjetaPu(cabecera(), [
    renglon({ orden: 1, tipo: "material", importe: 0.1 }),
    renglon({ orden: 2, tipo: "material", importe: 0.2 }),
  ]);
  assert.equal(t.grupos[0].subtotal, 0.3);
});

test("el pie de sobrecosto lleva los cuatro renglones con su porcentaje", () => {
  const t = construirTarjetaPu(cabecera(), [renglon({ tipo: "material", importe: 129.44 })]);

  assert.deepEqual(t.sobrecosto, [
    { etiqueta: "Indirectos 15.00%", importe: 19.42 },
    { etiqueta: "Financiamiento 1.00%", importe: 1.49 },
    { etiqueta: "Utilidad 10.00%", importe: 15.03 },
    { etiqueta: "Cargos adicionales 0.50%", importe: 0.83 },
  ]);
});

test("la tarjeta impresa cuadra sumada a mano", () => {
  const c = cabecera();
  const t = construirTarjetaPu(c, [renglon({ tipo: "material", importe: 129.44 })]);
  const suma = t.sobrecosto.reduce((s, l) => s + l.importe, t.costoDirecto);
  assert.equal(Math.round(suma * 100) / 100, t.precioUnitario);
});

test("un básico no lleva sobrecosto: se consume a costo directo", () => {
  const t = construirTarjetaPu(
    cabecera({ esAuxiliar: true, factorNombre: null, precioUnitario: 1000, costoDirecto: 1000 }),
    [renglon({ tipo: "material", importe: 1000 })],
  );

  assert.deepEqual(t.sobrecosto, []);
  assert.equal(t.precioUnitario, 1000);
  // Y tampoco se le reclama un factor que no le toca tener.
  assert.deepEqual(t.advertencias, []);
});

test("sólo un PU publicado sale sin marca de agua", () => {
  assert.equal(construirTarjetaPu(cabecera({ estado: "publicado" }), []).marcaDeAgua, null);
  for (const estado of ["borrador", "en_revision_material", "material_confirmado", "autorizado", "obsoleto"] as const) {
    assert.equal(
      construirTarjetaPu(cabecera({ estado }), []).marcaDeAgua,
      "SIN AUTORIZAR",
      `${estado} debería salir marcado`,
    );
  }
});

test("avisa cuando el precio está armado sobre insumos sin cotizar", () => {
  const t = construirTarjetaPu(cabecera({ insumosSinPrecio: 2 }), [renglon({ tipo: "material", importe: 0, sinPrecio: true })]);
  assert.match(t.advertencias[0], /2 insumo\(s\) sin costo/);
});

test("avisa cuando la cifra es costo directo y no precio de venta", () => {
  const t = construirTarjetaPu(cabecera({ factorNombre: null }), [renglon({ tipo: "material", importe: 10 })]);
  assert.ok(t.advertencias.some((a) => a.includes("Sin factor de sobrecosto")));
});

test("un análisis sin renglones lo dice, en vez de imprimir una tarjeta en blanco", () => {
  const t = construirTarjetaPu(cabecera(), []);
  assert.ok(t.advertencias.some((a) => a.includes("no tiene renglones")));
});

test("textoCantidad: un porcentaje se imprime como porcentaje, no como fracción", () => {
  assert.equal(textoCantidad(renglon({ tipo: "herramienta", baseCalculo: "pct_mano_obra", aportacion: 0.03, importe: 3 })), "3%");
  assert.equal(textoCantidad(renglon({ tipo: "mano_obra", aportacion: 0.125, importe: 100 })), "0.125");
});

test("celdaCantidad: un porcentaje no repite la unidad del catálogo", () => {
  // El insumo "Herramienta menor" trae unidad "% MO": imprimir las dos daría
  // "3% % MO".
  assert.equal(
    celdaCantidad(renglon({ tipo: "herramienta", baseCalculo: "pct_mano_obra", aportacion: 0.03, unidad: "% MO", importe: 3 })),
    "3%",
  );
  assert.equal(celdaCantidad(renglon({ tipo: "mano_obra", aportacion: 0.125, unidad: "JOR", importe: 100 })), "0.125 JOR");
  assert.equal(celdaCantidad(renglon({ tipo: "material", aportacion: 2, unidad: null, importe: 10 })), "2");
});

test("dinero y porcentaje: formato del documento impreso", () => {
  assert.equal(dinero(166.21), "$166.21");
  assert.equal(dinero(-5), "-$5.00");
  assert.equal(dinero(1234567.5), "$1,234,567.50");
  assert.equal(porcentaje(0.155), "15.50%");
});

test("tituloTarjeta arma la línea de encabezado", () => {
  assert.equal(
    tituloTarjeta(cabecera()),
    "MUR-TAB-01 · Muro de tabique rojo recocido de 12 cm · M2",
  );
});

test("etiquetaEstado traduce el estado a lo que lee una persona", () => {
  assert.equal(etiquetaEstado("en_revision_material"), "En revisión de material");
  assert.equal(etiquetaEstado("publicado"), "Publicado");
});
