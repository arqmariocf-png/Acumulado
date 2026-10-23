import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agendaCobranza,
  antiguedadPorCliente,
  aplicarCobro,
  cobranzaEsperada,
  cuadreEntreEmpresas,
  docDesdeOv,
  estatusDocumento,
  filtrarOvPendientes,
  sumaOv,
  filtrarClientes,
  indicadores,
  lunesDe,
  rangoDe,
  revisarDocumento,
  textoGestion,
  totalesAntiguedad,
  type ClienteCxc,
  type DocumentoCxc,
  type GestionCxc,
  type OvPendiente,
} from "./cuentasPorCobrar.ts";

const HOY = "2026-10-22"; // jueves

function doc(p: Partial<DocumentoCxc> & { folio: string; total: number; fecha: string; vence: string }): DocumentoCxc {
  const cobrado = p.cobrado ?? 0;
  const retenido = p.retenido ?? 0;
  return {
    origen: "manual", id: p.folio, empresa_id: "csc", empresa: "CSC", cliente_clave: "SOP", cliente: "Secretaría de obra pública", rfc: "SOP",
    cliente_empresa_id: null, cliente_empresa: null, tipo: "estimacion", uuid: null, metodo_pago: null, proyecto_id: null, obra: "Escuela primaria", cfdi_id: null,
    ...p, cobrado, retenido, saldo: Math.max(p.total - cobrado - retenido, 0),
  };
}

const DOCS: DocumentoCxc[] = [
  doc({ folio: "Estimación 3", total: 2_100_000, cobrado: 1_995_000, retenido: 105_000, fecha: "2026-06-16", vence: "2026-07-16" }),
  doc({ folio: "Estimación 4", total: 1_980_000, retenido: 99_000, fecha: "2026-07-28", vence: "2026-08-27" }),
  doc({ folio: "Estimación 5", total: 2_350_000, retenido: 117_500, fecha: "2026-09-19", vence: "2026-10-19" }),
  doc({ folio: "F-100", cliente_clave: "AUTO", cliente: "Cliente automotriz", total: 500_000, fecha: "2026-10-10", vence: "2026-11-10" }),
  doc({ folio: "IA-OV-0007", cliente_clave: "CSC", cliente: "CSC Loma", cliente_empresa_id: "csc", cliente_empresa: "CSC", empresa: "AEP", empresa_id: "aep", total: 68_770, fecha: "2026-09-01", vence: "2026-10-01" }),
];

test("estatus, rangos y saldo exigible", () => {
  assert.deepEqual(estatusDocumento(DOCS[0], HOY), { clave: "cobrado", texto: "Cobrado", dias: 0 });
  assert.equal(DOCS[0].saldo, 0);
  assert.equal(estatusDocumento(DOCS[1], HOY).texto, "Vencido 56 días");
  assert.equal(estatusDocumento(DOCS[2], HOY).texto, "Vencido 3 días");
  assert.equal(DOCS[2].saldo, 2_232_500);
  assert.equal(estatusDocumento(DOCS[3], HOY).clave, "corriente");
  assert.equal(rangoDe(0), "corriente");
  assert.equal(rangoDe(30), "d1_30");
  assert.equal(rangoDe(31), "d31_60");
  assert.equal(rangoDe(91), "mas_90");
});

test("filtro de clientes e indicadores", () => {
  assert.equal(filtrarClientes(DOCS, "externos").length, 4);
  assert.equal(filtrarClientes(DOCS, "grupo").length, 1);
  const i = indicadores(DOCS, HOY, "externos");
  assert.equal(i.cartera, 1_881_000 + 2_232_500 + 500_000);
  assert.equal(i.documentos, 3);
  assert.equal(i.vencida, 1_881_000 + 2_232_500);
  assert.equal(i.pctVencida, 89);
  assert.equal(i.vence30, 500_000);
  assert.equal(i.retenido, 105_000 + 99_000 + 117_500);
  assert.equal(i.entreEmpresas, 68_770);
  assert.ok(i.diasPromedio > 30 && i.diasPromedio < 90, `días promedio ${i.diasPromedio}`);
});

