// Reporte de recursos humanos para el director general (29-oct-2026, Mario:
// "genera el reporte para director general de recursos humanos"). La base
// entrega los datos ya agregados (`fn_reporte_rh_director`); aquí viven las
// reglas puras: semáforos, alertas con prioridad, resumen ejecutivo y el HTML
// imprimible. Sin DOM: se prueba en node.

export interface ReporteRh {
  desde: string;
  hasta: string;
  dias: number;
  habiles: number;
  plantilla: {
    activos: number;
    con_cuenta: number;
    checan: number;
    antiguedad_meses: number | null;
    altas: { nombre: string; puesto: string | null; fecha: string; empresa: string | null }[];
    bajas: { nombre: string; puesto: string | null; fecha: string; cuenta_activa: boolean }[];
    bajas_con_cuenta: { nombre: string; fecha: string | null }[];
    por_empresa: { empresa: string; n: number }[];
    por_area: { area: string; n: number }[];
    por_puesto: { puesto: string; n: number }[];
    sin_cuenta: { nombre: string; puesto: string | null }[];
    expedientes_incompletos: { nombre: string; faltan: string }[];
    sin_jefe: number;
    rotacion: { mes: string; altas: number; bajas: number; plantilla_fin: number; rotacion_pct: number }[];
  };
  asistencia: {
    personas: number;
    dias_con_entrada: number;
    retardos: number;
    pct_asistencia: number | null;
    pct_puntualidad: number | null;
    no_checan: { nombre: string; puesto: string | null }[];
    mas_faltas: { nombre: string; puesto: string | null; dias: number; faltas: number; retardos: number }[];
    mas_retardos: { nombre: string; puesto: string | null; dias: number; retardos: number }[];
  };
  tareas: {
    tableros: number;
    abiertas: number;
    vencidas: number;
    periodo: { total: number; hechas: number; a_tiempo: number; vencidas: number; pct_cumplimiento: number | null; pct_a_tiempo: number | null; cambios_fecha: number };
    por_area: { area: string; total: number; hechas: number; vencidas: number }[];
    por_persona: { nombre: string; total: number; hechas: number; a_tiempo: number; vencidas: number }[];
  };
  evaluaciones: {
    firmadas_12m: number;
    borradores: number;
    promedio: number | null;
    por_nivel: { nivel: string; n: number }[];
    sin_evaluacion_6m: number;
    ultimas: { nombre: string; puesto: string | null; calificacion: number; nivel: string; fecha: string; evaluador: string | null }[];
  };
  nomina: {
    semanal: { empresa: string; semana: string | null; fin: string; personas: number; total: number }[];
    quincenal: { empresa: string; fin: string; personas: number; total: number }[];
    mano_obra: { empresa: string; fin: string; personas: number; total: number }[];
    semanal_tendencia: { fin: string; total: number; personas: number }[];
    sin_empresa: string[];
  };
  epp: { entregadas: number; vencidas: number; por_vencer_30: number; por_surtir: number; perdidas_por_descontar: number; solicitudes_pendientes: number; vencidas_lista: { persona: string | null; pieza: string; vencio: string }[] };
  herramienta: { asignadas: number; regreso_vencido: number; extraviadas: number; reparacion: number; vencidas_lista: { folio: string; nombre: string; responsable: string | null; devolver_el: string }[] };
  financiamiento: { cuentas: number; con_linea: number; linea_total: number; con_sueldo: number; saldo_vigente: number; cargos_vigentes: number; con_atraso: number; por_firmar: number };
  accesos: { activas: number; con_push: number; sin_push: { nombre: string; rol: string }[]; pendientes: { nombre: string }[]; por_rol: { rol: string; n: number }[] };
}

export type Semaforo = "verde" | "ambar" | "rojo" | "gris";

