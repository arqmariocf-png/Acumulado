import test from "node:test";
import assert from "node:assert/strict";
import { cifrasTarjeta, empresaDeResumen, formatearKpiEmpresa, grupoDeEmpresa, saldoGrupo, tieneKpiEmpresa, type ResumenSocio } from "./kpisEmpresa.ts";

const resumen: ResumenSocio = {
  calculado_en: "2026-09-25T00:00:00Z",
  grupos: [
    {
      id: "g1", codigo: "LOMA", nombre: "Grupo Loma", marca_comercial: null, es_maestro: true, activo: true,
      empresas: [
        { id: "e1", codigo: "ERG", nombre: "Ergodinova", activo: true, kpis: { fin_saldo_consolidado: 1000, fin_pagos_vencidos: 2, inventario_oc: 0 } },
        { id: "e2", codigo: "MCC", nombre: "Clavicón", activo: true, kpis: { fin_saldo_consolidado: -50, rh_asistencia_hoy: null } },
      ],
    },
    { id: "g2", codigo: "ARSSA", nombre: "ARSSA", marca_comercial: "ARSSA", es_maestro: false, activo: true, empresas: [] },
  ],
};

test("formatea dinero, porcentaje, días y conteos", () => {
  assert.match(String(formatearKpiEmpresa("fin_saldo_consolidado", 1234.5).valor), /1,235/);
  assert.equal(formatearKpiEmpresa("rh_asistencia_hoy", 80).valor, 80);
  assert.equal(formatearKpiEmpresa("log_dias_entrega", 1.5).detalle, "días");
  assert.equal(formatearKpiEmpresa("inventario_oc", 3).valor, 3);
  assert.deepEqual(formatearKpiEmpresa("rh_asistencia_hoy", null), { valor: "—", detalle: "sin dato" });
});

test("tieneKpiEmpresa distingue clave ausente de valor null", () => {
  const k = resumen.grupos[0].empresas[1].kpis;
  assert.equal(tieneKpiEmpresa(k, "rh_asistencia_hoy"), true);
  assert.equal(tieneKpiEmpresa(k, "bbva_folios"), false);
  assert.equal(tieneKpiEmpresa(undefined, "x"), false);
});

test("busca empresa y grupo dentro del resumen", () => {
  assert.equal(empresaDeResumen(resumen, "e2")?.codigo, "MCC");
  assert.equal(grupoDeEmpresa(resumen, "e2")?.codigo, "LOMA");
  assert.equal(empresaDeResumen(resumen, "nope"), undefined);
  assert.equal(empresaDeResumen(undefined, "e1"), undefined);
});

test("cifras de tarjeta marcan alerta con saldo negativo o pendientes", () => {
  const c = cifrasTarjeta(resumen.grupos[0].empresas[1].kpis);
  assert.equal(c[0].alerta, true);
  assert.equal(c[1].valor, "0");
  assert.equal(c[1].alerta, false);
  const d = cifrasTarjeta(resumen.grupos[0].empresas[0].kpis);
  assert.equal(d[1].alerta, true);
});

test("saldo del grupo suma sus empresas", () => {
  assert.equal(saldoGrupo(resumen.grupos[0]), 950);
  assert.equal(saldoGrupo(resumen.grupos[1]), 0);
});
