import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearPaginasBBVA } from "./pdf-estado-cuenta-bbva.ts";
import { PAGINAS_REALES_BBVA_ACEROS_JULIO_2026 } from "./pdf-estado-cuenta-bbva.fixture.ts";
import { PAGINAS_REALES_BBVA_MARIO_JULIO_2026 } from "./pdf-estado-cuenta-bbva-mario.fixture.ts";
import { POSICIONES_REAL_BBVA_WEB_ACEROS_AGOSTO_2026 } from "./pdf-estado-cuenta-bbva-web.fixture.ts";
import { PAGINAS_REALES_BBVA_WEB_ACEROS_31_AGOSTO_2026 } from "./pdf-estado-cuenta-bbva-web-nomina.fixture.ts";
import { PAGINAS_REALES_BBVA_APP_MARIO_AGOSTO_2026 } from "./pdf-estado-cuenta-bbva-app-mario.fixture.ts";

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
    { texto: "CARGOS", x0: 372.6, x1: 407.9, y: 650 },
    { texto: "ABONOS", x0: 429.5, x1: 468.9, y: 650 },
    { texto: "OPERACIÓN", x0: 477.8, x1: 534.1, y: 650 },
    { texto: "LIQUIDACIÓN", x0: 545.3, x1: 602.2, y: 650 },
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
    { texto: "CARGOS", x0: 372.6, x1: 407.9, y: 650 },
    { texto: "ABONOS", x0: 429.5, x1: 468.9, y: 650 },
    { texto: "OPERACIÓN", x0: 477.8, x1: 534.1, y: 650 },
    { texto: "LIQUIDACIÓN", x0: 545.3, x1: 602.2, y: 650 },
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

