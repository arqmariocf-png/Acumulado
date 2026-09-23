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

test("mapea una OC con los campos reales confirmados de api_ocs_aut (2026-08-25)", () => {
  const json = {
    Id_Orden: 39408,
    Tipo_orden: "Compra",
    Categoria_orden: "Material",
    Proyecto: "Corporativo CLAVICON",
    Empresa_solicitante: "Aceros y Envasados de Puebla",
    Proveedor: "INDUSTRIAL DE ALAMBRES SA DE CV",
    Creado: "2026-07-01 13:11:29",
    TOTAL: 58760.38,
  };
  const oc = mapearOrdenCompraDesdeApi(json);
  assert.equal(oc.idOrden, "39408");
  assert.equal(oc.tipo, "OC");
  assert.equal(oc.proveedor, "INDUSTRIAL DE ALAMBRES SA DE CV");
  assert.equal(oc.total, 58760.38);
  assert.equal(oc.fechaCreacion, "2026-07-01");
  assert.equal(oc.empresaNombre, "Aceros y Envasados de Puebla");
});

test("Tipo_orden = 'Servicio' mapea a OS (así distingue la API real OC de OS, no hay un valor 'OC'/'OS' literal)", () => {
  const oc = mapearOrdenCompraDesdeApi({ Id_Orden: "1", Tipo_orden: "Servicio", TOTAL: 100 });
  assert.equal(oc.tipo, "OS");
});

test("mapea una OV desde el JSON de la API", () => {
  const json = { "Id OV": "14628", Proyecto: "P", Empresa: "ERG", Cliente: "Cliente X", Total: 1000, FechaOV: "2026-07-10" };
  const ov = mapearOrdenVentaDesdeApi(json);
  assert.equal(ov.idOv, "14628");
  assert.equal(ov.cliente, "Cliente X");
  assert.equal(ov.fechaOv, "2026-07-10");
});

test("mapea una OV con los campos reales confirmados de api_ov_aut (2026-08-25)", () => {
  const json = {
    Id_cotizacion: 14628,
    Folio_orden_venta: "14628",
    Project: "Retail",
    FechaOV: "2026-07-01 15:14:18",
    Id_empresa: 1,
    empresa: "Aceros y Envasados de Puebla",
    Cliente_nombre: "VENTA AL PUBLICO EN GENERAL",
    Cliente_apellido: null,
    OV_Subtotal: 29260,
  };
  const ov = mapearOrdenVentaDesdeApi(json);
  assert.equal(ov.idOv, "14628");
  assert.equal(ov.proyecto, "Retail");
  assert.equal(ov.cliente, "VENTA AL PUBLICO EN GENERAL");
  assert.equal(ov.total, 29260);
  assert.equal(ov.fechaOv, "2026-07-01");
  assert.equal(ov.empresaNombre, "Aceros y Envasados de Puebla");
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
