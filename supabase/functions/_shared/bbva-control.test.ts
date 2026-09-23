import { test } from "node:test";
import assert from "node:assert/strict";
import { esFormatoControl, parsearMantto, parsearObraMenor, pasoActual, registrosDesdeControl, resumirControl } from "./bbva-control.ts";

const ENC = ["ID interno", "Folio cliente", "CR", "Sucursal", "Solicitud / alcance", "Fecha recepción del folio (correo)", "Fecha primera atención (automática)", "Prioridad",
  "Fecha compromiso con el cliente", "Supervisor BBVA", "Equipo ejecutor", "Fecha programada de atención", "Ventana de acceso", "Estatus operativo", "Motivo de bloqueo",
  "Siguiente acción", "Responsable siguiente paso", "Fecha compromiso siguiente paso", "Fecha última actualización", "Alerta del siguiente paso", "Fecha finalización (automática)",
  "Fecha aceptación del cliente", "Generadores", "Reporte fotográfico", "Carátula", "Presupuesto", "Soportes completos", "Fecha envío de soportes", "Autorización", "Fecha autorización",
  "Acción / fichero", "Fecha realización del fichero", "Etapa de seguimiento", "Enlace a carpeta de evidencia", "Monto a cobrar", "N.º pedido", "N.º factura", "Observaciones / resolución",
  "Revisión automática del registro", "x", "x", "x", "x", "x", "x", "x", "x", "x", "x", "x", "x", "Fecha recepción del pedido", "Fecha recepción factura / pago", "Estado del pago (automático)",
  "Monto cobrado confirmado con IVA", "Revisión financiera (automática)", "Fecha origen (fichero)", "Monto solicitado a BBVA", "Pago aplicado al servicio", "Saldo por cobrar", "Porcentaje cobrado", "Días fichero a pago", "Revisión de cobranza", "Datos monetarios completos"];

function fila(over: Record<number, unknown>): unknown[] {
  const f: unknown[] = new Array(ENC.length).fill(null);
  for (const [i, v] of Object.entries(over)) f[Number(i)] = v;
  return f;
}
const pagado = fila({ 0: "MT-0003", 1: 43533645, 2: 3758, 3: "Oficina Principal", 4: "Plafón", 5: new Date(2026, 0, 5), 9: "Jessica", 10: "Equipo 1", 11: new Date(2026, 0, 9), 13: "Terminado",
  22: "✓ Entregado", 26: "Completo", 28: "Autorizado", 30: "Fichero realizado", 32: "Fichero realizado", 34: 2662.33, 35: 8542264591, 36: 5100040029, 51: new Date(2026, 0, 5), 52: new Date(2026, 2, 1), 53: "Pago realizado (factura recibida)", 57: 2662.33 });
const enEnvio = fila({ 0: "MT-0100", 1: 43600000, 3: "Atlixco", 5: new Date(2026, 7, 1), 9: "Dulce", 13: "Terminado", 26: "Completo", 28: "Sin autorizar", 32: "Confirmar envío", 34: 1000, 53: "Sin confirmación de pago" });
const cancelado = fila({ 0: "MT-0013", 1: 43537948, 3: "Plaza Chapultepec", 5: new Date(2026, 0, 8), 9: "Dulce", 10: "CANCELADO", 13: "CANCELADO", 32: "Cancelado", 53: "Cancelado" });
const abierto = fila({ 0: "MT-0200", 1: 43700000, 3: "Cholula", 5: new Date(2026, 8, 10), 9: "Ismael", 11: new Date(2026, 8, 12), 13: "En ejecución", 32: "Trabajo abierto", 34: 500 });
const hoja = [[null], ["Control de conservación"], ["Fechas"], ["1. IDENTIFICACIÓN"], ENC, pagado, enEnvio, cancelado, abierto, [null]];

test("detecta el formato nuevo y lee una fila por trabajo con fechas ISO y montos", () => {
  assert.equal(esFormatoControl(hoja), true);
  assert.equal(esFormatoControl([["N°", "FECHA", "FOLIO"]]), false);
  const f = parsearMantto(hoja);
  assert.equal(f.length, 4);
  assert.equal(f[0].id_interno, "MT-0003");
  assert.equal(f[0].folio, "43533645");
  assert.equal(f[0].fecha_recepcion, "2026-01-05");
  assert.equal(f[0].fecha_recepcion_factura, "2026-03-01");
  assert.equal(f[0].monto_a_cobrar, 2662.33);
  assert.equal(f[0].pedido, "8542264591");
});

test("paso actual: último paso cumplido en cadena", () => {
  const [p, e, c, a] = parsearMantto(hoja);
  assert.deepEqual(pasoActual(p).etiqueta, "Pago");
  assert.deepEqual(pasoActual(e).etiqueta, "Soportes"); // terminado + soportes completos, sin envío/autorización
  assert.equal(pasoActual(c).cancelado, true);
  assert.equal(pasoActual(a).etiqueta, "Programado"); // en ejecución, todavía no terminado
});

test("registros para el dashboard: excluye cancelados, pagado con fecha, Obra Menor como proceso aparte", () => {
  const om = parsearObraMenor([[null, "BBVA PUEBLA"], [null, "N°", "FECHA", "CR", "Supervisor", "SUCURSAL", "Codigo UDA", "ACCIÓN EJECUTADA", "Estatus folio", "P.U.", "Cantidad", "MONTO COBRADO", "Acción", "Estado"],
    [null, 1, new Date(2025, 11, 10), 520, null, "Puebla San Manuel", "A2512-184", "Certificación", "Certificación realizada", null, null, 2160.91, null, "Realizado"],
    [null, 2, new Date(2026, 2, 5), 5613, null, "Zacatlan", "A2603-1886", "Adecuaciones", "Aceptado", null, null, null, null, "Cancelado por BBVA"]]);
  assert.equal(om.length, 2);
  const r = registrosDesdeControl(parsearMantto(hoja), om);
  assert.equal(r.length, 4); // 3 mantenimiento no cancelados + 1 obra menor no cancelada
  const pag = r.find((x) => x.folio === "43533645")!;
  assert.equal(pag.fechaPago?.getMonth(), 2);
  assert.equal(r.find((x) => x.folio === "43600000")!.enRevision, true);
  assert.equal(r.filter((x) => x.proceso === "Obra Menor").length, 1);
});

test("resumen por etapa, paso y supervisor", () => {
  const res = resumirControl(parsearMantto(hoja), []);
  assert.equal(res.total, 4);
  assert.equal(res.cancelados, 1);
  assert.equal(res.por_etapa["Confirmar envío"], 1);
  assert.equal(res.por_paso["Pago"], 1);
  assert.equal(res.por_supervisor["Dulce"].total, 2);
  assert.equal(res.por_supervisor["Dulce"].cancelados, 1);
  assert.equal(res.sin_pago, 2);
});
