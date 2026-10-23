// Evaluación de desempeño (23-oct-2026, Mario: "un formato de evaluación de
// desempeño del personal dentro de la aplicación con las tareas cumplidas").
// Parte automática = lo que el sistema sabe (fn_evaluacion_datos: tareas
// hechas, a tiempo, vencidas, cambios de fecha, asistencia); parte del
// evaluador = criterios de 1 a 5 y comentarios. Calificación 0-100 =
// 40 % cumplimiento de tareas + 60 % criterios. Puro, con pruebas; el HTML
// imprimible va con firmas (evaluado, evaluador y RH).

export interface ResumenTareas {
  total: number;
  hechas: number;
  a_tiempo: number;
  tarde: number;
  vencidas: number;
  pendientes: number;
  cambios_fecha: number;
  como_responsable: number;
  dias_con_entrada: number;
  dias_habiles: number;
}

export interface TareaEvaluada {
  id: string;
  titulo: string;
  tablero: string;
  tablero_id: string;
  fecha_limite: string | null;
  hecha: boolean;
  hecha_en: string | null;
  a_tiempo: boolean;
  vencida: boolean;
  responsable: boolean;
  cambios_fecha: number;
}

export interface PersonaEvaluada {
  nombre: string;
  puesto: string | null;
  area: string | null;
  fecha_ingreso: string | null;
  jefe: string | null;
  empresa: string | null;
}

export interface DatosEvaluacion {
  persona: PersonaEvaluada;
  resumen: ResumenTareas;
  tareas: TareaEvaluada[];
}

export const CRITERIOS: { clave: string; etiqueta: string; descripcion: string }[] = [
  { clave: "calidad", etiqueta: "Calidad del trabajo", descripcion: "lo entrega completo, bien hecho y sin retrabajos" },
  { clave: "puntualidad", etiqueta: "Puntualidad y asistencia", descripcion: "llega a tiempo, avisa y cumple su jornada" },
  { clave: "responsabilidad", etiqueta: "Responsabilidad", descripcion: "cumple lo que se le asigna sin que se le persiga" },
  { clave: "equipo", etiqueta: "Trabajo en equipo", descripcion: "apoya, comunica y resuelve con los demás" },
  { clave: "iniciativa", etiqueta: "Iniciativa", descripcion: "propone, se adelanta a los problemas y aprende" },
  { clave: "actitud", etiqueta: "Actitud y servicio", descripcion: "trato con compañeros, clientes y proveedores" },
];

export const ESCALA: Record<number, string> = { 1: "Deficiente", 2: "Por debajo", 3: "Cumple", 4: "Supera", 5: "Sobresaliente" };

export const PESO_TAREAS = 0.4;

