import { test } from "node:test";
import assert from "node:assert/strict";
import { claveEmpresa, costoSinIva, empresaCompradoraSugerida, indiceLigas, interempresaCompleta, ligasDeOrden, partidasDesdeOrigen, partidasOrigen, partidasVenta, precioConComision, resumenInterempresa, revisarCompraDesdeOv, separarLigas, revisarInterempresa, textoLigas, type LigaInterempresa } from "./interempresa.ts";

test("costo sin IVA: backoffice trae IVA en la partida, las propias no", () => {
  assert.equal(costoSinIva({ costo: 116, iva: true }, "api"), 100);
  assert.equal(costoSinIva({ costo: 116, iva: false }, "api"), 116);
  assert.equal(costoSinIva({ costo: 100, iva: true }, "acumulado"), 100);
  assert.equal(costoSinIva({ costo: 100, iva: true }, "requisicion"), 100);
});

test("precio con comisión redondeado al centavo", () => {
  assert.equal(precioConComision(100, 15), 115);
  assert.equal(precioConComision(33.33, 10), 36.66);
  assert.equal(precioConComision(100, Number.NaN), 100);
});

test("partidas de la orden original: sin vacías, costo s/IVA", () => {
  const ps = partidasDesdeOrigen(
    [
      { item: "Alambrón 5.5", unidad: "kg", cantidad: "5695", costo: 18.64, iva: true },
      { item: "", unidad: null, cantidad: 1, costo: 1, iva: true },
      { item: "Flete", unidad: null, cantidad: 0, costo: 500, iva: true },
    ],
    "api",
  );
  assert.equal(ps.length, 1);
  assert.equal(ps[0].costo, 16.07);
  assert.equal(ps[0].cantidad, "5695");
});

test("precio corregido a mano gana sobre la comisión; resumen y % real", () => {
  const ps = partidasDesdeOrigen(
    [
      { item: "Varilla", unidad: "pza", cantidad: 10, costo: 100, iva: true },
      { item: "Cemento", unidad: "bulto", cantidad: 2, costo: 200, iva: true },
    ],
    "acumulado",
  );
  ps[1].precio = "250";
  const venta = partidasVenta(ps, 10);
  assert.deepEqual(venta.map((v) => v.costo), [110, 250]);
  const r = resumenInterempresa(ps, 10);
  assert.deepEqual(r, { costo: 1400, venta: 1600, comision: 200, pct: 14.29 });
  ps[0].incluir = false;
  assert.equal(partidasVenta(ps, 10).length, 1);
  assert.equal(resumenInterempresa(ps, 10).venta, 500);
});

test("revisarInterempresa", () => {
  const ps = partidasDesdeOrigen([{ item: "Varilla", unidad: "pza", cantidad: 1, costo: 1, iva: true }], "acumulado");
  assert.deepEqual(revisarInterempresa({ empresaVende: "a", empresaCompra: "b", formaPago: "Transferencia", partidas: ps }), []);
  assert.match(revisarInterempresa({ empresaVende: "a", empresaCompra: "a", formaPago: "x", partidas: ps })[0], /otra/);
  assert.match(revisarInterempresa({ empresaVende: "a", empresaCompra: "", formaPago: "x", partidas: ps })[0], /empresa/);
  assert.match(revisarInterempresa({ empresaVende: "a", empresaCompra: "b", formaPago: "", partidas: ps })[0], /forma de pago/);
  ps[0].incluir = false;
  assert.match(revisarInterempresa({ empresaVende: "a", empresaCompra: "b", formaPago: "x", partidas: ps })[0], /partida/);
});

test("solo lo que falta por vender inter empresa; completa sin partidas pendientes", () => {
  const lineas = [
    { linea_id: "l1", restante: 0, item: "Varilla", unidad: "pza", cantidad: 10, costo: 100, iva: true },
    { linea_id: "l2", restante: 3, item: "Cemento", unidad: "bulto", cantidad: 5, costo: 200, iva: true },
  ];
  const ps = partidasDesdeOrigen(lineas, "acumulado");
  assert.equal(ps.length, 1);
  assert.equal(ps[0].cantidad, "3");
  assert.equal(ps[0].maximo, 3);
  assert.deepEqual(partidasOrigen(ps), [{ linea: "l2", cantidad: 3 }]);
  ps[0].cantidad = "4";
  assert.match(revisarInterempresa({ empresaVende: "a", empresaCompra: "b", formaPago: "x", partidas: ps })[0], /solo faltan 3/);
  assert.equal(interempresaCompleta(lineas), false);
  assert.equal(interempresaCompleta(lineas.map((l) => ({ ...l, restante: 0 }))), true);
  assert.equal(interempresaCompleta([]), false);
});

