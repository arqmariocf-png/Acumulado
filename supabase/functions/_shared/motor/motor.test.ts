// Pruebas del motor de conciliación. Los casos están inspirados en datos
// reales observados en Acumulado_Bancos_2026.xlsx (hoja DB_Julio): etiquetas
// N/A- exactas, formato de FACTURA "F- {folio}", y el texto de las
// excepciones de proveedor con crédito (CEMEX / Bodega Cruz Azul del Centro).
import { test } from "node:test";
import assert from "node:assert/strict";
import { clasificarMovimiento, clasificarLote } from "./motor.ts";
import { normalizarTexto, contieneTexto } from "./normalizar.ts";
import type { ContextoConciliacion, MovimientoEntrada } from "./types.ts";

const EMPRESA_AEP = "empresa-aep";
const EMPRESA_ERG = "empresa-erg";

function contextoVacio(): ContextoConciliacion {
  return { ordenesCompra: [], ordenesVenta: [], cfdi: [], reglas: [], excepciones: [] };
}

function reglasBase(): ContextoConciliacion["reglas"] {
  return [
    { palabraClave: "TRASPASO", etiqueta: "N/A - TRASPASO ENTRE CUENTAS PROPIAS", orden: 10 },
    { palabraClave: "COMISION", etiqueta: "N/A - COMISION BANCARIA", orden: 20 },
    { palabraClave: "PRESTAMO", etiqueta: "N/A - PRESTAMO INTERCOMPAÑIA", orden: 30 },
    { palabraClave: "SYS", etiqueta: "N/A - NOMINA (SUELDOS Y SALARIOS)", orden: 40 },
    { palabraClave: "DEVOLUCION ERROR", etiqueta: "N/A - DEVOLUCION POR ERROR", orden: 50 },
    { palabraClave: "DEVOLUCION", etiqueta: "N/A - DEVOLUCION", orden: 70 },
    { palabraClave: "RECUPERACION CREDITO", etiqueta: "N/A - RECUPERACION CREDITO", orden: 120 },
  ];
}

function movBase(overrides: Partial<MovimientoEntrada>): MovimientoEntrada {
  return {
    idLote: "m1",
    cuentaId: "cuenta-1",
    empresaId: EMPRESA_AEP,
    fechaPago: "2026-07-15",
    fechaOrden: null,
    proyecto: null,
    nombreRazonSocial: null,
    cargoTotal: null,
    abonoTotal: null,
    referenciaTipo: null,
    referenciaNumero: null,
    factura: null,
    comentarios: null,
    ...overrides,
  };
}

test("normalizarTexto ignora acentos, coma y mayúsculas (variantes reales del Excel)", () => {
  assert.equal(
    normalizarTexto("Constructora, Supervision y Consultoria Loma"),
    normalizarTexto("Constructora Supervisión y Consultoría Loma"),
  );
});

test("contieneTexto matchea palabra clave sin importar acentos/mayúsculas", () => {
  assert.equal(contieneTexto("SPEI enviado - traspaso interno", "TRASPASO"), true);
  assert.equal(contieneTexto("pago a proveedor", "TRASPASO"), false);
});

test("4.3 — TRASPASO se clasifica automáticamente como resuelto sin buscar factura", () => {
  const contexto = { ...contextoVacio(), reglas: reglasBase() };
  const mov = movBase({ comentarios: "TRASPASO A CUENTA PROPIA 8617", cargoTotal: 20000 });
  const r = clasificarMovimiento(mov, contexto);
  assert.equal(r.factura, "N/A - TRASPASO ENTRE CUENTAS PROPIAS");
  assert.equal(r.estadoClasificacion, "resuelto");
});

test("4.3 — DEVOLUCION ERROR se distingue de DEVOLUCION genérica por prioridad de orden", () => {
  const contexto = { ...contextoVacio(), reglas: reglasBase() };
  const r1 = clasificarMovimiento(movBase({ comentarios: "DEVOLUCION ERROR EN DEPOSITO", abonoTotal: 500 }), contexto);
  assert.equal(r1.factura, "N/A - DEVOLUCION POR ERROR");

  const r2 = clasificarMovimiento(movBase({ comentarios: "DEVOLUCION DE ANTICIPO", abonoTotal: 500 }), contexto);
  assert.equal(r2.factura, "N/A - DEVOLUCION");
});