test("antigüedad por cliente con línea de crédito y totales", () => {
  const clientes: ClienteCxc[] = [{ clave: "AUTO", nombre: "Cliente automotriz (planta)", rfc: null, dias_credito: 60, linea_credito: 6_000_000, pue_a_credito: false, area: null, responsable: null, notas: null }];
  const filas = antiguedadPorCliente(filtrarClientes(DOCS, "externos"), clientes, HOY);
  assert.deepEqual(filas.map((f) => f.cliente), ["Secretaría de obra pública", "Cliente automotriz (planta)"]);
  const sop = filas[0];
  assert.equal(sop.rangos.d1_30, 2_232_500);
  assert.equal(sop.rangos.d31_60, 1_881_000);
  assert.equal(sop.total, 4_113_500);
  assert.equal(sop.diasMax, 56);
  assert.equal(filas[1].linea_credito, 6_000_000);
  assert.equal(filas[1].rangos.corriente, 500_000);
  const t = totalesAntiguedad(filas);
  assert.equal(t.total, 4_613_500);
  assert.equal(t.corriente, 500_000);
});

test("cobranza esperada por semana y promesas", () => {
  assert.equal(lunesDe(HOY), "2026-10-19");
  const sin = cobranzaEsperada(filtrarClientes(DOCS, "externos"), [], HOY, 8);
  assert.equal(sin[0].monto, 4_113_500); // ya vencido
  assert.equal(sin.length, 9);
  assert.equal(sin.find((s) => s.clave === "2026-11-09")!.monto, 500_000);
  const promesa: GestionCxc[] = [{ cliente_clave: "SOP", tipo: "visita", fecha: "2026-10-07", nota: null, promesa_fecha: "2026-11-01", promesa_monto: 1_881_000 }];
  const con = cobranzaEsperada(filtrarClientes(DOCS, "externos"), promesa, HOY, 8);
  assert.equal(con[0].monto, 2_232_500); // la promesa mueve la estimación 4
  assert.equal(con.find((s) => s.clave === "2026-10-26")!.monto, 1_881_000);
  const vencida: GestionCxc[] = [{ ...promesa[0], promesa_fecha: "2026-10-20" }];
  assert.equal(cobranzaEsperada(filtrarClientes(DOCS, "externos"), vencida, HOY, 8)[0].monto, 4_113_500);
});

test("un depósito se aplica primero a lo más vencido", () => {
  const sop = DOCS.filter((d) => d.cliente_clave === "SOP");
  const r = aplicarCobro(sop, 2_000_000);
  assert.deepEqual(r.aplicaciones.map((a) => [a.doc.folio, a.aplica, a.queda]), [
    ["Estimación 4", 1_881_000, 0],
    ["Estimación 5", 119_000, 2_113_500],
  ]);
  assert.equal(r.sobrante, 0);
  assert.equal(aplicarCobro(sop, 5_000_000).sobrante, 886_500);
});

test("agenda de cobranza: incumplidas primero", () => {
  const g: GestionCxc[] = [
    { cliente_clave: "SOP", tipo: "visita", fecha: "2026-10-07", nota: "Estimación 4 en revisión", promesa_fecha: "2026-11-01", promesa_monto: 1_881_000 },
    { cliente_clave: "AUTO", tipo: "correo", fecha: "2026-10-13", nota: null, promesa_fecha: "2026-10-20", promesa_monto: null },
  ];
  const docs = [...DOCS, doc({ folio: "F-99", cliente_clave: "AUTO", cliente: "Cliente automotriz", total: 100_000, fecha: "2026-08-01", vence: "2026-08-31" })];
  const a = agendaCobranza(docs, [], g, HOY);
  assert.deepEqual(a.map((x) => [x.cliente, x.incumplida, x.vencido]), [
    ["Cliente automotriz", true, 100_000],
    ["Secretaría de obra pública", false, 4_113_500],
  ]);
  assert.equal(textoGestion(g[1], HOY), "Correo el 13 oct 2026 · promesa del 20 oct 2026 incumplida");
  assert.equal(textoGestion(g[0], HOY), "Visita el 07 oct 2026 · promesa del 01 nov 2026");
});

