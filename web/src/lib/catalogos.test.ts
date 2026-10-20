import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicado, filtrarPorTexto, mensajeBorrado, revisarCliente, revisarEmpresa, rfcValido, type FormCliente, type FormEmpresa } from "./catalogos.ts";

const empresa: FormEmpresa = {
  nombre: "Clavicón",
  codigo: "mcc",
  rfc: "",
  razon_social: "",
  domicilio_fiscal: "",
  telefono: "",
  correo: "",
  banco: "",
  cuenta_bancaria: "",
  clabe: "",
  sucursal_bancaria: "",
};
const cliente: FormCliente = {
  empresa_id: "e1",
  razon_social: "Ramsicon SA de CV",
  nombre_comercial: "",
  rfc: "",
  regimen_fiscal: "",
  codigo_postal: "",
  domicilio: "",
  email: "",
  telefono: "",
  notas: "",
};

test("RFC de persona moral y física", () => {
  assert.equal(rfcValido("EBP2208174A0"), true);
  assert.equal(rfcValido("gomj800101ab1"), true);
  assert.equal(rfcValido("ÑEX010101AB1"), true);
  assert.equal(rfcValido("EBP22081"), false);
  assert.equal(rfcValido("EBP2208174A0X1"), false);
});

test("revisarEmpresa: mínimos, código, RFC, correo y CLABE", () => {
  assert.equal(revisarEmpresa(empresa), null);
  assert.match(revisarEmpresa({ ...empresa, nombre: " " }) ?? "", /nombre/);
  assert.match(revisarEmpresa({ ...empresa, codigo: "M" }) ?? "", /código/);
  assert.match(revisarEmpresa({ ...empresa, codigo: "MC-C" }) ?? "", /código/);
  assert.match(revisarEmpresa({ ...empresa, rfc: "XYZ" }) ?? "", /RFC/);
  assert.match(revisarEmpresa({ ...empresa, correo: "sin-arroba" }) ?? "", /correo/);
  assert.equal(revisarEmpresa({ ...empresa, clabe: "012650001127363818" }), null);
  assert.match(revisarEmpresa({ ...empresa, clabe: "012650001127363819" }) ?? "", /CLABE/);
  assert.match(revisarEmpresa({ ...empresa, cuenta_bancaria: "12a" }) ?? "", /cuenta/);
});

test("revisarCliente: empresa, razón social, RFC, C.P. y correo", () => {
  assert.equal(revisarCliente(cliente), null);
  assert.match(revisarCliente({ ...cliente, empresa_id: "" }) ?? "", /empresa/);
  assert.match(revisarCliente({ ...cliente, razon_social: "AB" }) ?? "", /razón social/);
  assert.match(revisarCliente({ ...cliente, rfc: "123" }) ?? "", /RFC/);
  assert.match(revisarCliente({ ...cliente, codigo_postal: "7276" }) ?? "", /postal/);
  assert.match(revisarCliente({ ...cliente, email: "a@b" }) ?? "", /correo/);
});

test("duplicado por RFC o por nombre sin acentos, sin contarse a sí mismo", () => {
  const lista = [
    { id: "1", nombre: "Ramsicón SA de CV", rfc: "RAM010101AB1" },
    { id: "2", nombre: "Otra", rfc: null },
  ];
  assert.equal(duplicado(lista, "RAMSICON SA DE CV", "")?.id, "1");
  assert.equal(duplicado(lista, "Nueva", "ram010101ab1")?.id, "1");
  assert.equal(duplicado(lista, "Ramsicón SA de CV", "", "1"), null);
  assert.equal(duplicado(lista, "Nueva", ""), null);
});

test("filtrarPorTexto por palabras en cualquier orden", () => {
  const lista = [
    { a: "Aceros y Envasados", b: "AEN010101AB1" },
    { a: "Cemex", b: null },
  ];
  assert.equal(filtrarPorTexto(lista, "envasados aceros", (x) => [x.a, x.b]).length, 1);
  assert.equal(filtrarPorTexto(lista, "aen0101", (x) => [x.a, x.b]).length, 1);
  assert.equal(filtrarPorTexto(lista, "", (x) => [x.a, x.b]).length, 2);
});

test("mensajeBorrado explica que se desactive si ya se usa", () => {
  assert.match(mensajeBorrado({ code: "23503", message: "x" }, "el cliente"), /Desactívalo/);
  assert.equal(mensajeBorrado({ message: "otro" }, "el cliente"), "otro");
});
