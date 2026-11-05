import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENTE_DE_LA_OBRA, agruparManoObra, csvOrigen, filtrarOrigen, gastoPorCliente, ligasGenerales, ligasRenglon, opcionesCliente, pendienteDe, resumenOrigen, tituloOrigen, type RenglonOrigen } from "./origenDato.ts";

const base: RenglonOrigen = {
  origen: "oc", proyecto_id: "obra-1", obra: "Parque Real 63", empresa_id: "mcf", empresa_codigo: "MCF", mes: "2026-09-01", categoria: "materiales",
  orden_compra_id: "oc-1", folio: "41055", tipo: "OC", proveedor: "MERCADO LIBRE", fecha: "2026-09-28", fuente: "api", estatus: "Pendiente Comprobante",
  control_id: null, descripcion: null, semana: null, monto: 2120, pagado: 2120,
};
const renglones: RenglonOrigen[] = [
  base,
  { ...base, orden_compra_id: "oc-2", folio: "40957", monto: 1551.72, pagado: 0, estatus: "Pendiente de Pago" },
  { ...base, orden_compra_id: "oc-3", folio: "IA-OS-0004", tipo: "OS", categoria: "subcontratos", mes: "2026-10-01", fecha: "2026-10-02", monto: 1000, pagado: 400 },
  { ...base, origen: "mano_obra", orden_compra_id: null, folio: null, tipo: null, categoria: "mano_obra", mes: "2026-09-01", semana: "2026-09-21 a 2026-09-27", descripcion: "Albañilería", monto: 25000, pagado: 25000 },
  { ...base, proyecto_id: "obra-2", obra: "Obra Felipe", empresa_id: "erg", empresa_codigo: "ERG", origen: "control", orden_compra_id: null, folio: "F-1", tipo: null, control_id: "c-1", descripcion: "Acabados · pintura", mes: "2026-07-01", monto: 500, pagado: 0 },
];

test("filtrarOrigen respeta empresa, obra, periodo, categoría, mes y campo", () => {
  assert.equal(filtrarOrigen(renglones, {}).length, 5);
  assert.equal(filtrarOrigen(renglones, { obraId: "obra-1" }).length, 4);
  assert.equal(filtrarOrigen(renglones, { empresaId: "erg" }).length, 1);
  assert.equal(filtrarOrigen(renglones, { categoria: "materiales" }).length, 3);
  assert.equal(filtrarOrigen(renglones, { mes: "2026-09" }).length, 3);
  assert.equal(filtrarOrigen(renglones, { anio: 2026, periodo: "T3" }).length, 4);
  assert.equal(filtrarOrigen(renglones, { anio: 2026, periodo: "10" }).length, 1);
  assert.equal(filtrarOrigen(renglones, { anio: 2025, periodo: "todo" }).length, 0);
  // pagado = solo con algo pagado; pendiente = solo con saldo
  assert.deepEqual(filtrarOrigen(renglones, { campo: "pagado" }).map((r) => r.folio), ["41055", "IA-OS-0004", null]);
  assert.deepEqual(filtrarOrigen(renglones, { campo: "pendiente" }).map((r) => r.folio), ["40957", "IA-OS-0004", "F-1"]);
  assert.equal(pendienteDe(renglones[2]), 600);
});

test("resumenOrigen cuadra totales por origen", () => {
  const r = resumenOrigen(filtrarOrigen(renglones, { obraId: "obra-1" }));
  assert.equal(r.renglones, 4);
  assert.equal(r.real, 29671.72);
  assert.equal(r.pagado, 27520);
  assert.equal(r.pendiente, 2151.72);
  assert.deepEqual(r.porOrigen.map((o) => [o.origen, o.renglones, o.real]), [["oc", 3, 4671.72], ["mano_obra", 1, 25000]]);
});

test("cada renglón sabe a dónde lleva", () => {
  assert.equal(ligasRenglon(renglones[0])[0].a, "/ordenes?tipo=OC&buscar=41055&backoffice=1");
  assert.equal(ligasRenglon(renglones[2])[0].a, "/ordenes?tipo=OS&buscar=IA-OS-0004&backoffice=1");
  assert.equal(ligasRenglon(renglones[3])[0].a, "/rh/mano-de-obra?buscar=Parque%20Real%2063");
  assert.equal(ligasRenglon(renglones[4])[0].a, "/proyectos/obra-2?tab=control");
  const g = ligasGenerales({ obraId: "obra-1" }, "Parque Real 63");
  assert.ok(g.some((l) => l.a === "/finanzas/avance-financiero?vista=capturar&obra=obra-1"));
  assert.ok(ligasGenerales({}, null).some((l) => l.a === "/finanzas/obras"));
});