test("4.3 — TRASPASO también se detecta en nombreRazonSocial (así llega desde los parsers de PDF, que nunca llenan comentarios)", () => {
  const contexto = { ...contextoVacio(), reglas: reglasBase() };
  const mov = movBase({ nombreRazonSocial: "TRASPASO CUENTAS PROPIAS", cargoTotal: 20000 });
  const r = clasificarMovimiento(mov, contexto);
  assert.equal(r.factura, "N/A - TRASPASO ENTRE CUENTAS PROPIAS");
  assert.equal(r.estadoClasificacion, "resuelto");
});

test("4.1 — cruce de OC completa Proyecto y Nombre cuando el movimiento no los trae", () => {
  const contexto: ContextoConciliacion = {
    ...contextoVacio(),
    ordenesCompra: [
      { idOrden: "39466", tipo: "OC", empresaId: EMPRESA_AEP, proyecto: "4590213789 Aperiodicos cubiertas 2025", proveedor: "Ferretería en Mayoreo", periodo: "202607" },
    ],
  };
  const mov = movBase({ referenciaTipo: "OC", referenciaNumero: "39466", cargoTotal: 5233.33 });
  const r = clasificarMovimiento(mov, contexto);
  assert.equal(r.proyecto, "4590213789 Aperiodicos cubiertas 2025");
  assert.equal(r.nombreRazonSocial, "Ferretería en Mayoreo");
});

test("4.2 — un único candidato CFDI resuelve la FACTURA con formato F- {folio}", () => {
  const contexto: ContextoConciliacion = {
    ...contextoVacio(),
    ordenesCompra: [{ idOrden: "39474", tipo: "OC", empresaId: EMPRESA_ERG, proyecto: "Cuarto Eléctrico", proveedor: "CEMEX", periodo: "202607" }],
    cfdi: [{ id: "c1", tipo: "recibido", empresaId: EMPRESA_ERG, folio: "718070001078832026", total: 17869.8, periodo: "202607" }],
  };
  const mov = movBase({ empresaId: EMPRESA_ERG, referenciaTipo: "OC", referenciaNumero: "39474", cargoTotal: 17869.8 });
  const r = clasificarMovimiento(mov, contexto);
  assert.equal(r.factura, "F- 718070001078832026");
  assert.equal(r.estadoClasificacion, "resuelto");
});

test("4.2 — dos candidatos CFDI con el mismo monto quedan ambiguos, no se autoasignan", () => {
  const contexto: ContextoConciliacion = {
    ...contextoVacio(),
    cfdi: [
      { id: "c1", tipo: "recibido", empresaId: EMPRESA_AEP, folio: "A1", total: 1000, periodo: "202607" },
      { id: "c2", tipo: "recibido", empresaId: EMPRESA_AEP, folio: "A2", total: 1000, periodo: "202607" },
    ],
  };
  const mov = movBase({ cargoTotal: 1000, nombreRazonSocial: "Proveedor X" });
  const r = clasificarMovimiento(mov, contexto);
  assert.equal(r.factura, null);
  assert.equal(r.estadoClasificacion, "ambiguo");
  assert.match(r.observaciones.join(" | "), /2 candidatos/);
});

test("4.2 — cargo busca en CFDI recibidos, abono busca en CFDI emitidos", () => {
  const contexto: ContextoConciliacion = {
    ...contextoVacio(),
    cfdi: [
      { id: "c1", tipo: "recibido", empresaId: EMPRESA_AEP, folio: "REC-1", total: 500, periodo: "202607" },
      { id: "c2", tipo: "emitido", empresaId: EMPRESA_AEP, folio: "EMI-1", total: 500, periodo: "202607" },
    ],
  };
  const rCargo = clasificarMovimiento(movBase({ cargoTotal: 500 }), contexto);
  assert.equal(rCargo.factura, "F- REC-1");

  const rAbono = clasificarMovimiento(movBase({ abonoTotal: 500 }), contexto);
  assert.equal(rAbono.factura, "F- EMI-1");
});

test("4.4 — proveedor con crédito (CEMEX) sin CFDI aún: pendiente_esperado, no revisión", () => {
  const contexto: ContextoConciliacion = {
    ...contextoVacio(),
    excepciones: [
      { proveedor: "CEMEX", descripcionRegla: "Complemento de pago dentro del mes o hasta 5 días después del corte", hastaMesSiguiente: false, diasTolerancia: 5 },
    ],
  };
  const mov = movBase({ nombreRazonSocial: "CEMEX", cargoTotal: 17869.8 });
  const r = clasificarMovimiento(mov, contexto);
  assert.equal(r.factura, null);
  assert.equal(r.estadoClasificacion, "pendiente_esperado");
  assert.match(r.observaciones.join(" | "), /Proveedor con crédito/);
});