test("cuadre entre empresas", () => {
  const c = cuadreEntreEmpresas([
    { vende_id: "a", vende: "AEP", compra_id: "c", compra: "CSC", vendido: 480_770, ov: 13, comprado: 412_000, oc: 7, por_pagar: 412_000, vencido: 412_000, ov_sin_oc: ["IA-OV-0007", "IA-OV-0013"] },
    { vende_id: "a", vende: "AEP", compra_id: "e", compra: "ERG", vendido: 296_728, ov: 20, comprado: 296_728.5, oc: 20, por_pagar: 0, vencido: 0, ov_sin_oc: [] },
  ]);
  assert.equal(c[0].cuadra, false);
  assert.equal(c[0].diferencia, 68_770);
  assert.match(c[0].nota!, /CSC no ha registrado como OC las ventas IA-OV-0007, IA-OV-0013/);
  assert.equal(c[1].cuadra, true);
  assert.equal(c[1].nota, null);
});

test("revisión de la captura de un documento", () => {
  assert.equal(revisarDocumento({ folio: "Estimación 6", cliente_nombre: "SOP", fecha: "2026-10-01", total: 100, retenido: 5, vence: "2026-10-31" }), null);
  assert.match(revisarDocumento({ folio: "", cliente_nombre: "SOP", fecha: "2026-10-01", total: 100, retenido: 0, vence: null })!, /folio/);
  assert.match(revisarDocumento({ folio: "E", cliente_nombre: "SOP", fecha: "2026-10-01", total: 100, retenido: 200, vence: null })!, /retenido/);
  assert.match(revisarDocumento({ folio: "E", cliente_nombre: "SOP", fecha: "2026-10-01", total: 100, retenido: 0, vence: "2026-09-01" })!, /vencimiento/);
});

test("OV pendientes: filtro por empresa y cliente, documento para aplicar y suma", () => {
  const ov = (p: Partial<OvPendiente> & { id: string; id_ov: string; saldo: number }): OvPendiente => ({
    empresa_id: "mcc", empresa: "MCC", cliente: "Ferretería El Tornillo", cliente_clave: "FET010101AAA", cliente_rfc: "FET010101AAA", fecha_ov: "2026-10-01",
    total: p.saldo, cobrado: 0, proyecto: null, fuente: "acumulado", condicion_pago: "credito", documento_id: null, dias_credito: 30, ...p,
  });
  const OVS = [
    ov({ id: "a", id_ov: "IA-OV-0003", saldo: 1_000, fecha_ov: "2026-09-20" }),
    ov({ id: "b", id_ov: "IA-OV-0010", saldo: 2_500, fecha_ov: "2026-10-05" }),
    ov({ id: "c", id_ov: "15340", saldo: 800, cliente: "Otro cliente", cliente_clave: "N:OTRO CLIENTE", cliente_rfc: null, proyecto: "Parque Real" }),
    ov({ id: "d", id_ov: "IA-OV-0001", saldo: 400, empresa_id: "aep", empresa: "AEP" }),
  ];
  const f = { empresaId: "mcc", clienteClave: "FET010101AAA", todas: false, texto: "" };
  assert.deepEqual(filtrarOvPendientes(OVS, f).map((o) => o.id), ["b", "a"]); // más reciente primero
  assert.deepEqual(filtrarOvPendientes(OVS, { ...f, todas: true }).map((o) => o.id), ["b", "c", "a"]);
  assert.deepEqual(filtrarOvPendientes(OVS, { ...f, todas: true, texto: "parque" }).map((o) => o.id), ["c"]);
  assert.deepEqual(filtrarOvPendientes(OVS, { ...f, empresaId: null, todas: true, texto: "0001" }).map((o) => o.id), ["d"]);
  assert.equal(sumaOv(OVS, ["a", "b"]), 3_500);
  const d = docDesdeOv(OVS[0], HOY);
  assert.equal(d.origen, "ov");
  assert.equal(d.folio, "OV IA-OV-0003");
  assert.equal(d.vence, "2026-10-20"); // 20-sep + 30 días
  assert.equal(docDesdeOv({ ...OVS[0], fecha_ov: null }, HOY).fecha, HOY);
  // El cobro se aplica solo a las OV elegidas, la más vencida primero.
  const r = aplicarCobro([OVS[0], OVS[1]].map((o) => docDesdeOv(o, HOY)), 1_500);
  assert.deepEqual(r.aplicaciones.map((a) => [a.doc.folio, a.aplica]), [["OV IA-OV-0003", 1_000], ["OV IA-OV-0010", 500]]);
});
