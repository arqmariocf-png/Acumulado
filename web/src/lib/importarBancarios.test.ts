import { test } from "node:test";
import assert from "node:assert/strict";
import { clabeValida, filasDesdeTabla, separarCuentaYClabe, tablaDesdeCsv } from "./importarBancarios.ts";

test("dígito verificador de la CLABE (la de Felipe Coatl en el backoffice)", () => {
  assert.equal(clabeValida("042650016007795121"), true);
  assert.equal(clabeValida("042650016007795122"), false);
  assert.equal(clabeValida("12345"), false);
});

test("columna combinada como la muestra el backoffice", () => {
  assert.deepEqual(separarCuentaYClabe("CUENTA: 01600779512, CLABE: 042650016007795121"), { cuenta: "01600779512", clabe: "042650016007795121" });
});

test("encuentra encabezados aunque haya un título arriba y acentos", () => {
  const tabla = [
    ["Catálogo de proveedores", null, null],
    ["Proveedor", "RFC", "Banco", "Cuenta", "CLABE"],
    ["FELIPE COATL VICENS", "covf790501q96", "Banca Mifel", "01600779512", "042650016007795121"],
    ["SIN DATOS", "", "", "", ""],
  ];
  const r = filasDesdeTabla(tabla);
  assert.equal(r.faltaNombre, false);
  assert.equal(r.filas.length, 2);
  assert.equal(r.filas[0].rfc, "COVF790501Q96");
  assert.equal(r.filas[0].error, null);
  assert.equal(r.filas[1].error, "sin cuenta ni CLABE");
});

test("rechaza tarjeta y CLABE mal escrita", () => {
  const tabla = [
    ["Nombre", "Cuenta", "CLABE"],
    ["A", "4152 3131 2345 6789", ""],
    ["B", "", "042650016007795122"],
    ["C", "4152313123456789", "042650016007795121"],
  ];
  const [a, b, c] = filasDesdeTabla(tabla).filas;
  assert.equal(a.cuenta, null);
  assert.match(a.error ?? "", /tarjeta/);
  assert.equal(b.clabe, null);
  assert.match(b.error ?? "", /CLABE inválida/);
  assert.equal(c.cuenta, null);
  assert.equal(c.clabe, "042650016007795121");
  assert.equal(c.error, null);
});

test("sin columna de proveedor no importa nada", () => {
  assert.equal(filasDesdeTabla([["foo", "bar"]]).faltaNombre, true);
});

test("CSV con punto y coma y comillas", () => {
  assert.deepEqual(tablaDesdeCsv('Proveedor;CLABE\n"ACME, SA";042650016007795121\n'), [["Proveedor", "CLABE"], ["ACME, SA", "042650016007795121"]]);
});