test("parsea un segundo PDF real de BBVA con posiciones de columna DISTINTAS y etiquetas de saldo distintas (Mario Contreras, cuenta 2047, julio 2026)", () => {
  const r = parsearPaginasBBVA(PAGINAS_REALES_BBVA_MARIO_JULIO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 48);

  const cargos = r.movimientos.filter((m) => m.cargoTotal != null);
  const abonos = r.movimientos.filter((m) => m.abonoTotal != null);
  assert.equal(cargos.length, 43);
  assert.equal(abonos.length, 5);

  const sumaCargos = Math.round(cargos.reduce((a, m) => a + (m.cargoTotal ?? 0), 0) * 100) / 100;
  const sumaAbonos = Math.round(abonos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
  assert.equal(sumaCargos, 4603462.95);
  assert.equal(sumaAbonos, 4838583.55);

  // Este PDF declara "Saldo Anterior"/"Saldo Final (+)", no "Saldo de
  // Operación Inicial/Final" -- confirma el fallback de etiquetas.
  const ultimo = r.movimientos[r.movimientos.length - 1];
  assert.equal(ultimo.saldo, 542259.16);

  // La descripción no debe traer la fecha OPER/LIQ pegada al inicio (ver
  // comentario del encabezado sobre items de texto fusionados).
  assert.ok(r.movimientos.every((m) => !/^\d{1,2}\/[A-ZÑ]{3}\b/.test(m.nombreRazonSocial ?? "")));
});

test('parsea el segundo FORMATO de BBVA -- "Detalle de movimientos" de banca en línea (Aceros, agosto 2026): 108 movimientos, orden más reciente primero, sin totales declarados pero con saldo consistente en cada fila', () => {
  const r = parsearPaginasBBVA(POSICIONES_REAL_BBVA_WEB_ACEROS_AGOSTO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 108);

  const cargos = r.movimientos.filter((m) => m.cargoTotal != null);
  const abonos = r.movimientos.filter((m) => m.abonoTotal != null);
  assert.equal(cargos.length, 84);
  assert.equal(abonos.length, 24);

  const sumaCargos = Math.round(cargos.reduce((a, m) => a + (m.cargoTotal ?? 0), 0) * 100) / 100;
  const sumaAbonos = Math.round(abonos.reduce((a, m) => a + (m.abonoTotal ?? 0), 0) * 100) / 100;
  assert.equal(sumaCargos, 815215.42);
  assert.equal(sumaAbonos, 839324.55);

  // El primer movimiento (más reciente) debe cuadrar con "Saldo disponible"
  // declarado en la página 1.
  assert.equal(r.movimientos[0].saldo, 39950.44);
  assert.equal(r.movimientos[0].fechaPago, "2026-08-20");
});

test('en el formato "Detalle de movimientos", la línea de concepto (antes de la fecha) y la de detalle/RFC (después) se concatenan en el orden visual correcto, sin mezclarse con el movimiento vecino', () => {
  const r = parsearPaginasBBVA(POSICIONES_REAL_BBVA_WEB_ACEROS_AGOSTO_2026);
  const primero = r.movimientos[0];
  assert.equal(primero.nombreRazonSocial, "PAGO CUENTA DE TERCERO/ 0094186039 RFC:CPM920930LL6 IVA:2173.75");
});

test('en el formato "Detalle de movimientos", un movimiento con descripción corta que cabe completa en la fila de la fecha (ej. una comisión) no le roba la fila de detalle a su vecino ni al revés', () => {
  const r = parsearPaginasBBVA(POSICIONES_REAL_BBVA_WEB_ACEROS_AGOSTO_2026);
  const conDetalleAjeno = r.movimientos.find((m) => m.nombreRazonSocial === "SPEI RECIBIDOBANORTE/0101484432 072 0060826PAGO ERGODINOVA");
  assert.ok(conDetalleAjeno, "el movimiento SPEI debe conservar su propio detalle, no perderlo al vecino compacto");
  const compacto = r.movimientos.find((m) => m.nombreRazonSocial === "IVA COM SERV BCA INTERNET/IVA COM SERV BC");
  assert.ok(compacto, "el movimiento compacto no debe traer texto prestado del vecino");
});

test('en el formato "Detalle de movimientos", el aviso legal de pie de página no se cuela en la descripción del último movimiento', () => {
  const r = parsearPaginasBBVA(POSICIONES_REAL_BBVA_WEB_ACEROS_AGOSTO_2026);
  const ultimo = r.movimientos[r.movimientos.length - 1];
  assert.equal(ultimo.nombreRazonSocial, "SPEI RECIBIDOSTP/0171440815 646 0375372");
  assert.doesNotMatch(ultimo.nombreRazonSocial ?? "", /En cumplimiento|Cerrar|Imprimir/);
});

test('en el formato "Detalle de movimientos", si "Saldo disponible" no coincide con el movimiento más reciente pero la cadena de saldos de TODOS los movimientos sí encadena perfecto, no bloquea el documento -- inserta todo y agrega una advertencia de fila 0 (caso real: nómina el mismo día, Aceros cuenta 5859, 31-ago-2026)', () => {
  const r = parsearPaginasBBVA(PAGINAS_REALES_BBVA_WEB_ACEROS_31_AGOSTO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.movimientos.length, 152);

  // El movimiento más reciente (nómina) SÍ se inserta con su saldo real,
  // aunque no coincida con "Saldo disponible" del encabezado.
  assert.equal(r.movimientos[0].saldo, 14775.0);
  assert.equal(r.movimientos[0].nombreRazonSocial, "PAGO DE NOMINA/IN 4205095328 ACEROS Y ENVASADOS DE PUEBLA SA DE CV");

  const advertenciaDocumento = r.erroresPorFila.find((e) => e.fila === 0);
  assert.ok(advertenciaDocumento, "debe traer una advertencia de fila 0 (documento completo)");
  assert.match(advertenciaDocumento!.errores[0], /Saldo disponible de 23845\.14.*saldo 14775/);
});

test('parsea el TERCER formato de BBVA -- "app/personal" (Mario Contreras, cuenta 2047, agosto 2026): 20 movimientos con montos partidos en 3 items (signo + entero + centavos superíndice), Abono antes que Cargo en el encabezado, fecha con año en letras', () => {
  const r = parsearPaginasBBVA(PAGINAS_REALES_BBVA_APP_MARIO_AGOSTO_2026);
  assert.equal(r.errorDocumento, null);
  assert.equal(r.erroresPorFila.length, 0);
  assert.equal(r.movimientos.length, 20);

  const cargos = r.movimientos.filter((m) => m.cargoTotal != null);
  const abonos = r.movimientos.filter((m) => m.abonoTotal != null);
  assert.equal(cargos.length, 15);
  assert.equal(abonos.length, 5);

  // El más reciente (primero de la lista) debe cuadrar con "Saldo
  // disponible" del encabezado ($638,014.09) sin ninguna advertencia.
  assert.equal(r.movimientos[0].fechaPago, "2026-08-31");
  assert.equal(r.movimientos[0].saldo, 638014.09);
  assert.equal(r.movimientos[0].cargoTotal, 59448.28);
  assert.equal(r.movimientos[0].nombreRazonSocial, "PAGO CUENTA DE TERCERO / 0092620024 RFC:AEL131013CS1 IVA:8199.76");

  // Un movimiento de abono real (signo "$" sin "-"), para confirmar que la
  // clasificación por signo también funciona del lado positivo.
  const abono = r.movimientos.find((m) => m.fechaPago === "2026-08-24" && m.abonoTotal === 17000);
  assert.ok(abono, "debe existir el abono de Santander del 24-ago");
  assert.equal(abono!.saldo, 782382.2);

  const ultimo = r.movimientos[r.movimientos.length - 1];
  assert.equal(ultimo.fechaPago, "2026-08-17");
  assert.doesNotMatch(ultimo.nombreRazonSocial ?? "", /En cumplimiento|Cerrar|Imprimir/);
});
