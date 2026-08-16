import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, filasAObjetos } from "./csv.ts";
import {
  mapearOrdenCompraDesdeApi,
  mapearOrdenVentaDesdeApi,
  mapearFilaOrdenCompraExcel,
  mapearFilaOrdenVentaExcel,
  normalizarEncabezadoOcOv,
} from "./oc-ov.ts";

test("mapea una OC desde el JSON de la API con los campos exactos del spec", () => {
  const json = { Id_Orden: "39466", Proyecto: "Cubiertas 2025", Empresa_solicitante: "AEP", Proveedor: "Ferretería en Mayoreo", Total: "5233.33", Creado: "7/3/26" };
  const oc = mapearOrdenCompraDesdeApi(json);
  assert.equal(oc.idOrden, "39466");
  assert.equal(oc.tipo, "OC");
  assert.equal(oc.proveedor, "Ferretería en Mayoreo");
  assert.equal(oc.total, 5233.33);
  assert.equal(oc.fechaCreacion, "2026-07-03");
});

test("respeta el campo Tipo cuando la API lo trae como OS", () => {
  const oc = mapearOrdenCompraDesdeApi({ Id_Orden: "1", Tipo: "OS" });
  assert.equal(oc.tipo, "OS");
});

test("mapea una OV desde el JSON de la API", () => {
  const json = { "Id OV": "14628", Proyecto: "P", Empresa: "ERG", Cliente: "Cliente X", Total: 1000, FechaOV: "2026-07-10" };
  const ov = mapearOrdenVentaDesdeApi(json);
  assert.equal(ov.idOv, "14628");
  assert.equal(ov.cliente, "Cliente X");
  assert.equal(ov.fechaOv, "2026-07-10");
});

test("mapea OC desde Excel de respaldo usando los mismos nombres de campo como encabezados", () => {
  const csv = "Id_Orden,Proyecto,Proveedor,Total,Creado\n39466,Cubiertas 2025,Ferretería,5233.33,7/3/26";
  const objetos = filasAObjetos(parseCsv(csv), normalizarEncabezadoOcOv);
  const oc = mapearFilaOrdenCompraExcel(objetos[0]);
  assert.equal(oc!.idOrden, "39466");
  assert.equal(oc!.total, 5233.33);
});

test("fila de Excel sin Id_Orden se descarta (null) en vez de insertarse vacía", () => {
  const csv = "Id_Orden,Proyecto\n,Sin id";
  const objetos = filasAObjetos(parseCsv(csv), normalizarEncabezadoOcOv);
  assert.equal(mapearFilaOrdenCompraExcel(objetos[0]), null);
});

test("mapea OV desde Excel de respaldo", () => {
  const csv = "Id OV,Proyecto,Cliente,Total,FechaOV\n14628,P,Cliente X,1000,7/10/26";
  const objetos = filasAObjetos(parseCsv(csv), normalizarEncabezadoOcOv);
  const ov = mapearFilaOrdenVentaExcel(objetos[0]);
  assert.equal(ov!.idOv, "14628");
  assert.equal(ov!.fechaOv, "2026-07-10");
});
