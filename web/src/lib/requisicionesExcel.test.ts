import { test } from "node:test";
import assert from "node:assert/strict";
import { COLUMNAS_EXCEL_RENGLONES, COLUMNAS_EXCEL_REQUISICIONES, csvRequisiciones, csvRequisicionesRenglones, nombreExcelRequisiciones, textoEstado, textoEtapa } from "./requisicionesExcel.ts";

const req = {
  id: "r1",
  folio: 143,
  fecha: "2026-11-17",
  estado: "enviada",
  etapa: "solicitada",
  comentario: 'Urgente, "celosía"',
  solicitante_nombre: "Maria Fernanda",
  empresas: { codigo: "CSC" },
  proyectos: { nombre: "IKEA Puebla" },
  avance: { partidas: 6, avance_pct: 16.7, sin_pedir: 4, en_bodega: 2, en_transito: 0, en_obra: 0 },
  sin_resolver: 4,
};

test("csvRequisiciones: encabezado y una fila por requisición con comillas escapadas", () => {
  const csv = csvRequisiciones([req]);
  const [cab, fila] = csv.split("\n");
  assert.equal(cab, COLUMNAS_EXCEL_REQUISICIONES.map((c) => `"${c}"`).join(","));
  assert.equal(fila, '"143","2026-11-17","CSC","IKEA Puebla","Maria Fernanda","Enviada","Solicitada","6","16.7","4","2","0","0","4","Urgente, ""celosía"""');
});

test("csvRequisiciones: sin avance ni comentario no truena", () => {
  const csv = csvRequisiciones([{ ...req, avance: null, comentario: null, sin_resolver: undefined }]);
  assert.ok(csv.split("\n")[1].endsWith('"0","0","0","0","0","0","0",""'));
});

test("csvRequisicionesRenglones: una fila por renglón con lo que falta en obra", () => {
  const renglones = [
    { id: "l1", requisicion_id: "r1", descripcion: "Varilla 3/8", cantidad_solicitada: 10, unidad_medida: "pza", comentario: null },
    { id: "l2", requisicion_id: "r1", descripcion: null, cantidad_solicitada: 2, unidad_medida: "kg", productos: { nombre: "Alambrón" } },
  ];
  const entrega = [{ requisicion_linea_id: "l1", pedido: 10, comprado: 10, en_bodega: 4, en_transito: 2, recibido_obra: 3, etapa_partida: "en_bodega" }];
  const csv = csvRequisicionesRenglones([req], renglones, entrega);
  const lineas = csv.split("\n");
  assert.equal(lineas.length, 3);
  assert.equal(lineas[0], COLUMNAS_EXCEL_RENGLONES.map((c) => `"${c}"`).join(","));
  assert.equal(lineas[1], '"143","2026-11-17","CSC","IKEA Puebla","Maria Fernanda","Enviada","Solicitada","Varilla 3/8","pza","10","10","10","4","2","3","7","en_bodega",""');
  assert.equal(lineas[2], '"143","2026-11-17","CSC","IKEA Puebla","Maria Fernanda","Enviada","Solicitada","Alambrón","kg","2","0","0","0","0","0","2","",""');
});

test("csvRequisicionesRenglones: requisición sin renglones sale con una fila aviso", () => {
  const csv = csvRequisicionesRenglones([req], [], []);
  assert.ok(csv.split("\n")[1].includes('"(sin renglones)"'));
});

test("textos de estado y etapa, y nombre del archivo", () => {
  assert.equal(textoEstado("en_revision"), "En revisión");
  assert.equal(textoEstado("otro"), "otro");
  assert.equal(textoEtapa("en_transito"), "En tránsito");
  assert.equal(nombreExcelRequisiciones(new Date(2026, 10, 18)), "requisiciones-2026-11-18.csv");
  assert.equal(nombreExcelRequisiciones(new Date(2026, 10, 18), "renglones"), "requisiciones-renglones-2026-11-18.csv");
});
