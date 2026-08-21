import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearPaginasBBVA } from "./pdf-estado-cuenta-bbva.ts";
import { PAGINAS_REALES_BBVA_ACEROS_JULIO_2026 } from "./pdf-estado-cuenta-bbva.fixture.ts";

test("parsea el PDF real de BBVA (Aceros, julio 2026, formato MAESTRA PYME BBVA): 139 movimientos clasificados por columna, cuadra exacto con lo que el banco declara", () => {
  const r = parsearPaginasBBVA(PAGINAS_REALES_BBVA_ACEROS_JULIO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 139);
  const cargos = r.movimientos.filter((m) => m.cargoTotal != null);
  const abonos = r.movimientos.filter((m) => m.abonoTotal != null);
  assert.equal(cargos.length, 116);
  assert.equal(abonos.length, 23);
  const sumaCargos = Math.round(cargos.reduce((a, m) => a + (m.cargoTotal ?? 0), 0) * 100) / 100;
  const sumaAbonos = Math.round(abonos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
  assert.equal(sumaCargos, 1260239.17);
  assert.equal(sumaAbonos, 902140.22);
});

test("si lo extraído queda por debajo de lo que el PDF declara, no bloquea el documento -- inserta lo confiable y agrega una advertencia de fila 0", () => {
  // Reproduce el layout mínimo de una fila de movimiento (fecha a x0<15,
  // descripción a x0≈85.7, monto en la columna Cargos x1≈407.9) más el
  // encabezado "Periodo" y el bloque de totales declarados, pero con UN
  // cargo menos de los que el documento dice traer -- simula una limitación
  // real de extracción sin depender de que el PDF real algún día la tenga.
  const paginaResumen: Parameters<typeof parsearPaginasBBVA>[0][number] = [
    { texto: "DEL 01/07/2026 AL 31/07/2026", x0: 480, x1: 595, y: 725 },
    { texto: "Saldo de Operación Inicial", x0: 316.17, x1: 411.89, y: 507.68 },
    { texto: "100,000.00", x0: 558.96, x1: 600, y: 507.68 },
  ];
  const paginaMovimientos: Parameters<typeof parsearPaginasBBVA>[0][number] = [
    { texto: "02/JUL", x0: 9.8, x1: 35.7, y: 600 },
    { texto: "N06 PAGO CUENTA DE TERCERO", x0: 85.7, x1: 220, y: 600 },
    { texto: "3,209.80", x0: 376.0, x1: 407.9, y: 600 },
    { texto: "TOTAL IMPORTE CARGOS", x0: 26.8, x1: 125.4, y: 100 },
    { texto: "1,260,239.17", x0: 226.6, x1: 272.1, y: 100 },
    { texto: "TOTAL MOVIMIENTOS CARGOS", x0: 313.5, x1: 432.1, y: 100 },
    { texto: "2", x0: 579.5, x1: 592.5, y: 100 },
  ];
  const r = parsearPaginasBBVA([paginaResumen, paginaMovimientos]);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.movimientos.length, 1);
  const advertenciaDocumento = r.erroresPorFila.find((e) => e.fila === 0);
  assert.ok(advertenciaDocumento, "debe traer una advertencia de fila 0 (documento completo)");
  assert.match(advertenciaDocumento!.errores[0], /declara 2 movimiento\(s\) de Cargos.*solo se pudieron extraer 1/);
});

test("si lo extraído queda por ENCIMA de lo que el PDF declara, bloquea todo el documento -- algo se clasificó mal", () => {
  const paginaResumen: Parameters<typeof parsearPaginasBBVA>[0][number] = [
    { texto: "DEL 01/07/2026 AL 31/07/2026", x0: 480, x1: 595, y: 725 },
    { texto: "Saldo de Operación Inicial", x0: 316.17, x1: 411.89, y: 507.68 },
    { texto: "100,000.00", x0: 558.96, x1: 600, y: 507.68 },
  ];
  const paginaMovimientos: Parameters<typeof parsearPaginasBBVA>[0][number] = [
    { texto: "02/JUL", x0: 9.8, x1: 35.7, y: 600 },
    { texto: "N06 PAGO CUENTA DE TERCERO", x0: 85.7, x1: 220, y: 600 },
    { texto: "3,209.80", x0: 376.0, x1: 407.9, y: 600 },
    { texto: "TOTAL IMPORTE CARGOS", x0: 26.8, x1: 125.4, y: 100 },
    { texto: "1,000.00", x0: 226.6, x1: 272.1, y: 100 },
    { texto: "TOTAL MOVIMIENTOS CARGOS", x0: 313.5, x1: 432.1, y: 100 },
    { texto: "0", x0: 579.5, x1: 592.5, y: 100 },
  ];
  const r = parsearPaginasBBVA([paginaResumen, paginaMovimientos]);
  assert.equal(r.movimientos.length, 0);
  assert.match(r.errorDocumento ?? "", /MÁS de lo declarado/);
});

