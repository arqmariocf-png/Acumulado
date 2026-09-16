import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectColumns,
  extractRecords,
  guessFieldRoles,
  normalizeBatch,
  parseAmountCents,
  recordKey,
  stableHash,
  sumAmountCents,
} from "./nomina-externa.ts";

// ============================================================
// Sacar los renglones sin conocer la envoltura
// ============================================================

test("un arreglo directo son los renglones", () => {
  assert.deepEqual(extractRecords([{ a: 1 }, { a: 2 }]), [{ a: 1 }, { a: 2 }]);
});

test("reconoce las envolturas comunes de APIs de reportes", () => {
  for (const key of ["data", "rows", "result", "results", "records", "registros", "items", "datos", "d"]) {
    assert.deepEqual(extractRecords({ [key]: [{ a: 1 }] }), [{ a: 1 }], `falló con { ${key}: [...] }`);
  }
});

test("reconoce una envoltura con nombre propio (ej. qry_MO de Grupo Loma)", () => {
  assert.deepEqual(extractRecords({ status: "ok", qry_MO: [{ a: 1 }] }), [{ a: 1 }]);
});

test("la envoltura conocida gana sobre otra llave con arreglo", () => {
  const payload = { errores: [{ x: 1 }], data: [{ a: 1 }] };
  assert.deepEqual(extractRecords(payload), [{ a: 1 }]);
});

test("un objeto suelto cuenta como un solo renglón", () => {
  assert.deepEqual(extractRecords({ empleado: "Ana", total: 100 }), [{ empleado: "Ana", total: 100 }]);
});

test("respuestas vacías o no-objeto no truenan", () => {
  assert.deepEqual(extractRecords(null), []);
  assert.deepEqual(extractRecords(undefined), []);
  assert.deepEqual(extractRecords([]), []);
  assert.deepEqual(extractRecords("texto"), []);
  assert.deepEqual(extractRecords(42), []);
});

test("se ignoran los elementos que no son objetos dentro del arreglo", () => {
  assert.deepEqual(extractRecords([{ a: 1 }, null, "x", [1], { b: 2 }]), [{ a: 1 }, { b: 2 }]);
});

// ============================================================
// Columnas y propuesta de mapeo
// ============================================================

test("collectColumns une las columnas de todos los renglones sin repetir", () => {
  assert.deepEqual(collectColumns([{ a: 1, b: 2 }, { b: 3, c: 4 }]), ["a", "b", "c"]);
});

test("propone nombre, importe, periodo y centro de costos por el nombre de la columna", () => {
  const guess = guessFieldRoles(["ID_NOMINA", "Nombre_Empleado", "Periodo", "Neto_a_Pagar", "Centro_Costos"]);
  assert.equal(guess.idField, "ID_NOMINA");
  assert.equal(guess.employeeField, "Nombre_Empleado");
  assert.equal(guess.amountField, "Neto_a_Pagar");
  assert.equal(guess.periodField, "Periodo");
  assert.equal(guess.costCenterField, "Centro_Costos");
});

test("la propuesta aguanta acentos, espacios y mayúsculas", () => {
  const guess = guessFieldRoles(["Núm. Empleado", "NOMBRE COMPLETO", "Importe Total", "Obra"]);
  assert.equal(guess.idField, "Núm. Empleado");
  assert.equal(guess.employeeField, "NOMBRE COMPLETO");
  assert.equal(guess.amountField, "Importe Total");
  assert.equal(guess.costCenterField, "Obra");
});

test("una columna que no se parece a nada queda sin proponer, no adivina de más", () => {
  const guess = guessFieldRoles(["xyz", "abc"]);
  assert.equal(guess.employeeField, null);
  assert.equal(guess.amountField, null);
  assert.equal(guess.idField, null);
});

test("prefiere la coincidencia exacta sobre la parcial", () => {
  // "total" exacto gana aunque "subtotal_general" también contenga "total".
  const guess = guessFieldRoles(["subtotal_general", "total"]);
  assert.equal(guess.amountField, "total");
});

