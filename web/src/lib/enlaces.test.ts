import { test } from "node:test";
import assert from "node:assert/strict";
import { ligasDe, partirEnlaces } from "./enlaces.ts";

test("texto sin ligas queda igual", () => {
  assert.deepEqual(partirEnlaces("revisar planos"), [{ tipo: "texto", texto: "revisar planos" }]);
  assert.deepEqual(partirEnlaces(""), []);
  assert.deepEqual(partirEnlaces(null), []);
});

test("encuentra la liga en medio del texto", () => {
  const p = partirEnlaces("Ver https://drive.google.com/file/d/abc/view?usp=sharing y avisar");
  assert.equal(p.length, 3);
  assert.deepEqual(p[1], { tipo: "liga", texto: "https://drive.google.com/file/d/abc/view?usp=sharing", url: "https://drive.google.com/file/d/abc/view?usp=sharing" });
  assert.equal(p[2].texto, " y avisar");
});

test("puntuación final y paréntesis no son parte de la liga", () => {
  assert.deepEqual(ligasDe("aquí: https://maps.app.goo.gl/xyz."), ["https://maps.app.goo.gl/xyz"]);
  assert.deepEqual(ligasDe("(ver https://ejemplo.mx/a)"), ["https://ejemplo.mx/a"]);
  assert.deepEqual(ligasDe("https://es.wikipedia.org/wiki/Acero_(material)"), ["https://es.wikipedia.org/wiki/Acero_(material)"]);
});

test("www. se abre con https y varias ligas", () => {
  assert.deepEqual(ligasDe("www.grupoloma.mx, http://a.com/x"), ["https://www.grupoloma.mx", "http://a.com/x"]);
});

test("no convierte esquemas peligrosos", () => {
  assert.deepEqual(ligasDe("javascript:alert(1) data:text/html,hola"), []);
});

test("el texto reconstruido es el mismo", () => {
  const t = "1) https://a.mx/b?c=d, 2) www.x.com.";
  assert.equal(partirEnlaces(t).map((p) => p.texto).join(""), t);
});