export type Nivel = "sobresaliente" | "bueno" | "regular" | "bajo" | "sin_datos";
export const ETIQUETA_NIVEL: Record<Nivel, string> = {
  sobresaliente: "Sobresaliente",
  bueno: "Bueno",
  regular: "Regular",
  bajo: "Requiere plan de mejora",
  sin_datos: "Sin calificar",
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Puntos (0-100) del cumplimiento de tareas: 60 % por hechas y 40 % por
 * hechas a tiempo (sobre las hechas); cada cambio de fecha pedido resta 2
 * puntos (hasta 10). Sin tareas en el periodo: null. */
export function puntosTareas(r: ResumenTareas): number | null {
  if (r.total === 0) return null;
  const hechas = (100 * r.hechas) / r.total;
  const aTiempo = r.hechas > 0 ? (100 * r.a_tiempo) / r.hechas : 0;
  const castigo = Math.min(10, 2 * (r.cambios_fecha ?? 0));
  return r1(Math.max(0, hechas * 0.6 + aTiempo * 0.4 - castigo));
}

/** Puntos (0-100) de los criterios calificados (1-5 → 20-100); null sin ninguno. */
export function puntosCriterios(criterios: Record<string, number | null | undefined>): number | null {
  const valores = CRITERIOS.map((c) => criterios[c.clave]).filter((v): v is number => typeof v === "number" && v >= 1 && v <= 5);
  if (!valores.length) return null;
  return r1((valores.reduce((s, v) => s + v, 0) / valores.length) * 20);
}

export function calificar(r: ResumenTareas, criterios: Record<string, number | null | undefined>): { calificacion: number | null; nivel: Nivel; tareas: number | null; criterios: number | null } {
  const t = puntosTareas(r);
  const c = puntosCriterios(criterios);
  let calificacion: number | null;
  if (t === null && c === null) calificacion = null;
  else if (t === null) calificacion = c;
  else if (c === null) calificacion = t;
  else calificacion = r1(t * PESO_TAREAS + c * (1 - PESO_TAREAS));
  return { calificacion, nivel: nivelDe(calificacion), tareas: t, criterios: c };
}

export function nivelDe(calificacion: number | null): Nivel {
  if (calificacion === null) return "sin_datos";
  if (calificacion >= 90) return "sobresaliente";
  if (calificacion >= 75) return "bueno";
  if (calificacion >= 60) return "regular";
  return "bajo";
}

export function criteriosCompletos(criterios: Record<string, number | null | undefined>): boolean {
  return CRITERIOS.every((c) => typeof criterios[c.clave] === "number");
}

/** Periodo sugerido: "mes" = mes anterior completo, "trimestre" = últimos 3
 * meses hasta hoy, "semestre" = últimos 6. */
export function periodoSugerido(hoy: string, tipo: "mes" | "trimestre" | "semestre"): { desde: string; hasta: string } {
  const [y, m] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7))];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (tipo === "mes") {
    const ini = new Date(Date.UTC(y, m - 2, 1));
    const fin = new Date(Date.UTC(y, m - 1, 0));
    return { desde: iso(ini), hasta: iso(fin) };
  }
  const meses = tipo === "trimestre" ? 3 : 6;
  const ini = new Date(Date.UTC(y, m - 1 - meses, Number(hoy.slice(8, 10))));
  return { desde: iso(ini), hasta: hoy };
}

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export interface EvaluacionImpresa {
  nombre: string;
  puesto: string | null;
  empresa: string | null;
  area: string | null;
  jefe: string | null;
  fecha_ingreso: string | null;
  periodo_desde: string;
  periodo_hasta: string;
  evaluador: string | null;
  fecha: string;
  datos: DatosEvaluacion;
  criterios: Record<string, number | null | undefined>;
  fortalezas: string | null;
  mejoras: string | null;
  acuerdos: string | null;
  firmada: boolean;
}