test("OC desde OV: empresa compradora por el nombre del cliente", () => {
  const empresas = [
    { id: "aep", nombre: "Aceros y Envasados de Puebla", codigo: "AEP", razon_social: "Aceros y Envasados de Puebla S.A. de C.V." },
    { id: "csc", nombre: "Constructora Loma", codigo: "CSC", razon_social: "Constructora, Supervisión y Consultoría Loma S.A. de C.V." },
    { id: "erg", nombre: "Ergodinova", codigo: "ERG", razon_social: "Ergodinova S.A. de C.V." },
  ];
  assert.equal(empresaCompradoraSugerida("Constructora, Supervisión y Consultoría Loma S.A. de C.V.", empresas, "aep")?.codigo, "CSC");
  assert.equal(empresaCompradoraSugerida("ergodinova sa de cv", empresas, "aep")?.codigo, "ERG");
  assert.equal(empresaCompradoraSugerida("Ergodinova", empresas, "aep")?.codigo, "ERG");
  assert.equal(empresaCompradoraSugerida("Mario Contreras Farfán", empresas, "aep"), null, "cliente externo");
  assert.equal(empresaCompradoraSugerida("Aceros y Envasados de Puebla", empresas, "aep"), null, "la misma que vende");
  assert.equal(claveEmpresa("Constructora, Supervisión y Consultoría Loma S.A. de C.V."), "CONSTRUCTORA SUPERVISION Y CONSULTORIA LOMA");
});

test("OC desde OV: validación", () => {
  assert.deepEqual(revisarCompraDesdeOv({ empresaVende: "aep", empresaCompra: "csc", tipo: "OC", lineas: 2, cancelada: false }), []);
  assert.deepEqual(revisarCompraDesdeOv({ empresaVende: "aep", empresaCompra: "", tipo: "OC", lineas: 0, cancelada: true }), [
    "La orden de venta está cancelada.",
    "Elige la empresa del grupo que compra.",
    "La orden de venta no tiene partidas.",
  ]);
  assert.deepEqual(revisarCompraDesdeOv({ empresaVende: "aep", empresaCompra: "aep", tipo: "OX", lineas: 1, cancelada: false }), [
    "La empresa que compra debe ser distinta de la que vende.",
    "El tipo debe ser compra (OC) o servicio (OS).",
  ]);
});

test("ligasDeOrden: primero de dónde viene, luego lo que generó, sin repetidos", () => {
  const codigo = (id: string) => ({ a: "AEP", c: "CSC" })[id] ?? "?";
  const ligas: LigaInterempresa[] = [
    { orden_id: "oc1", es_venta: false, relacion: "genera", liga_id: "ov9", liga_tipo: "OV", liga_folio: "IA-OV-0009", liga_empresa_id: "a" },
    { orden_id: "oc1", es_venta: false, relacion: "genera", liga_id: "oc5", liga_tipo: "OC", liga_folio: "IA-OC-0005", liga_empresa_id: "c" },
    { orden_id: "oc1", es_venta: false, relacion: "genera", liga_id: "oc5", liga_tipo: "OC", liga_folio: "IA-OC-0005", liga_empresa_id: "c" },
    { orden_id: "oc1", es_venta: false, relacion: "origen", liga_id: "ov2", liga_tipo: "OV", liga_folio: "IA-OV-0002", liga_empresa_id: "a" },
    { orden_id: "otra", es_venta: true, relacion: "genera", liga_id: "x", liga_tipo: "OC", liga_folio: "IA-OC-0001", liga_empresa_id: "c" },
  ];
  const r = ligasDeOrden(ligas, "oc1", codigo);
  assert.deepEqual(
    r.map((l) => l.texto),
    ["← IA-OV-0002 (AEP)", "→ IA-OC-0005 (CSC)", "→ IA-OV-0009 (AEP)"],
  );
  assert.equal(textoLigas(r), "← IA-OV-0002 (AEP) · → IA-OC-0005 (CSC) · → IA-OV-0009 (AEP)");
  assert.deepEqual(ligasDeOrden(ligas, "nada", codigo), []);
  const { ov, oc } = separarLigas(r);
  assert.equal(textoLigas(ov), "← IA-OV-0002 (AEP) · → IA-OV-0009 (AEP)");
  assert.equal(textoLigas(oc), "→ IA-OC-0005 (CSC)");
  assert.equal(indiceLigas(ligas).get("oc1")?.length, 4);
});
