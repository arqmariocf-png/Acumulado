import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accionesSugeridas,
  estadoFlujo,
  etiquetaPeriodo,
  faltantesIncidencia,
  htmlInformeComite,
  htmlInformeIncidencia,
  periodoAnterior,
  periodoDe,
  periodosHasta,
  proximoLunes,
  rangoPeriodo,
  resultadoDe,
  resumenComite,
  semaforoGeneral,
  textoIncidencia,
  ultimaPrueba,
  type ControlResumen,
  type Incidencia,
  type PruebaResumen,
} from "./cumplimientoNormativo.ts";

test("periodos mensuales y trimestrales como en la base", () => {
  assert.equal(periodoDe("2026-10-18", "mensual"), "2026-10");
  assert.equal(periodoDe("2026-10-18", "trimestral"), "2026-T4");
  assert.deepEqual(rangoPeriodo("2026-T4"), { desde: "2026-10-01", hasta: "2026-12-31" });
  assert.deepEqual(rangoPeriodo("2026-02"), { desde: "2026-02-01", hasta: "2026-02-28" });
  assert.equal(periodoAnterior("2026-01"), "2025-12");
  assert.equal(periodoAnterior("2026-T1"), "2025-T4");
  assert.equal(etiquetaPeriodo("2026-T4"), "4º trimestre 2026");
  assert.equal(etiquetaPeriodo("2026-10"), "octubre 2026");
  assert.deepEqual(periodosHasta("2026-10-18", "mensual", 3), ["2026-08", "2026-09", "2026-10"]);
});

test("resultado con tolerancia y semáforo general", () => {
  assert.equal(resultadoDe(74, 0, 5), "cumple");
  assert.equal(resultadoDe(100, 5, 5), "excepciones");
  assert.equal(resultadoDe(74, 16, 5), "no_cumple");
  assert.equal(resultadoDe(0, 2, 5), "no_cumple");
  assert.equal(semaforoGeneral(["cumple", "cumple"]), "verde");
  assert.equal(semaforoGeneral(["cumple", null]), "ambar");
  assert.equal(semaforoGeneral(["excepciones", "no_cumple"]), "rojo");
  assert.equal(semaforoGeneral([]), "gris");
});

const control: ControlResumen = { id: "c1", clave: "PAG-01", nombre: "Todo pago lleva su comprobante", area: "tesoreria", frecuencia: "mensual", prueba: "pagos_con_comprobante", activo: true };
const prueba = (periodo: string, resultado: PruebaResumen["resultado"], created_at: string, excepciones = 0): PruebaResumen => ({
  id: `${periodo}-${created_at}`,
  control_id: "c1",
  periodo,
  resultado,
  poblacion: 10,
  excepciones,
  created_at,
});

test("la revisión que cuenta es la más reciente del periodo; flujo atrasado", () => {
  const ps = [prueba("2026-10", "no_cumple", "2026-10-05T10:00:00Z", 3), prueba("2026-10", "cumple", "2026-10-12T10:00:00Z")];
  assert.equal(ultimaPrueba(ps, "c1", "2026-10")?.resultado, "cumple");
  assert.equal(estadoFlujo(control, ps, "2026-10-18").estado, "revisado");
  assert.equal(estadoFlujo(control, [prueba("2026-09", "cumple", "2026-10-01T13:30:00Z")], "2026-10-18").estado, "por_revisar");
  assert.equal(estadoFlujo(control, [], "2026-10-18").estado, "atrasado");
});

test("norma → cinco tareas, la primera el lunes, sin pasar de la entrada en vigor", () => {
  assert.equal(proximoLunes("2026-10-18"), "2026-10-19"); // domingo → lunes
  assert.equal(proximoLunes("2026-10-19"), "2026-10-19");
  const a = accionesSugeridas({ titulo: "Reforma LFT 40 horas", fecha_vigor: "2026-11-01", areas: ["rh"] }, "2026-10-18");
  assert.equal(a.length, 5);
  assert.match(a[0].texto, /Reforma LFT 40 horas/);
  assert.match(a[1].texto, /Recursos humanos/);
  assert.deepEqual(a.map((x) => x.fecha), ["2026-10-19", "2026-10-26", "2026-11-01", "2026-11-01", "2026-11-01"]);
  const sinFecha = accionesSugeridas({ titulo: "X" }, "2026-10-18");
  assert.equal(sinFecha[4].fecha, "2026-11-16");
});