/** Formato imprimible de una hoja (tamaño carta). */
export function htmlEvaluacion(e: EvaluacionImpresa, logoUrl: string | null): string {
  const r = e.datos.resumen;
  const c = calificar(r, e.criterios);
  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : "—");
  const filasTareas = e.datos.tareas
    .map(
      (t) => `<tr><td>${esc(t.titulo)}</td><td>${esc(t.tablero)}</td><td class="c">${fecha(t.fecha_limite)}</td><td class="c">${t.hecha ? fecha(t.hecha_en) : "—"}</td><td class="c">${
        t.hecha ? (t.a_tiempo ? "A tiempo" : "Tarde") : t.vencida ? "Vencida" : "Pendiente"
      }</td></tr>`,
    )
    .join("");
  const filasCriterios = CRITERIOS.map((cr) => {
    const v = e.criterios[cr.clave];
    const casillas = [1, 2, 3, 4, 5].map((n) => `<td class="c">${v === n ? "●" : "○"}</td>`).join("");
    return `<tr><td><b>${esc(cr.etiqueta)}</b><br><span class="g">${esc(cr.descripcion)}</span></td>${casillas}</tr>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Evaluación de desempeño · ${esc(e.nombre)}</title>
<style>
  @page { size: letter; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; }
  h1 { font-size: 16px; margin: 0; } h2 { font-size: 12px; margin: 12px 0 4px; border-bottom: 1px solid #999; padding-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #bbb; padding: 3px 5px; vertical-align: top; } th { background: #eee; text-align: left; }
  .c { text-align: center; } .g { color: #666; font-size: 10px; } .enc { display: flex; justify-content: space-between; align-items: flex-start; }
  .caja { border: 1px solid #bbb; padding: 6px; min-height: 48px; white-space: pre-wrap; }
  .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin: 6px 0; } .kpi { border: 1px solid #bbb; padding: 4px 6px; } .kpi b { font-size: 15px; display: block; }
  .final { font-size: 13px; margin-top: 8px; } .firmas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 36px; text-align: center; } .firmas div { border-top: 1px solid #333; padding-top: 4px; }
  .sello { color: #b00; font-weight: bold; font-size: 10px; }
</style></head><body>
<div class="enc"><div>${logoUrl ? `<img src="${esc(logoUrl)}" alt="" style="max-height:40px;max-width:160px">` : ""}<h1>Evaluación de desempeño</h1>
<div class="g">Periodo ${fecha(e.periodo_desde)} al ${fecha(e.periodo_hasta)} · generada el ${fecha(e.fecha)}${e.firmada ? ' · <span class="sello">FIRMADA</span>' : ' · <span class="sello">BORRADOR</span>'}</div></div></div>
<h2>Datos de la persona</h2>
<table><tr><th style="width:18%">Nombre</th><td>${esc(e.nombre)}</td><th style="width:14%">Puesto</th><td>${esc(e.puesto)}</td></tr>
<tr><th>Empresa / área</th><td>${esc([e.empresa, e.area].filter(Boolean).join(" · "))}</td><th>Jefe directo</th><td>${esc(e.jefe)}</td></tr>
<tr><th>Ingreso</th><td>${fecha(e.fecha_ingreso)}</td><th>Evaluó</th><td>${esc(e.evaluador)}</td></tr></table>
<h2>Cumplimiento de tareas (del sistema)</h2>
<div class="kpis">
  <div class="kpi">Asignadas<b>${r.total}</b></div>
  <div class="kpi">Hechas<b>${r.hechas} <span class="g">${pct(r.hechas, r.total)}</span></b></div>
  <div class="kpi">A tiempo<b>${r.a_tiempo} <span class="g">${pct(r.a_tiempo, r.hechas)}</span></b></div>
  <div class="kpi">Vencidas<b>${r.vencidas}</b></div>
  <div class="kpi">Cambios de fecha<b>${r.cambios_fecha}</b></div>
  <div class="kpi">Días con entrada<b>${r.dias_con_entrada} <span class="g">de ${r.dias_habiles} hábiles</span></b></div>
</div>
<table><thead><tr><th>Tarea</th><th>Tablero</th><th class="c">Fecha límite</th><th class="c">Terminada</th><th class="c">Resultado</th></tr></thead>
<tbody>${filasTareas || '<tr><td colspan="5" class="c g">Sin tareas asignadas en el periodo.</td></tr>'}</tbody></table>
<h2>Criterios del evaluador</h2>
<table><thead><tr><th>Criterio</th><th class="c">1<br><span class="g">Deficiente</span></th><th class="c">2<br><span class="g">Por debajo</span></th><th class="c">3<br><span class="g">Cumple</span></th><th class="c">4<br><span class="g">Supera</span></th><th class="c">5<br><span class="g">Sobresaliente</span></th></tr></thead>
<tbody>${filasCriterios}</tbody></table>
<h2>Fortalezas</h2><div class="caja">${esc(e.fortalezas)}</div>
<h2>Áreas de mejora</h2><div class="caja">${esc(e.mejoras)}</div>
<h2>Acuerdos y compromisos para el siguiente periodo</h2><div class="caja">${esc(e.acuerdos)}</div>
<div class="final"><b>Calificación: ${c.calificacion === null ? "—" : `${c.calificacion} / 100`}</b> · ${esc(ETIQUETA_NIVEL[c.nivel])}
<span class="g">(tareas ${c.tareas ?? "—"} × ${Math.round(PESO_TAREAS * 100)} % + criterios ${c.criterios ?? "—"} × ${Math.round((1 - PESO_TAREAS) * 100)} %)</span></div>
<div class="firmas"><div>${esc(e.nombre)}<br><span class="g">Persona evaluada</span></div><div>${esc(e.evaluador ?? "")}<br><span class="g">Evaluó</span></div><div>&nbsp;<br><span class="g">Recursos humanos</span></div></div>
</body></html>`;
}