export interface Alerta {
  nivel: "rojo" | "ambar";
  area: "plantilla" | "asistencia" | "tareas" | "evaluaciones" | "nomina" | "epp" | "herramienta" | "financiamiento" | "accesos";
  texto: string;
  /** Pantalla donde se atiende. */
  ruta: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const n0 = (n: number | null | undefined) => (n == null ? "—" : Math.round(Number(n)).toLocaleString("es-MX"));
export const moneda = (n: number | null | undefined) => (n == null ? "—" : `$ ${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(Number(n))} %`);

export function ddmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Semáforo de un porcentaje "más es mejor": verde ≥ bueno, ámbar ≥ regular, rojo abajo. */
export function semaforoPct(valor: number | null | undefined, bueno: number, regular: number): Semaforo {
  if (valor == null) return "gris";
  if (valor >= bueno) return "verde";
  if (valor >= regular) return "ambar";
  return "rojo";
}

/** Semáforo de un conteo "menos es mejor": verde en 0, ámbar hasta el tope, rojo arriba. */
export function semaforoConteo(n: number, tope: number): Semaforo {
  if (n <= 0) return "verde";
  if (n <= tope) return "ambar";
  return "rojo";
}

/** Suma de la última nómina (semanal + quincenal) y de mano de obra. */
export function totalesNomina(n: ReporteRh["nomina"]): { semanal: number; quincenal: number; manoObra: number; fiscal: number; personasSemanal: number; personasQuincenal: number } {
  const semanal = r2(n.semanal.reduce((s, x) => s + Number(x.total), 0));
  const quincenal = r2(n.quincenal.reduce((s, x) => s + Number(x.total), 0));
  const manoObra = r2(n.mano_obra.reduce((s, x) => s + Number(x.total), 0));
  return {
    semanal,
    quincenal,
    manoObra,
    fiscal: r2(semanal + quincenal),
    personasSemanal: n.semanal.reduce((s, x) => s + Number(x.personas), 0),
    personasQuincenal: n.quincenal.reduce((s, x) => s + Number(x.personas), 0),
  };
}

/** Variación de la nómina semanal contra la semana anterior (última vs penúltima). */
export function variacionSemanal(t: ReporteRh["nomina"]["semanal_tendencia"]): { ultima: number; anterior: number; pct: number | null } | null {
  if (t.length < 2) return null;
  const ultima = Number(t[t.length - 1].total);
  const anterior = Number(t[t.length - 2].total);
  return { ultima, anterior, pct: anterior === 0 ? null : r2(((ultima - anterior) / anterior) * 100) };
}

/** Lo que el director debe atender, de lo más grave a lo menos. */
export function alertasReporte(d: ReporteRh): Alerta[] {
  const a: Alerta[] = [];
  const p = d.plantilla;
  if (p.bajas_con_cuenta.length > 0) {
    a.push({ nivel: "rojo", area: "accesos", texto: `${p.bajas_con_cuenta.length} persona(s) dada(s) de baja siguen con cuenta activa: ${p.bajas_con_cuenta.map((x) => x.nombre).join(", ")}.`, ruta: "/rh?tab=accesos" });
  }
  if (d.tareas.vencidas > 0) {
    a.push({ nivel: d.tareas.vencidas >= 10 ? "rojo" : "ambar", area: "tareas", texto: `${d.tareas.vencidas} tarea(s) vencida(s) sin terminar en ${d.tareas.tableros} tableros.`, ruta: "/rh?tab=actividades" });
  }
  if (d.asistencia.pct_asistencia != null && d.asistencia.pct_asistencia < 85) {
    a.push({ nivel: d.asistencia.pct_asistencia < 70 ? "rojo" : "ambar", area: "asistencia", texto: `Asistencia de ${pct(d.asistencia.pct_asistencia)} entre quienes checan (${d.habiles} días hábiles).`, ruta: "/rh?tab=kpi_checador" });
  }
  if (d.asistencia.pct_puntualidad != null && d.asistencia.pct_puntualidad < 70) {
    a.push({ nivel: d.asistencia.pct_puntualidad < 50 ? "rojo" : "ambar", area: "asistencia", texto: `Puntualidad de ${pct(d.asistencia.pct_puntualidad)}: ${n0(d.asistencia.retardos)} retardos contra la hora de entrada de su jornada (revisar perfiles de jornada si la hora no es la real).`, ruta: "/rh?tab=kpi_checador" });
  }
  if (d.asistencia.no_checan.length > 0) {
    a.push({ nivel: "ambar", area: "asistencia", texto: `${d.asistencia.no_checan.length} persona(s) con cuenta no marcaron ni una entrada en el periodo: ${d.asistencia.no_checan.map((x) => x.nombre).join(", ")}.`, ruta: "/rh?tab=checador" });
  }
  if (p.expedientes_incompletos.length > 0) {
    a.push({ nivel: "ambar", area: "plantilla", texto: `${p.expedientes_incompletos.length} expediente(s) incompleto(s): ${p.expedientes_incompletos.map((x) => x.nombre).join(", ")}.`, ruta: "/rh?tab=documentos" });
  }
  if (p.sin_cuenta.length > 0) {
    a.push({ nivel: "ambar", area: "plantilla", texto: `${p.sin_cuenta.length} persona(s) activa(s) sin cuenta en el sistema (no checan ni reciben tareas).`, ruta: "/rh?tab=accesos" });
  }
  if (d.epp.vencidas > 0) {
    a.push({ nivel: "rojo", area: "epp", texto: `${d.epp.vencidas} pieza(s) de EPP vencida(s) en uso (NOM-017-STPS).`, ruta: "/rh?tab=epp" });
  }
  if (d.epp.solicitudes_pendientes > 0) {
    a.push({ nivel: "ambar", area: "epp", texto: `${d.epp.solicitudes_pendientes} solicitud(es) de EPP sin atender.`, ruta: "/rh?tab=epp" });
  }
  if (d.epp.perdidas_por_descontar > 0) {
    a.push({ nivel: "ambar", area: "epp", texto: `EPP perdido por descontar vía nómina: ${moneda(d.epp.perdidas_por_descontar)}.`, ruta: "/rh?tab=epp" });
  }
  if (d.herramienta.regreso_vencido > 0) {
    a.push({ nivel: "ambar", area: "herramienta", texto: `${d.herramienta.regreso_vencido} herramienta(s) con fecha de regreso vencida.`, ruta: "/almacen/herramienta" });
  }
  if (d.herramienta.extraviadas > 0) {
    a.push({ nivel: "rojo", area: "herramienta", texto: `${d.herramienta.extraviadas} herramienta(s) extraviada(s).`, ruta: "/almacen/herramienta" });
  }
  if (d.financiamiento.con_atraso > 0) {
    a.push({ nivel: "rojo", area: "financiamiento", texto: `${d.financiamiento.con_atraso} préstamo(s) o cargo(s) de nómina con atraso.`, ruta: "/financiamiento" });
  }
  if (d.financiamiento.por_firmar > 0) {
    a.push({ nivel: "ambar", area: "financiamiento", texto: `${d.financiamiento.por_firmar} préstamo(s) esperando la firma del pagaré.`, ruta: "/financiamiento" });
  }
  if (d.evaluaciones.sin_evaluacion_6m > 0) {
    a.push({ nivel: "ambar", area: "evaluaciones", texto: `${d.evaluaciones.sin_evaluacion_6m} persona(s) con cuenta sin evaluación de desempeño firmada en 6 meses.`, ruta: "/rh/evaluacion" });
  }
  if (d.nomina.sin_empresa.length > 0) {
    a.push({ nivel: "ambar", area: "nomina", texto: `Nómina del backoffice con empresas que no existen aquí: ${d.nomina.sin_empresa.join(", ")}.`, ruta: "/catalogos/empresas" });
  }
  if (d.accesos.pendientes.length > 0) {
    a.push({ nivel: "ambar", area: "accesos", texto: `${d.accesos.pendientes.length} cuenta(s) registradas esperando rol: ${d.accesos.pendientes.map((x) => x.nombre).join(", ")}.`, ruta: "/admin" });
  }
  const sinPush = d.accesos.activas - d.accesos.con_push;
  if (d.accesos.activas > 0 && sinPush / d.accesos.activas > 0.3) {
    a.push({ nivel: "ambar", area: "accesos", texto: `${sinPush} de ${d.accesos.activas} cuentas activas no tienen notificaciones push.`, ruta: "/rh?tab=accesos" });
  }
  return a.sort((x, y) => (x.nivel === y.nivel ? 0 : x.nivel === "rojo" ? -1 : 1));
}

/** Frases del resumen ejecutivo, en el orden en que se leen. */
export function resumenEjecutivo(d: ReporteRh): string[] {
  const p = d.plantilla;
  const t = totalesNomina(d.nomina);
  const v = variacionSemanal(d.nomina.semanal_tendencia);
  const frases: string[] = [];
  frases.push(`Plantilla activa: ${n0(p.activos)} personas (${n0(p.con_cuenta)} con cuenta, ${n0(p.checan)} checan). Antigüedad promedio ${p.antiguedad_meses == null ? "—" : `${p.antiguedad_meses} meses`}.`);
  frases.push(`Movimiento del periodo: ${p.altas.length} alta(s) y ${p.bajas.length} baja(s).`);
  frases.push(`Asistencia ${pct(d.asistencia.pct_asistencia)} y puntualidad ${pct(d.asistencia.pct_puntualidad)} entre quienes checan (${n0(d.asistencia.dias_con_entrada)} días con entrada, ${n0(d.asistencia.retardos)} retardos).`);
  frases.push(`Tareas del periodo: ${n0(d.tareas.periodo.hechas)} de ${n0(d.tareas.periodo.total)} hechas (${pct(d.tareas.periodo.pct_cumplimiento)}), ${pct(d.tareas.periodo.pct_a_tiempo)} a tiempo; ${n0(d.tareas.vencidas)} vencidas hoy.`);
  frases.push(`Última nómina fiscal: ${moneda(t.fiscal)} (semanal ${moneda(t.semanal)} para ${n0(t.personasSemanal)} personas, quincenal ${moneda(t.quincenal)} para ${n0(t.personasQuincenal)})${v && v.pct != null ? `; la semanal ${v.pct >= 0 ? "subió" : "bajó"} ${Math.abs(v.pct)} % contra la semana anterior` : ""}. Mano de obra de la última semana: ${moneda(t.manoObra)}.`);
  frases.push(
    d.evaluaciones.firmadas_12m > 0
      ? `Evaluaciones firmadas en 12 meses: ${n0(d.evaluaciones.firmadas_12m)}, promedio ${d.evaluaciones.promedio ?? "—"}; ${n0(d.evaluaciones.sin_evaluacion_6m)} personas sin evaluar en 6 meses.`
      : `Todavía no hay evaluaciones de desempeño firmadas; ${n0(d.evaluaciones.sin_evaluacion_6m)} personas con cuenta por evaluar.`,
  );
  return frases;
}

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tabla(encabezados: string[], filas: (string | number | null | undefined)[][], alineaDerecha: number[] = []): string {
  if (filas.length === 0) return `<p class="vacio">Sin registros.</p>`;
  const th = encabezados.map((h, i) => `<th${alineaDerecha.includes(i) ? ' class="r"' : ""}>${esc(h)}</th>`).join("");
  const tr = filas.map((f) => `<tr>${f.map((c, i) => `<td${alineaDerecha.includes(i) ? ' class="r"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

/** Reporte imprimible (una carta por sección) con el mismo contenido de la pantalla. */
export function htmlReporteRh(d: ReporteRh, organizacion: string, generadoPor: string | null): string {
  const alertas = alertasReporte(d);
  const t = totalesNomina(d.nomina);
  const sec = (titulo: string, cuerpo: string) => `<section><h2>${esc(titulo)}</h2>${cuerpo}</section>`;
  const kpis = (items: [string, string][]) => `<div class="kpis">${items.map(([k, v]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`).join("")}</div>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de recursos humanos · ${esc(organizacion)}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;margin:24px;font-size:12px}
  h1{font-size:20px;margin:0 0 2px} h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #cbd5e1;padding-bottom:3px}
  .sub{color:#475569;margin:0 0 10px}
  .kpis{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 10px}
  .kpi{border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;min-width:110px}
  .kpi .v{font-size:16px;font-weight:600} .kpi .k{color:#64748b;font-size:10px}
  table{border-collapse:collapse;width:100%;margin:4px 0 8px} th,td{border:1px solid #e2e8f0;padding:3px 6px;text-align:left;vertical-align:top}
  th{background:#f1f5f9;font-size:10px;text-transform:uppercase;color:#475569} td.r,th.r{text-align:right}
  .vacio{color:#94a3b8;font-style:italic;margin:2px 0 8px}
  ul.alertas{padding-left:18px;margin:4px 0} li.rojo{color:#b91c1c} li.ambar{color:#b45309}
  ol.resumen{padding-left:18px} h3{font-size:12px;margin:10px 0 2px;break-after:avoid} tr{break-inside:avoid} .kpis{break-inside:avoid}
  @media print{body{margin:12mm}}
</style></head><body>
<h1>Reporte de recursos humanos · director general</h1>
<p class="sub">${esc(organizacion)} · del ${ddmm(d.desde)} al ${ddmm(d.hasta)} (${d.habiles} días hábiles)${generadoPor ? ` · generado por ${esc(generadoPor)}` : ""}</p>
${sec("Resumen ejecutivo", `<ol class="resumen">${resumenEjecutivo(d).map((f) => `<li>${esc(f)}</li>`).join("")}</ol>`)}
${sec("Qué atender", alertas.length ? `<ul class="alertas">${alertas.map((x) => `<li class="${x.nivel}">${esc(x.texto)}</li>`).join("")}</ul>` : `<p class="vacio">Sin pendientes.</p>`)}
${sec(
  "Plantilla",
  kpis([
    ["Activos", n0(d.plantilla.activos)],
    ["Con cuenta", n0(d.plantilla.con_cuenta)],
    ["Checan", n0(d.plantilla.checan)],
    ["Sin jefe directo", n0(d.plantilla.sin_jefe)],
    ["Antigüedad (meses)", d.plantilla.antiguedad_meses == null ? "—" : String(d.plantilla.antiguedad_meses)],
  ]) +
    `<h3>Por empresa</h3>` + tabla(["Empresa", "Personas"], d.plantilla.por_empresa.map((x) => [x.empresa, x.n]), [1]) +
    `<h3>Por área</h3>` + tabla(["Área", "Personas"], d.plantilla.por_area.map((x) => [x.area, x.n]), [1]) +
    `<h3>Altas del periodo</h3>` + tabla(["Nombre", "Puesto", "Empresa", "Ingreso"], d.plantilla.altas.map((x) => [x.nombre, x.puesto, x.empresa, ddmm(x.fecha)])) +
    `<h3>Bajas del periodo</h3>` + tabla(["Nombre", "Puesto", "Baja", "Cuenta"], d.plantilla.bajas.map((x) => [x.nombre, x.puesto, ddmm(x.fecha), x.cuenta_activa ? "ACTIVA" : "cerrada"])) +
    `<h3>Rotación mensual</h3>` + tabla(["Mes", "Altas", "Bajas", "Plantilla al cierre", "Rotación"], d.plantilla.rotacion.map((x) => [x.mes.slice(0, 7), x.altas, x.bajas, x.plantilla_fin, pct(x.rotacion_pct)]), [1, 2, 3, 4]) +
    `<h3>Expedientes incompletos</h3>` + tabla(["Nombre", "Falta"], d.plantilla.expedientes_incompletos.map((x) => [x.nombre, x.faltan])) +
    `<h3>Sin cuenta en el sistema</h3>` + tabla(["Nombre", "Puesto"], d.plantilla.sin_cuenta.map((x) => [x.nombre, x.puesto])),
)}
${sec(
  "Asistencia (checador)",
  kpis([
    ["Asistencia", pct(d.asistencia.pct_asistencia)],
    ["Puntualidad", pct(d.asistencia.pct_puntualidad)],
    ["Días con entrada", n0(d.asistencia.dias_con_entrada)],
    ["Retardos", n0(d.asistencia.retardos)],
    ["No checan", n0(d.asistencia.no_checan.length)],
  ]) +
    `<h3>Menos días con entrada</h3>` + tabla(["Nombre", "Puesto", "Días", "Faltas", "Retardos"], d.asistencia.mas_faltas.map((x) => [x.nombre, x.puesto, x.dias, x.faltas, x.retardos]), [2, 3, 4]) +
    `<h3>Más retardos</h3>` + tabla(["Nombre", "Puesto", "Días", "Retardos"], d.asistencia.mas_retardos.map((x) => [x.nombre, x.puesto, x.dias, x.retardos]), [2, 3]) +
    `<h3>Con cuenta y sin ninguna entrada</h3>` + tabla(["Nombre", "Puesto"], d.asistencia.no_checan.map((x) => [x.nombre, x.puesto])),
)}
${sec(
  "Cumplimiento de tareas",
  kpis([
    ["Del periodo", n0(d.tareas.periodo.total)],
    ["Hechas", `${n0(d.tareas.periodo.hechas)} (${pct(d.tareas.periodo.pct_cumplimiento)})`],
    ["A tiempo", pct(d.tareas.periodo.pct_a_tiempo)],
    ["Vencidas hoy", n0(d.tareas.vencidas)],
    ["Abiertas", n0(d.tareas.abiertas)],
    ["Cambios de fecha", n0(d.tareas.periodo.cambios_fecha)],
  ]) +
    `<h3>Por área</h3>` + tabla(["Área", "Total", "Hechas", "Vencidas"], d.tareas.por_area.map((x) => [x.area, x.total, x.hechas, x.vencidas]), [1, 2, 3]) +
    `<h3>Por persona</h3>` + tabla(["Nombre", "Total", "Hechas", "A tiempo", "Vencidas"], d.tareas.por_persona.map((x) => [x.nombre, x.total, x.hechas, x.a_tiempo, x.vencidas]), [1, 2, 3, 4]),
)}
${sec(
  "Evaluaciones de desempeño",
  kpis([
    ["Firmadas (12 m)", n0(d.evaluaciones.firmadas_12m)],
    ["Promedio", d.evaluaciones.promedio == null ? "—" : String(d.evaluaciones.promedio)],
    ["Borradores", n0(d.evaluaciones.borradores)],
    ["Sin evaluar (6 m)", n0(d.evaluaciones.sin_evaluacion_6m)],
  ]) + tabla(["Nombre", "Puesto", "Calificación", "Nivel", "Fecha", "Evaluó"], d.evaluaciones.ultimas.map((x) => [x.nombre, x.puesto, x.calificacion, x.nivel, ddmm(x.fecha), x.evaluador]), [2]),
)}
${sec(
  "Nómina (backoffice)",
  kpis([
    ["Semanal (última)", moneda(t.semanal)],
    ["Quincenal (última)", moneda(t.quincenal)],
    ["Fiscal total", moneda(t.fiscal)],
    ["Mano de obra (última semana)", moneda(t.manoObra)],
  ]) +
    `<h3>Semanal por empresa</h3>` + tabla(["Empresa", "Semana", "Cierre", "Personas", "Total"], d.nomina.semanal.map((x) => [x.empresa, x.semana, ddmm(x.fin), x.personas, moneda(x.total)]), [3, 4]) +
    `<h3>Quincenal por empresa</h3>` + tabla(["Empresa", "Cierre", "Personas", "Total"], d.nomina.quincenal.map((x) => [x.empresa, ddmm(x.fin), x.personas, moneda(x.total)]), [2, 3]) +
    `<h3>Mano de obra por empresa</h3>` + tabla(["Empresa", "Cierre", "Personas", "Total"], d.nomina.mano_obra.map((x) => [x.empresa, ddmm(x.fin), x.personas, moneda(x.total)]), [2, 3]) +
    `<h3>Nómina semanal, últimas semanas</h3>` + tabla(["Cierre", "Personas", "Total"], d.nomina.semanal_tendencia.map((x) => [ddmm(x.fin), x.personas, moneda(x.total)]), [1, 2]),
)}
${sec(
  "EPP, herramienta y financiamiento",
  kpis([
    ["EPP en uso", n0(d.epp.entregadas)],
    ["EPP vencido", n0(d.epp.vencidas)],
    ["EPP por vencer (30 d)", n0(d.epp.por_vencer_30)],
    ["Solicitudes EPP", n0(d.epp.solicitudes_pendientes)],
    ["Herramienta asignada", n0(d.herramienta.asignadas)],
    ["Regreso vencido", n0(d.herramienta.regreso_vencido)],
    ["Cuentas de nómina", n0(d.financiamiento.cuentas)],
    ["Líneas autorizadas", moneda(d.financiamiento.linea_total)],
    ["Saldo vigente", moneda(d.financiamiento.saldo_vigente)],
    ["Con atraso", n0(d.financiamiento.con_atraso)],
  ]),
)}
${sec(
  "Accesos al sistema",
  kpis([
    ["Cuentas activas", n0(d.accesos.activas)],
    ["Con notificaciones", n0(d.accesos.con_push)],
    ["Sin notificaciones", n0(d.accesos.activas - d.accesos.con_push)],
    ["Esperando rol", n0(d.accesos.pendientes.length)],
  ]) + tabla(["Rol", "Cuentas"], d.accesos.por_rol.map((x) => [x.rol, x.n]), [1]),
)}
</body></html>`;
}