test("clasifica cargo vs abono por la posición de columna (x1), no por delta de saldo", () => {
  const r = parsearPaginasBBVA(PAGINAS_REALES_BBVA_ACEROS_JULIO_2026);

  const nomina = r.movimientos.find((m) => m.nombreRazonSocial?.includes("PAGO DE NOMINA") && m.fechaPago === "2026-07-31")!;
  assert.ok(nomina, "debe existir el pago de nómina del 31 de julio");
  assert.equal(nomina.cargoTotal, 9070.14);
  assert.equal(nomina.abonoTotal, null);

  const ergodinova = r.movimientos.find((m) => m.cargoTotal === null && m.abonoTotal === 254885.11)!;
  assert.ok(ergodinova, "el pago recibido de Ergodinova (columna Abonos) debe existir");
  assert.equal(ergodinova.fechaPago, "2026-07-22");
});

test("el código de transacción (ej. N06, T17) se quita del inicio de la descripción", () => {
  const r = parsearPaginasBBVA(PAGINAS_REALES_BBVA_ACEROS_JULIO_2026);
  const conCodigo = r.movimientos.find((m) => m.nombreRazonSocial === "PAGO CUENTA DE TERCERO");
  assert.ok(conCodigo, 'debe existir al menos una fila "PAGO CUENTA DE TERCERO" sin el prefijo "N06 "');
});

test("las fechas DD/MES se convierten a ISO usando el año del Periodo del encabezado", () => {
  const r = parsearPaginasBBVA(PAGINAS_REALES_BBVA_ACEROS_JULIO_2026);
  assert.ok(r.movimientos.every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.fechaPago)));
  assert.ok(r.movimientos.some((m) => m.fechaPago === "2026-07-02"));
  assert.ok(r.movimientos.some((m) => m.fechaPago === "2026-07-31"));
});

test("un PDF sin páginas de texto reporta errorDocumento en vez de reventar", () => {
  const r = parsearPaginasBBVA([]);
  assert.match(r.errorDocumento ?? "", /no tiene contenido de texto/);
});

test("un PDF sin el Periodo en el encabezado reporta errorDocumento", () => {
  const r = parsearPaginasBBVA([[{ texto: "cualquier otro texto", x0: 0, x1: 10, y: 0 }]]);
  assert.match(r.errorDocumento ?? "", /No se pudo determinar el año/);
});

test("todo movimiento trae un saldo (columna 5859 requiere NOT NULL) calculado acumulando desde el Saldo de Operación Inicial, anclado a los saldos de corte reales que imprime el PDF", () => {
  const r = parsearPaginasBBVA(PAGINAS_REALES_BBVA_ACEROS_JULIO_2026);
  assert.ok(r.movimientos.every((m) => typeof m.saldo === "number" && Number.isFinite(m.saldo)));

  // Saldo de corte real que el PDF imprime tras el último movimiento del 06/JUL.
  const finDia06 = r.movimientos.find((m) => m.fechaPago === "2026-07-06" && m.cargoTotal === 8000)!;
  assert.ok(finDia06, "debe existir el movimiento del 06/JUL con cargo 8,000.00");
  assert.equal(finDia06.saldo, 136573.81);

  // El saldo del último movimiento del documento debe cuadrar con el Saldo
  // de Operación Final que el PDF declara en el resumen.
  const ultimo = r.movimientos[r.movimientos.length - 1];
  assert.equal(ultimo.saldo, 15841.31);
});