test("título y CSV", () => {
  const t = (c: string) => ({ materiales: "Materiales" })[c] ?? c;
  assert.equal(tituloOrigen({ campo: "pagado", obraId: "x", categoria: "materiales", mes: "2026-09" }, "Parque Real 63", "MCF", t), "Pagado · Parque Real 63 · Materiales · sep 2026");
  assert.equal(tituloOrigen({ anio: 2026, periodo: "T3" }, null, null, t), "Real (ejercido) · todas las obras · trimestre 3 2026");
  assert.equal(tituloOrigen({ anio: 2026, periodo: "09" }, null, "ERG", t), "Real (ejercido) · ERG · sep 2026");
  assert.equal(tituloOrigen({ anio: 2026 }, null, null, t), "Real (ejercido) · todas las obras · 2026");
  const csv = csvOrigen(renglones.slice(0, 2));
  assert.match(csv, /^Origen,Obra,Empresa/);
  assert.match(csv, /Órdenes de compra y de servicio,Parque Real 63,MCF,2026-09,materiales,OC,40957,MERCADO LIBRE,2026-09-28,,,,,,Pendiente de Pago,api,1551.72,0,1551.72/);
});

const mo = (cambios: Partial<RenglonOrigen>): RenglonOrigen => ({ ...base, origen: "mano_obra", orden_compra_id: null, folio: null, tipo: null, categoria: "mano_obra", proveedor: "CSC", fuente: "api", estatus: "Pagada", ...cambios });

test("mano de obra clasificada: partida → puesto → persona → semana, con subtotales y orden por monto", () => {
  const rows = [
    mo({ descripcion: "Administrativo y Operativo", subpartida: "Auxiliar técnico", trabajador: "Jonathan", tipo_trabajador: "Empleado", semana: "2026-10-25 a 2026-10-31", fecha: "2026-10-31", num_sem: 44, monto: 1741.07, pagado: 1741.07 }),
    mo({ descripcion: "Administrativo y Operativo", subpartida: "Auxiliar técnico", trabajador: "Jonathan", tipo_trabajador: "Empleado", semana: "2026-10-18 a 2026-10-24", fecha: "2026-10-24", num_sem: 43, monto: 1741.07, pagado: 1741.07 }),
    mo({ descripcion: "Administrativo y Operativo", subpartida: "Coordinador", trabajador: "Christian", tipo_trabajador: "Empleado", semana: "2026-10-25 a 2026-10-31", fecha: "2026-10-31", num_sem: 44, monto: 2330.36, pagado: 2330.36 }),
    mo({ descripcion: "Albañilería", subpartida: null, trabajador: "Pedro", tipo_trabajador: "Destajo", semana: "2026-10-25 a 2026-10-31", fecha: "2026-10-31", num_sem: 44, monto: 9000, pagado: 9000 }),
    base, // una OC no entra
  ];
  const g = agruparManoObra(rows);
  assert.deepEqual(g.map((p) => [p.partida, p.monto, p.semanas]), [["Albañilería", 9000, 1], ["Administrativo y Operativo", 5812.5, 2]]);
  assert.deepEqual(g[1].subpartidas.map((s) => [s.subpartida, s.monto]), [["Auxiliar técnico", 3482.14], ["Coordinador", 2330.36]]);
  const jon = g[1].subpartidas[0].personas[0];
  assert.equal(jon.trabajador, "Jonathan");
  assert.equal(jon.semanas, 2);
  assert.equal(jon.renglones[0].num_sem, 44); // la más reciente primero
  assert.equal(g[0].subpartidas[0].subpartida, "Sin clasificar");
});

test("gasto por cliente: lo sin cliente y la mano de obra van al cliente de la obra", () => {
  const rows = [
    { ...base, gasto_cliente: "Oficinas Grupo Loma" },
    { ...base, orden_compra_id: "oc-2", folio: "40957", monto: 1551.72, pagado: 0 },
    { ...base, orden_compra_id: "oc-3", folio: "40958", monto: 100, pagado: 100, gasto_cliente: "Obra privada · Casa Pérez" },
    mo({ monto: 25000, pagado: 25000 }),
  ];
  const g = gastoPorCliente(rows);
  assert.deepEqual(g.map((x) => [x.cliente, x.oc, x.manoObra, x.total, x.ordenes]), [
    [CLIENTE_DE_LA_OBRA, 1551.72, 25000, 26551.72, 1],
    ["Oficinas Grupo Loma", 2120, 0, 2120, 1],
    ["Obra privada · Casa Pérez", 100, 0, 100, 1],
  ]);
  assert.deepEqual(opcionesCliente(rows, ["BBVA"]), ["BBVA", "Obra privada", "Obra privada · Casa Pérez", "Oficinas Grupo Loma"]);
});
