import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, filasAObjetos } from "./csv.ts";
import {
  construirIndiceCampos,
  encabezadosFaltantes,
  mapearFilaEstadoCuenta,
  normalizarEncabezadoEstadoCuenta,
} from "./estado-cuenta.ts";

const ENCABEZADO =
  "Tipo de Movimiento,Cuenta,Folio,Fecha de Pago,Año,Mes,Empresa,Proyecto,Nombre o Razón Social,Cargo Total,Abono Total,Saldo,OC / OS / OV / OF,Fecha OC/OS/OV,FACTURA,Comentarios,Observación";

function procesarCsv(contenido: string) {
  const filas = parseCsv(contenido);
  const objetos = filasAObjetos(filas, normalizarEncabezadoEstadoCuenta);
  const indice = construirIndiceCampos(Object.keys(objetos[0] ?? {}));
  return objetos.map((obj, i) => mapearFilaEstadoCuenta(obj, indice, i + 1));
}

test("parseCsv preserva celdas vacías en su posición (no recorre columnas)", () => {
  const csv = 'a,b,c\n1,,3\n';
  const filas = parseCsv(csv);
  assert.deepEqual(filas, [
    ["a", "b", "c"],
    ["1", "", "3"],
  ]);
});

test("parseCsv soporta campos entrecomillados con comas internas", () => {
  const csv = 'a,b\n"Constructora, Supervisión y Consultoría LOMA",5\n';
  const filas = parseCsv(csv);
  assert.equal(filas[1][0], "Constructora, Supervisión y Consultoría LOMA");
});

test("un movimiento con Proyecto vacío (traspaso interno) no desplaza las columnas siguientes", () => {
  // Proyecto vacío entre Empresa y Nombre — la columna Cargo debe seguir
  // leyéndose como Cargo, no como si fuera el valor de Proyecto.
  const csv = `${ENCABEZADO}\nBancos,1015,,7/1/26,2026,Julio,Viguetas Balken,,Banco del Bajio,500.00,,8306.09,,,,COMISION,N/A - COMISION BANCARIA`;
  const [resultado] = procesarCsv(csv);
  assert.deepEqual(resultado.errores, []);
  assert.equal(resultado.movimiento!.proyecto, null);
  assert.equal(resultado.movimiento!.cargoTotal, 500);
  assert.equal(resultado.movimiento!.saldo, 8306.09);
});

test("fila con Cargo y Abono simultáneos se rechaza con error explícito", () => {
  const csv = `${ENCABEZADO}\nBancos,1015,,7/1/26,2026,Julio,Empresa,P,N,100,200,300,,,,,`;
  const [resultado] = procesarCsv(csv);
  assert.equal(resultado.movimiento, null);
  assert.match(resultado.errores.join(" | "), /Cargo Total y Abono Total a la vez/);
});

test("fila sin Cargo ni Abono se rechaza con error explícito", () => {
  const csv = `${ENCABEZADO}\nBancos,1015,,7/1/26,2026,Julio,Empresa,P,N,,,300,,,,,`;
  const [resultado] = procesarCsv(csv);
  assert.equal(resultado.movimiento, null);
  assert.match(resultado.errores.join(" | "), /no trae Cargo Total ni Abono Total/);
});

test("referencia 'OC 39466' se separa en tipo=OC y numero=39466", () => {
  const csv = `${ENCABEZADO}\nBancos,1226,1,7/3/26,2026,Julio,Aceros,Proyecto,Nombre,5233.33,,120291.61,OC 39466,7/3/26,F- A 87624,,`;
  const [resultado] = procesarCsv(csv);
  assert.equal(resultado.movimiento!.referenciaTipo, "OC");
  assert.equal(resultado.movimiento!.referenciaNumero, "39466");
  assert.equal(resultado.movimiento!.fechaOrden, "2026-07-03");
});

test("fechas M/D/AA de dos dígitos de año se interpretan como 20AA", () => {
  const csv = `${ENCABEZADO}\nBancos,1226,,8/7/26,2026,Agosto,Aceros,,,,100,999,,,,,`;
  const [resultado] = procesarCsv(csv);
  assert.equal(resultado.movimiento!.fechaPago, "2026-08-07");
});

test("encabezadosFaltantes detecta cuando falta una columna requerida (ej. sin Saldo)", () => {
  const encabezadoSinSaldo = "Cuenta,Fecha de Pago,Cargo Total";
  const objetos = filasAObjetos(parseCsv(encabezadoSinSaldo + "\n1015,7/1/26,100"), normalizarEncabezadoEstadoCuenta);
  const indice = construirIndiceCampos(Object.keys(objetos[0]));
  assert.deepEqual(encabezadosFaltantes(indice), ["saldo"]);
});

test("reconoce encabezado alterno 'OC OS OV OF' sin las diagonales", () => {
  const encabezadoAlterno = ENCABEZADO.replace("OC / OS / OV / OF", "OC OS OV OF");
  const csv = `${encabezadoAlterno}\nBancos,1226,,7/3/26,2026,Julio,Aceros,,,5233.33,,120291.61,OC 39466,,,,`;
  const [resultado] = procesarCsv(csv);
  assert.equal(resultado.movimiento!.referenciaTipo, "OC");
});
