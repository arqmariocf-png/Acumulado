import { test } from "node:test";
import assert from "node:assert/strict";
import { aCsv, argDropbox, archivoRespaldable, hoyMexico, leemeMarkdown, nombresCsv, rutaDropbox } from "../../respaldo-dropbox/respaldo.ts";

test("CSV con comillas, saltos, nulos y objetos", () => {
  const [csv] = aCsv(["id", "nombre", "monto", "datos"], [
    { id: 1, nombre: 'Aceros "del Centro", SA', monto: 12.5, datos: { a: 1 } },
    { id: 2, nombre: "línea\nnueva", monto: null },
  ]);
  assert.equal(csv, '\ufeffid,nombre,monto,datos\r\n1,"Aceros ""del Centro"", SA",12.5,"{""a"":1}"\r\n2,"línea\nnueva",,\r\n');
  assert.equal(aCsv(["id"], []).length, 1);
  assert.equal(aCsv(["id"], [])[0], "\ufeffid\r\n");
});

test("CSV grande se parte y cada parte lleva encabezado", () => {
  const filas = Array.from({ length: 10 }, (_, i) => ({ id: i, t: "x".repeat(20) }));
  const partes = aCsv(["id", "t"], filas, 100);
  assert.ok(partes.length > 1);
  assert.ok(partes.every((p) => p.startsWith("\ufeffid,t\r\n")));
  assert.equal(partes.map((p) => p.split("\r\n").length - 2).reduce((a, b) => a + b, 0), 10);
  assert.deepEqual(nombresCsv("cfdi", 3), ["cfdi.csv", "cfdi (parte 2).csv", "cfdi (parte 3).csv"]);
});

test("header de Dropbox en ASCII y rutas", () => {
  assert.equal(argDropbox({ path: "/Acumulado · Claude/Año" }), '{"path":"/Acumulado \\u00b7 Claude/A\\u00f1o"}');
  assert.equal(rutaDropbox("/Respaldo Acumulado/", "Tablas", "cfdi.csv"), "/Respaldo Acumulado/Tablas/cfdi.csv");
  assert.equal(rutaDropbox("Respaldo", "Archivos/estados-cuenta//a.pdf"), "/Respaldo/Archivos/estados-cuenta/a.pdf");
});

test("por ahora solo van los planos", () => {
  assert.equal(archivoRespaldable("planos/p1/1792-plano.pdf"), true);
  assert.equal(archivoRespaldable("planos/p1/llave.key"), false);
  assert.equal(archivoRespaldable("estados-cuenta/aep/sep.pdf"), false);
  assert.equal(archivoRespaldable("sat/abc/descargas/recibido/X_01.zip"), false);
  assert.equal(archivoRespaldable("rh/p1/ine.pdf"), false);
  assert.equal(archivoRespaldable("checador/u1/foto.jpg"), false);
});

test("día en hora de México e índice", () => {
  assert.equal(hoyMexico(new Date("2026-10-21T05:30:00Z")), "2026-10-20");
  const md = leemeMarkdown(
    [{ tabla: "cfdi", renglones: 7518, columnas: ["id", "folio"], descripcion: "Facturas | SAT", archivos: ["Tablas/cfdi.csv"] }],
    { total: 10, copiados: 4 },
    new Date("2026-10-21T08:00:00Z"),
  );
  assert.match(md, /\| cfdi \| 7,518 \| Tablas\/cfdi\.csv \| Facturas \/ SAT \|/);
  assert.match(md, /4 de 10 copiados/);
  assert.match(md, /\*\*cfdi\*\*: id, folio/);
});