test("id exacto gana sobre id_empleado -- caso real de la nómina fija de Grupo Loma", () => {
  // Con id_empleado como llave, dos conceptos del mismo empleado en la
  // misma quincena se pisarían entre sí (ids reales 4537/4538, misma
  // persona).
  const guess = guessFieldRoles(["id", "id_empleado", "empleado", "pago"]);
  assert.equal(guess.idField, "id");
});

// ============================================================
// Importes
// ============================================================

test("parseAmountCents acepta números y textos con moneda y miles", () => {
  assert.equal(parseAmountCents(1234.56), 123456);
  assert.equal(parseAmountCents("1234.56"), 123456);
  assert.equal(parseAmountCents("$1,234.56"), 123456);
  assert.equal(parseAmountCents(" MXN 1,234.56 "), 123456);
  assert.equal(parseAmountCents("1234"), 123400);
});

test("con coma y punto manda el último como separador decimal", () => {
  assert.equal(parseAmountCents("1,234.56"), 123456); // formato mexicano
  assert.equal(parseAmountCents("1.234,56"), 123456); // formato europeo
});

test("con solo comas, dos decimales al final se leen como decimal", () => {
  assert.equal(parseAmountCents("12,50"), 1250);
  assert.equal(parseAmountCents("1,234"), 123400, "tres dígitos = separador de miles");
  assert.equal(parseAmountCents("1,234,567"), 123456700);
});

test("los negativos se respetan, con signo o entre paréntesis", () => {
  assert.equal(parseAmountCents("-500.25"), -50025);
  assert.equal(parseAmountCents("(500.25)"), -50025);
  assert.equal(parseAmountCents(-500.25), -50025);
});

test("lo que no es un importe da null, no cero -- para no inventar un pago", () => {
  assert.equal(parseAmountCents(null), null);
  assert.equal(parseAmountCents(undefined), null);
  assert.equal(parseAmountCents(""), null);
  assert.equal(parseAmountCents("   "), null);
  assert.equal(parseAmountCents("N/A"), null);
  assert.equal(parseAmountCents({}), null);
  assert.equal(parseAmountCents(Number.NaN), null);
});

test("el redondeo a centavos no arrastra el error binario de los flotantes", () => {
  assert.equal(parseAmountCents(0.1 + 0.2), 30);
  assert.equal(parseAmountCents("1234.565"), 123457);
});

test("sumAmountCents ignora los renglones sin importe legible", () => {
  const records = [{ t: "1,000.00" }, { t: "N/A" }, { t: 500 }, {}];
  assert.equal(sumAmountCents(records, "t"), 100000 + 50000);
  assert.equal(sumAmountCents(records, null), 0, "sin columna mapeada no suma nada");
});

// ============================================================
// Identidad de los renglones (para no duplicar al resincronizar)
// ============================================================

test("el hash no depende del orden de las llaves", () => {
  assert.equal(stableHash({ a: 1, b: 2 }), stableHash({ b: 2, a: 1 }));
});

test("el hash cambia si cambia un valor", () => {
  assert.notEqual(stableHash({ a: 1 }), stableHash({ a: 2 }));
});

test("recordKey usa la columna de id cuando existe", () => {
  assert.equal(recordKey({ folio: " 993 ", x: 1 }, "folio"), "993");
});

test("recordKey cae al hash si el id viene vacío o no hay columna", () => {
  assert.match(recordKey({ folio: "", x: 1 }, "folio"), /^h:/);
  assert.match(recordKey({ x: 1 }, null), /^h:/);
});

test("resincronizar la misma respuesta da exactamente las mismas llaves", () => {
  const payload = { data: [{ folio: 1, neto: "10.00" }, { folio: 2, neto: "20.00" }] };
  const primera = normalizeBatch(payload);
  const segunda = normalizeBatch(payload);
  assert.deepEqual(
    primera.records.map((r) => r.record_key),
    segunda.records.map((r) => r.record_key),
  );
});

