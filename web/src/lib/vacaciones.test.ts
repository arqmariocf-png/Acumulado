import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarioAusencias, diaDeRegreso, diasDeLey, diasHabiles, revisarSolicitud, situacion, sumarDias, vacacionesDesde, vacacionesHabilitadas, type Ausencia } from "./vacaciones.ts";

test("días hábiles: lun-sáb sin domingos ni festivos; lun-vie tampoco sábados", () => {
  // 16-nov-2026 es el tercer lunes de noviembre (festivo); la semana tiene 5 hábiles en jornada de 6 días.
  assert.equal(diasHabiles("2026-11-16", "2026-11-21", 6), 5);
  assert.equal(diasHabiles("2026-11-16", "2026-11-21", 5), 4);
  assert.equal(diasHabiles("2026-11-22", "2026-11-22", 6), 0); // domingo
  assert.equal(diasHabiles("2026-11-23", "2026-11-20", 6), 0); // al revés
  assert.equal(diasHabiles("2026-12-21", "2027-01-02", 6), 10); // cruza año: 25-dic y 1-ene fuera, 2 domingos fuera
});

test("día de regreso: el siguiente hábil (sábado → lunes; viernes antes de festivo brinca)", () => {
  assert.equal(diaDeRegreso("2026-11-21", 6), "2026-11-23");
  assert.equal(diaDeRegreso("2026-11-13", 6), "2026-11-14"); // sábado hábil en jornada de 6
  assert.equal(diaDeRegreso("2026-11-13", 5), "2026-11-17"); // sáb y dom fuera, lunes 16 festivo
});

test("días de ley art. 76: 12, 14, 16, 18, 20, luego +2 cada 5 años", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10, 11, 15, 16].map(diasDeLey), [12, 14, 16, 18, 20, 22, 22, 24, 24, 26]);
});

test("revisar solicitud: fechas, hábiles y saldo", () => {
  const saldo = { anio_servicio: 2, anios_cumplidos: 1, periodo_desde: "2026-09-21", periodo_hasta: "2027-09-20", dias_ley: 12, tomados: 0, pendientes: 10, disponibles: 2, dias_semana: 6, habilitado: true, habilitado_desde: "2026-09-21" };
  assert.ok(revisarSolicitud({ tipo: "vacaciones", desde: "", hasta: "2026-11-20" }));
  assert.ok(revisarSolicitud({ tipo: "vacaciones", desde: "2026-11-22", hasta: "2026-11-22" })?.includes("hábiles"));
  assert.ok(revisarSolicitud({ tipo: "vacaciones", desde: "2026-11-17", hasta: "2026-11-20", saldo })?.includes("2 disponibles"));
  assert.equal(revisarSolicitud({ tipo: "vacaciones", desde: "2026-11-17", hasta: "2026-11-20", saldo, puedeExceder: true }), null);
  assert.equal(revisarSolicitud({ tipo: "permiso_sin_goce", desde: "2026-11-17", hasta: "2026-11-20", saldo }), null);
  assert.equal(revisarSolicitud({ tipo: "vacaciones", desde: "2026-11-17", hasta: "2026-11-18", saldo }), null);
});

test("vacaciones solo al cumplir un año (5-nov-2026); RH puede antes; permisos no cambian", () => {
  const nuevo = { anio_servicio: 1, anios_cumplidos: 0, periodo_desde: "2026-06-01", periodo_hasta: "2027-05-31", dias_ley: 0, tomados: 0, pendientes: 0, disponibles: 0, dias_semana: 6, habilitado: false, habilitado_desde: "2027-06-01" };
  const msj = revisarSolicitud({ tipo: "vacaciones", desde: "2026-11-17", hasta: "2026-11-18", saldo: nuevo });
  assert.ok(msj?.includes("cumplir un año") && msj.includes("01/06/2027"), msj ?? "");
  assert.equal(revisarSolicitud({ tipo: "vacaciones", desde: "2026-11-17", hasta: "2026-11-18", saldo: nuevo, puedeExceder: true }), null);
  assert.equal(revisarSolicitud({ tipo: "permiso_con_goce", desde: "2026-11-17", hasta: "2026-11-18", saldo: nuevo }), null);
  assert.equal(vacacionesHabilitadas(nuevo), false);
  assert.equal(vacacionesHabilitadas({ anios_cumplidos: 1 }), true); // saldo viejo sin la marca
  assert.equal(vacacionesHabilitadas(null), false);
  assert.equal(vacacionesDesde("2026-06-01"), "2027-06-01");
  assert.equal(vacacionesDesde("2024-02-29"), "2025-03-01");
});

const a = (nombre: string, desde: string, hasta: string, estado: Ausencia["estado"] = "autorizada"): Ausencia => ({
  id: nombre + desde, personal_id: nombre, profile_id: null, personal_nombre: nombre, tipo: "vacaciones", desde, hasta, dias: diasHabiles(desde, hasta),
  regresa_el: diaDeRegreso(hasta), cubre_nombre: null, notas: null, estado, solicitante_nombre: null, rechazo_motivo: null, created_at: "",
});

test("situación y calendario: fuera hoy, sale, regresa, próximas; solo autorizadas", () => {
  const hoy = "2026-11-10";
  assert.equal(situacion(a("x", "2026-11-09", "2026-11-14"), hoy), "fuera");
  assert.equal(situacion(a("x", "2026-11-10", "2026-11-14"), hoy), "sale_hoy");
  assert.equal(situacion(a("x", "2026-11-05", "2026-11-10"), hoy), "regresa_manana");
  assert.equal(situacion(a("x", "2026-11-12", "2026-11-14"), hoy), "proxima");
  assert.equal(situacion(a("x", "2026-11-02", "2026-11-07"), hoy), "pasada");
  const cal = calendarioAusencias([
    a("Ana", "2026-11-09", "2026-11-14"),
    a("Beto", "2026-11-12", "2026-11-13"),
    a("Caro", "2026-11-25", "2026-11-28"),
    a("Dani", "2026-11-12", "2026-11-13", "solicitada"),
    a("Eli", "2026-11-02", "2026-11-07"),
  ], hoy);
  assert.deepEqual(cal.fueraHoy.map((x) => x.personal_nombre), ["Ana"]);
  assert.deepEqual(cal.salenProximos7.map((x) => x.personal_nombre), ["Beto"]);
  assert.deepEqual(cal.regresanProximos7.map((x) => x.personal_nombre), ["Ana"]);
  assert.deepEqual(cal.proximas30.map((x) => x.personal_nombre), ["Caro"]);
  assert.equal(sumarDias("2026-12-30", 3), "2027-01-02");
});
