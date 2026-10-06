import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCxp, estadoVencimiento, filtrarYOrdenar, llaveCxp, semaforoCredito, totalesCxp, type FilaCxp } from "./cuentasPorPagar.ts";

function fila(p: Partial<FilaCxp>): FilaCxp {
  return {
    empresa_id: "e", clave: "X", proveedor: "X", n_oc: 0, comprometido: 0, n_facturas: 0, facturado: 0, pagado: 0, por_pagar: 0, sin_facturar: 0,
    linea_credito: null, dias_credito: null, notas: null, vencimiento: null, disponible: null, ultima_oc: null, ultima_factura: null, ultimo_pago: null, empresas: [], pagado_oc: 0, saldo_oc: 0, n_oc_por_pagar: 0,
    ...p,
  } as FilaCxp;
}

test("sin línea de crédito el semáforo es gris", () => {
  assert.equal(semaforoCredito(5000, null).color, "gris");
  assert.equal(semaforoCredito(5000, 0).color, "gris");
  assert.equal(semaforoCredito(5000, null).pctUsado, null);
});

test("rojo si se rebasa la línea o queda menos del 10 %", () => {
  assert.equal(semaforoCredito(120_000, 100_000).color, "rojo");
  assert.equal(semaforoCredito(95_000, 100_000).color, "rojo");
  assert.equal(semaforoCredito(95_000, 100_000).pctUsado, 95);
});

test("ámbar con menos del 30 % libre, verde con más", () => {
  assert.equal(semaforoCredito(75_000, 100_000).color, "ambar");
  assert.equal(semaforoCredito(50_000, 100_000).color, "verde");
  assert.equal(semaforoCredito(0, 100_000).color, "verde");
});

test("filtra por texto sin acentos y por empresa, y ordena por lo que se debe", () => {
  const filas = [
    fila({ clave: "CEMEX", proveedor: "CEMEX S.A.B. DE C.V.", por_pagar: 100, empresas: ["e1"] }),
    fila({ clave: "MAQUI PRINT", proveedor: "Maqui Print", por_pagar: 500, empresas: ["e2"] }),
    fila({ clave: "LAMINAS", proveedor: "Láminas del Sur", por_pagar: 300, empresas: ["e1", "e2"] }),
  ];
  assert.deepEqual(filtrarYOrdenar(filas, "", "", "por_pagar", false).map((f) => f.clave), ["MAQUI PRINT", "LAMINAS", "CEMEX"]);
  assert.deepEqual(filtrarYOrdenar(filas, "laminas", "", "por_pagar", false).map((f) => f.clave), ["LAMINAS"]);
  assert.deepEqual(filtrarYOrdenar(filas, "", "e1", "proveedor", false).map((f) => f.clave), ["CEMEX", "LAMINAS"]);
});

test("solo con saldo deja fuera lo pagado y sin OC pendiente; disponible ordena lo apretado primero", () => {
  const filas = [
    fila({ clave: "A", proveedor: "A", por_pagar: 0, sin_facturar: 0, linea_credito: 10, disponible: 10 }),
    fila({ clave: "B", proveedor: "B", por_pagar: 90, linea_credito: 100, disponible: 10 }),
    fila({ clave: "C", proveedor: "C", por_pagar: 20, linea_credito: null, disponible: null }),
    fila({ clave: "D", proveedor: "D", por_pagar: 0, sin_facturar: 40, linea_credito: 100, disponible: 100 }),
  ];
  assert.deepEqual(filtrarYOrdenar(filas, "", "", "disponible", true).map((f) => f.clave), ["B", "D", "C"]);
});

test("totales suman y cuentan rojos y líneas capturadas", () => {
  const t = totalesCxp([
    fila({ comprometido: 100, facturado: 80, pagado: 30, por_pagar: 50, sin_facturar: 20, linea_credito: 40 }),
    fila({ comprometido: 10, facturado: 10, pagado: 10, por_pagar: 0, sin_facturar: 0, linea_credito: null }),
  ]);
  assert.equal(t.comprometido, 110);
  assert.equal(t.por_pagar, 50);
  assert.equal(t.con_linea, 1);
  assert.equal(t.rojos, 1);
});

test("vencimiento de la línea: vencida, por vencer a 30 días, vigente", () => {
  assert.equal(estadoVencimiento(null, "2026-09-28").estado, "sin_fecha");
  assert.equal(estadoVencimiento("2026-09-27", "2026-09-28").estado, "vencida");
  assert.equal(estadoVencimiento("2026-09-28", "2026-09-28").estado, "por_vencer");
  assert.equal(estadoVencimiento("2026-10-28", "2026-09-28").estado, "por_vencer");
  assert.equal(estadoVencimiento("2026-10-29", "2026-09-28").estado, "vigente");
  assert.equal(estadoVencimiento("2026-10-29", "2026-09-28").dias, 31);
});

test("filtro por línea: con línea, sin línea, todos", () => {
  const filas = [
    fila({ clave: "A", proveedor: "A", linea_credito: 100 }),
    fila({ clave: "B", proveedor: "B", linea_credito: 0 }),
    fila({ clave: "C", proveedor: "C", linea_credito: null }),
  ];
  assert.deepEqual(filtrarYOrdenar(filas, "", "", "proveedor", false, "con_linea").map((f) => f.clave), ["A"]);
  assert.deepEqual(filtrarYOrdenar(filas, "", "", "proveedor", false, "sin_linea").map((f) => f.clave), ["B", "C"]);
  assert.equal(filtrarYOrdenar(filas, "", "", "proveedor", false, "todos").length, 3);
});

test("csv escapa comas y comillas y trae encabezado", () => {
  const csv = csvCxp([fila({ proveedor: 'Aceros "Norte", SA', por_pagar: 1234.5, empresas: ["e1"] })], (id) => (id === "e1" ? "ERG" : "?"));
  const lineas = csv.split("\r\n");
  assert.equal(lineas.length, 2);
  assert.ok(lineas[0].startsWith("\ufeffProveedor,Empresa,"));
  assert.ok(lineas[1].startsWith('"Aceros ""Norte"", SA",ERG,'));
  assert.ok(lineas[1].includes(",1234.50,"));
});

test("la deuda toma el saldo de OC aunque no esté facturado (Cemex por empresa)", () => {
  const aep = fila({ empresa_id: "aep", clave: "CEMEX", por_pagar: 100, deuda: 170_000, saldo_oc: 170_000, linea_credito: 400_000 });
  const erg = fila({ empresa_id: "erg", clave: "CEMEX", por_pagar: 70_000, deuda: 70_000 });
  assert.equal(llaveCxp(aep) === llaveCxp(erg), false);
  const t = totalesCxp([aep, erg]);
  assert.equal(t.deuda, 240_000);
  assert.equal(filtrarYOrdenar([erg, aep], "", "", "por_pagar", true)[0].empresa_id, "aep");
});