const inc: Incidencia = {
  folio: "INC-CSC-0001",
  titulo: "Pago duplicado a proveedor",
  empresa: "CSC",
  detectada_el: "2026-10-18",
  severidad: "alta",
  area: "tesoreria",
  que_paso: "Se pagó dos veces la OC 41074.",
  impacto: "Salida de $2,383.40 de más.",
  monto_estimado: 2383.4,
  acciones_inmediatas: "Se pidió al proveedor la devolución.",
  acciones_correctivas: "Bloqueo de doble programación.",
  proxima_actualizacion: "2026-10-21",
  estatus: "contenida",
  responsable_nombre: "Delia",
};

test("informe de incidencia: completo, texto y HTML escapado", () => {
  assert.deepEqual(faltantesIncidencia(inc), []);
  assert.deepEqual(faltantesIncidencia({ ...inc, que_paso: " ", proxima_actualizacion: null }), ["qué pasó", "cuándo se vuelve a informar"]);
  const t = textoIncidencia(inc);
  assert.match(t, /^\*Informe de incidencia INC-CSC-0001\*/);
  assert.match(t, /\*Qué hicimos ya:\* Se pidió/);
  assert.match(t, /Próxima actualización:\* 21 de octubre de 2026/);
  const html = htmlInformeIncidencia({ ...inc, titulo: "<b>x</b>" }, "2026-10-18");
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(html.includes("Severidad Alta"));
});

test("informe al comité en una página: orden, tendencia y mensajes", () => {
  const controles: ControlResumen[] = [
    control,
    { ...control, id: "c2", clave: "RH-01", nombre: "Expediente completo", area: "rh", frecuencia: "trimestral" },
    { ...control, id: "c3", clave: "ALM-02", nombre: "Inventario sin negativos", area: "almacen" },
  ];
  const pruebas: PruebaResumen[] = [
    { ...prueba("2026-12", "no_cumple", "2027-01-01T13:30:00Z", 4), control_id: "c1" },
    { ...prueba("2026-11", "cumple", "2026-12-01T13:30:00Z"), control_id: "c1" },
    { ...prueba("2026-T4", "cumple", "2027-01-01T13:30:00Z"), control_id: "c2" },
  ];
  const r = resumenComite({
    periodo: "2026-T4",
    controles,
    pruebas,
    incidencias: [{ ...inc, cerrada_en: null }],
    normas: [{ titulo: "Reforma LFT", fecha_vigor: "2026-11-01", estatus: "en_implementacion" }],
    hoy: "2027-01-02",
  });
  assert.equal(r.semaforo, "rojo");
  assert.deepEqual(r.controles.map((f) => f.clave), ["PAG-01", "ALM-02", "RH-01"]);
  assert.equal(r.controles[0].tendencia, "empeora");
  assert.equal(r.incidencias.abiertas, 1);
  assert.equal(r.incidencias.graves.length, 1);
  assert.ok(r.mensajes.some((m) => m.startsWith("2 de 3 controles revisados")));
  assert.ok(r.mensajes.some((m) => m.includes("Falta revisar: Inventario sin negativos")));
  assert.ok(r.mensajes.some((m) => m.includes("ya en vigor")));
  const html = htmlInformeComite(r, { organizacion: "Grupo Loma", decisiones: "Aprobar bloqueo", elaboro: "Belén", emitido: "2027-01-02" });
  assert.ok(html.includes("4º trimestre 2026"));
  assert.ok(html.includes("Requiere atención"));
  assert.ok(html.includes("▼ empeora"));
});
