import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularFiniquito, diasVacacionesPorAnio, fechaLarga, htmlContrato, htmlFiniquito, htmlAvisoPrivacidad, textoMotivoBaja } from "./documentosRh.ts";

const persona = {
  nombre: "Juan Pérez López", puesto: "Ayudante", curp: "PELJ900101HPLRPN01", rfc: null, nss: null,
  domicilio_particular: "Calle 1 #2, Puebla", fecha_ingreso: "2025-03-01", fecha_baja: "2026-09-21", motivo_baja: "renuncia: se va a otra empresa",
  sexo: "M" as const, nacionalidad: "Mexicana", estado_civil: "soltero", fecha_nacimiento: "1990-01-01",
};
const patron = {
  razon_social: "Ergodinova, S.A. de C.V.", representante_legal_nombre: "Mario Contreras Farfán", representante_legal_puesto: "Administrador Único",
  domicilio_legal: "Prolongación X 100, Puebla, Pue.", ciudad_firma: "Puebla, Pue.",
};
const contratacion = { puesto: "Ayudante general", sueldo_semanal: 2800, fecha_inicio: "2026-03-01", fecha_fin: "2026-08-31", duracion_dias: 183, tipo_contrato: "laboral_determinado" as const };

test("vacaciones por año conforme a la reforma 2023 (12, 14, 16, 18, 20, luego +2 cada 5 años)", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10, 11].map(diasVacacionesPorAnio), [12, 14, 16, 18, 20, 22, 22, 24]);
});

test("finiquito de referencia: salario diario, proporcionales y total", () => {
  const f = calcularFiniquito(2800, "2025-03-01", "2026-09-21");
  assert.equal(f.salarioDiario, 400);
  assert.equal(f.aniosCumplidos, 1);
  assert.equal(f.diasAnioEnCurso, 204); // 569 días trabajados - 365
  assert.equal(f.diasVacacionesAnio, 14); // segundo año de servicio
  // 15 * 264 días de 2026 (1-ene..21-sep inclusive) * 400 / 365
  assert.equal(f.aguinaldoProporcional, 4339.73);
  assert.equal(f.vacacionesProporcionales, Math.round((14 * 204 * 400) / 365 * 100) / 100);
  assert.equal(f.primaVacacional, Math.round(f.vacacionesProporcionales * 25) / 100);
  assert.equal(f.total, Math.round((f.aguinaldoProporcional + f.vacacionesProporcionales + f.primaVacacional) * 100) / 100);
});

test("aguinaldo no cuenta días anteriores al ingreso cuando entró en el mismo año", () => {
  const f = calcularFiniquito(700, "2026-09-01", "2026-09-21");
  assert.equal(f.diasTrabajados, 20);
  assert.equal(f.aguinaldoProporcional, Math.round((15 * 20 * 100) / 365 * 100) / 100);
});

test("fechas largas y motivo de baja", () => {
  assert.equal(fechaLarga("2026-09-21"), "21 de septiembre de 2026");
  assert.equal(textoMotivoBaja("renuncia: se va"), "renuncia voluntaria");
  assert.equal(textoMotivoBaja(null), "terminación de la relación de trabajo");
});

test("los documentos traen los datos clave y escapan HTML", () => {
  const c = htmlContrato({ ...persona, nombre: "Ana <b>Ruiz</b>", sexo: "F" }, contratacion, patron);
  assert.match(c, /Ana &lt;b&gt;Ruiz&lt;\/b&gt;/);
  assert.match(c, /LA TRABAJADORA/);
  assert.match(c, /tiempo determinado del 1 de marzo de 2026 al 31 de agosto de 2026/);
  assert.match(c, /\$2,800\.00/);
  const i = htmlContrato(persona, { ...contratacion, tipo_contrato: "laboral_indeterminado" }, patron);
  assert.match(i, /por tiempo indeterminado/);
  const f = htmlFiniquito(persona, contratacion, patron);
  assert.match(f, /renuncia voluntaria/);
  assert.match(f, /1 de marzo de 2025 al 21 de septiembre de 2026/);
  const a = htmlAvisoPrivacidad(patron, persona);
  assert.match(a, /Ergodinova, S\.A\. de C\.V\./);
  assert.match(a, /Derechos ARCO/);
});

test("sueldoSemanalDesde: quincenal se convierte a semanal (24 pagos / 52 semanas)", async () => {
  const { sueldoSemanalDesde } = await import("./documentosRh.ts");
  assert.equal(sueldoSemanalDesde("semanal", 2500), 2500);
  assert.equal(sueldoSemanalDesde("quincenal", 5200), 2400);
  assert.equal(sueldoSemanalDesde("quincenal", 6000), 2769.23);
});