test("dos renglones con el mismo id no se pisan entre sí", () => {
  const batch = normalizeBatch([
    { folio: 7, concepto: "sueldo", neto: "100.00" },
    { folio: 7, concepto: "horas extra", neto: "50.00" },
  ]);
  const keys = batch.records.map((r) => r.record_key);
  assert.equal(new Set(keys).size, 2);
  assert.equal(keys[0], "7");
  assert.match(keys[1], /^7#/);
});

test("mano de obra sin id único: la llave sale del hash, no de Id_mo_cat repetido", () => {
  // Caso real: 477 renglones de mano de obra traen solo 203 Id_mo_cat
  // distintos (es la referencia al catálogo, no el renglón) -- por eso el
  // mapeo sembrado para mano_obra usa campo_id = null.
  const batch = normalizeBatch(
    [
      { Id_mo_cat: 1718, Nombre: "David Rosas", Monto: 642.86 },
      { Id_mo_cat: 1718, Nombre: "Otra Persona", Monto: 100.0 },
    ],
    { idField: null },
  );
  const keys = batch.records.map((r) => r.record_key);
  assert.equal(new Set(keys).size, 2, "renglones distintos con el mismo Id_mo_cat no deben pisarse");
  assert.ok(keys.every((k) => k.startsWith("h:")));
});

// ============================================================
// Lote completo
// ============================================================

test("normalizeBatch descubre columnas, propone mapeo y suma el total", () => {
  const batch = normalizeBatch({
    data: [
      { ID: 1, Empleado: "Ana López", Periodo: "SEM-33", Importe: "2,500.00", Obra: "Torre A" },
      { ID: 2, Empleado: "Beto Ruiz", Periodo: "SEM-33", Importe: "3,100.50", Obra: "Torre A" },
    ],
  });

  assert.deepEqual(batch.columns, ["ID", "Empleado", "Periodo", "Importe", "Obra"]);
  assert.equal(batch.guess.employeeField, "Empleado");
  assert.equal(batch.guess.amountField, "Importe");
  assert.equal(batch.guess.costCenterField, "Obra");
  assert.equal(batch.totalCents, 250000 + 310050);
  assert.deepEqual(batch.records.map((r) => r.record_key), ["1", "2"]);
  assert.deepEqual(batch.records[0].data, { ID: 1, Empleado: "Ana López", Periodo: "SEM-33", Importe: "2,500.00", Obra: "Torre A" });
});

test("el mapeo corregido a mano gana sobre la heurística", () => {
  const batch = normalizeBatch([{ ID: 1, Total: "10.00", Percepciones: "99.00" }], { amountField: "Percepciones" });
  assert.equal(batch.guess.amountField, "Percepciones");
  assert.equal(batch.totalCents, 9900);
});

test("un override en undefined no borra la propuesta", () => {
  const batch = normalizeBatch([{ ID: 1, Total: "10.00" }], { amountField: undefined });
  assert.equal(batch.guess.amountField, "Total");
});

test('un override en null SÍ manda: significa "esta columna no existe"', () => {
  // Distinguir null de undefined importa: mano de obra de Grupo Loma no
  // tiene columna de id único, y su mapeo guarda campo_id = null para que
  // la llave salga del hash en vez de una columna que se repite.
  const batch = normalizeBatch([{ ID: 1, Total: "10.00" }], { idField: null });
  assert.equal(batch.guess.idField, null);
  assert.match(batch.records[0].record_key, /^h:/);
});

test("una respuesta vacía da un lote vacío, no un error", () => {
  const batch = normalizeBatch({ data: [] });
  assert.deepEqual(batch.records, []);
  assert.deepEqual(batch.columns, []);
  assert.equal(batch.totalCents, 0);
});

test("se conserva el renglón completo aunque no se sepa qué significa cada columna", () => {
  const raw = { campo_raro_1: "x", campo_raro_2: null, anidado: { a: 1 } };
  const batch = normalizeBatch([raw]);
  assert.deepEqual(batch.records[0].data, raw);
});