test("4.5 — OC no está en catálogo pero Fecha OC/OS/OV es de un mes anterior: pendiente_esperado", () => {
  const contexto = contextoVacio();
  const mov = movBase({
    referenciaTipo: "OC",
    referenciaNumero: "38790",
    fechaOrden: "2026-06-20",
    fechaPago: "2026-07-06",
    cargoTotal: 74119.44,
  });
  const r = clasificarMovimiento(mov, contexto);
  assert.equal(r.estadoClasificacion, "pendiente_esperado");
  assert.match(r.observaciones.join(" | "), /mes anterior/);
});

test("4.5 + 4.4 combinadas — un movimiento puede llevar dos observaciones a la vez", () => {
  const contexto: ContextoConciliacion = {
    ...contextoVacio(),
    ordenesCompra: [{ idOrden: "38790", tipo: "OC", empresaId: EMPRESA_AEP, proyecto: "Corporativo Aceros", proveedor: "Bodega Cruz Azul del Centro", periodo: "202606" }],
    excepciones: [
      { proveedor: "Bodega Cruz Azul del Centro", descripcionRegla: "Complemento de pago dentro del mes o hasta 5 días después del corte", hastaMesSiguiente: false, diasTolerancia: 5 },
    ],
  };
  const mov = movBase({ referenciaTipo: "OC", referenciaNumero: "38790", fechaPago: "2026-07-06", cargoTotal: 74119.44 });
  const r = clasificarMovimiento(mov, contexto);
  assert.equal(r.estadoClasificacion, "pendiente_esperado");
  assert.equal(r.observaciones.length, 2);
  assert.match(r.observaciones[0], /mes anterior/);
  assert.match(r.observaciones[1], /Proveedor con crédito/);
});

test("sin ninguna regla aplicable: pendiente_revision (rojo), no se inventa una excepción", () => {
  const contexto = contextoVacio();
  const mov = movBase({ cargoTotal: 4321, nombreRazonSocial: "Proveedor Sin Historial" });
  const r = clasificarMovimiento(mov, contexto);
  assert.equal(r.estadoClasificacion, "pendiente_revision");
  assert.equal(r.factura, null);
});

test("FACTURA capturada manualmente se respeta tal cual", () => {
  const contexto = contextoVacio();
  const mov = movBase({ factura: "F- CAPTURADA-A-MANO", cargoTotal: 100, proyecto: "X", nombreRazonSocial: "Y" });
  const r = clasificarMovimiento(mov, contexto);
  assert.equal(r.factura, "F- CAPTURADA-A-MANO");
  assert.equal(r.estadoClasificacion, "resuelto");
});

test("4.6 — dedupe: la segunda ocurrencia de la misma clave se marca duplicada, la primera no", () => {
  const contexto = contextoVacio();
  const movs: MovimientoEntrada[] = [
    movBase({ idLote: "a", referenciaNumero: "OC 100", cargoTotal: 500 }),
    movBase({ idLote: "b", referenciaNumero: "OC 100", cargoTotal: 500 }),
    movBase({ idLote: "c", referenciaNumero: "OC 999", cargoTotal: 500 }), // misma cuenta/fecha/monto, referencia distinta
  ];
  const resultados = clasificarLote(movs, contexto);
  assert.equal(resultados.get("a")!.posibleDuplicado, false);
  assert.equal(resultados.get("b")!.posibleDuplicado, true);
  assert.equal(resultados.get("c")!.posibleDuplicado, false);
});

test("4.6 — dedupe también compara contra movimientos ya existentes en la base", () => {
  const contexto: ContextoConciliacion = {
    ...contextoVacio(),
    movimientosExistentes: [{ cuentaId: "cuenta-1", fechaPago: "2026-07-15", monto: 500, referenciaNumero: "OC 100" }],
  };
  const movs: MovimientoEntrada[] = [movBase({ idLote: "a", referenciaNumero: "OC 100", cargoTotal: 500 })];
  const resultados = clasificarLote(movs, contexto);
  assert.equal(resultados.get("a")!.posibleDuplicado, true);
});

test("movimiento sin cargo ni abono no participa en dedupe (constraint de BD ya lo impediría)", () => {
  const contexto = contextoVacio();
  const movs: MovimientoEntrada[] = [movBase({ idLote: "a" }), movBase({ idLote: "b" })];
  const resultados = clasificarLote(movs, contexto);
  assert.equal(resultados.get("a")!.posibleDuplicado, false);
  assert.equal(resultados.get("b")!.posibleDuplicado, false);
});
