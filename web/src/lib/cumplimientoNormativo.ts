// Cumplimiento (18-oct-2026, Mario: "implementar estos pasos en todos mis
// procesos": cambios normativos, revisar controles, informe de incidencia,
// informe al comité y flujos de control). Reglas puras para las pantallas de
// /cumplimiento y los dos informes imprimibles; los periodos replican
// fn_cumplimiento_periodo / fn_cumplimiento_rango de la base.

export type Frecuencia = "mensual" | "trimestral";
export type ResultadoPrueba = "cumple" | "excepciones" | "no_cumple" | "no_aplica";
export type Severidad = "baja" | "media" | "alta" | "critica";
export type EstatusNorma = "por_analizar" | "en_implementacion" | "cumplida" | "no_aplica";
export type EstatusIncidencia = "abierta" | "contenida" | "cerrada";
export type Semaforo = "verde" | "ambar" | "rojo" | "gris";

export const ETIQUETA_AREA: Record<string, string> = {
  finanzas: "Finanzas",
  tesoreria: "Tesorería",
  contabilidad: "Contabilidad",
  compras: "Compras",
  rh: "Recursos humanos",
  legal: "Legal",
  almacen: "Almacén",
  seguridad: "Seguridad e higiene",
  sistemas: "Sistemas y accesos",
  direccion: "Dirección",
  otro: "Otro",
};

export const ETIQUETA_AUTORIDAD: Record<string, string> = {
  sat: "SAT",
  imss: "IMSS",
  infonavit: "INFONAVIT",
  stps: "STPS",
  semarnat: "SEMARNAT",
  proteccion_civil: "Protección civil",
  municipal: "Municipio",
  estatal: "Gobierno del estado",
  cliente: "Cliente (contrato)",
  interna: "Política interna",
  otra: "Otra",
};

export const ETIQUETA_RESULTADO: Record<ResultadoPrueba, string> = {
  cumple: "Cumple",
  excepciones: "Con excepciones",
  no_cumple: "No cumple",
  no_aplica: "No aplica",
};

export const SEMAFORO_RESULTADO: Record<ResultadoPrueba, Semaforo> = {
  cumple: "verde",
  excepciones: "ambar",
  no_cumple: "rojo",
  no_aplica: "gris",
};

export const CLASE_SEMAFORO: Record<Semaforo, string> = {
  verde: "bg-emerald-50 text-emerald-700",
  ambar: "bg-amber-100 text-amber-800",
  rojo: "bg-red-50 text-red-700",
  gris: "bg-slate-100 text-slate-500",
};

export const ETIQUETA_SEVERIDAD: Record<Severidad, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  critica: "Crítica",
};

export const CLASE_SEVERIDAD: Record<Severidad, string> = {
  baja: "bg-slate-100 text-slate-600",
  media: "bg-amber-100 text-amber-800",
  alta: "bg-orange-100 text-orange-800",
  critica: "bg-red-100 text-red-800",
};

export const ETIQUETA_ESTATUS_NORMA: Record<EstatusNorma, string> = {
  por_analizar: "Por analizar",
  en_implementacion: "En implementación",
  cumplida: "Cumplida",
  no_aplica: "No nos aplica",
};

export const ETIQUETA_ESTATUS_INCIDENCIA: Record<EstatusIncidencia, string> = {
  abierta: "Abierta",
  contenida: "Contenida",
  cerrada: "Cerrada",
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function partes(iso: string): [number, number, number] {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [a, m, d];
}

function iso(a: number, m: number, d: number): string {
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function ultimoDia(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Suma días a una fecha ISO (sin zona horaria). */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = partes(fecha);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** '2026-10' (mensual) o '2026-T4' (trimestral). */
export function periodoDe(fecha: string, frecuencia: Frecuencia): string {
  const [a, m] = partes(fecha);
  return frecuencia === "trimestral" ? `${a}-T${Math.ceil(m / 3)}` : `${a}-${String(m).padStart(2, "0")}`;
}

export function rangoPeriodo(periodo: string): { desde: string; hasta: string } {
  const t = periodo.match(/^(\d{4})-T([1-4])$/);
  if (t) {
    const a = Number(t[1]);
    const m1 = (Number(t[2]) - 1) * 3 + 1;
    return { desde: iso(a, m1, 1), hasta: iso(a, m1 + 2, ultimoDia(a, m1 + 2)) };
  }
  const m = periodo.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`Periodo no válido: ${periodo}`);
  const a = Number(m[1]);
  const mes = Number(m[2]);
  return { desde: iso(a, mes, 1), hasta: iso(a, mes, ultimoDia(a, mes)) };
}

export function periodoAnterior(periodo: string): string {
  const { desde } = rangoPeriodo(periodo);
  return periodoDe(sumarDias(desde, -1), periodo.includes("-T") ? "trimestral" : "mensual");
}

export function etiquetaPeriodo(periodo: string): string {
  const t = periodo.match(/^(\d{4})-T([1-4])$/);
  if (t) return `${["1er", "2º", "3er", "4º"][Number(t[2]) - 1]} trimestre ${t[1]}`;
  const [a, m] = periodo.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

/** Los últimos n periodos hasta el de la fecha dada (del más viejo al actual). */
export function periodosHasta(fecha: string, frecuencia: Frecuencia, n: number): string[] {
  const lista = [periodoDe(fecha, frecuencia)];
  while (lista.length < n) lista.unshift(periodoAnterior(lista[0]));
  return lista;
}

/** Mes de un periodo mensual dentro del trimestre que se elija (para comparar
 * controles mensuales y trimestrales en el informe trimestral). */
export function periodoDelControl(periodoInforme: string, frecuencia: Frecuencia): string {
  if (frecuencia === "trimestral") return periodoDe(rangoPeriodo(periodoInforme).hasta, "trimestral");
  return periodoDe(rangoPeriodo(periodoInforme).hasta, "mensual");
}

/** Resultado de una prueba automática con la misma regla que la base. */
export function resultadoDe(poblacion: number, excepciones: number, toleranciaPct: number): ResultadoPrueba {
  if (excepciones === 0) return "cumple";
  if (poblacion > 0 && (excepciones * 100) / poblacion <= toleranciaPct) return "excepciones";
  return "no_cumple";
}

export interface PruebaResumen {
  id: string;
  control_id: string;
  periodo: string;
  resultado: ResultadoPrueba;
  poblacion: number | null;
  excepciones: number | null;
  created_at: string;
}

/** La revisión que cuenta para un control en un periodo: la más reciente. */
export function ultimaPrueba<T extends PruebaResumen>(pruebas: T[], controlId: string, periodo: string): T | null {
  let mejor: T | null = null;
  for (const p of pruebas) {
    if (p.control_id !== controlId || p.periodo !== periodo) continue;
    if (!mejor || p.created_at > mejor.created_at) mejor = p;
  }
  return mejor;
}

export interface ControlResumen {
  id: string;
  clave: string;
  nombre: string;
  area: string;
  frecuencia: Frecuencia;
  prueba: string | null;
  activo: boolean;
  responsable_nombre?: string | null;
}

export type EstadoFlujo = "revisado" | "por_revisar" | "atrasado";

/** Flujo de control: ¿ya se revisó en el periodo actual? Atrasado = tampoco se
 * revisó el periodo que ya cerró. */
export function estadoFlujo(control: ControlResumen, pruebas: PruebaResumen[], hoy: string): { periodo: string; estado: EstadoFlujo; prueba: PruebaResumen | null } {
  const periodo = periodoDe(hoy, control.frecuencia);
  const prueba = ultimaPrueba(pruebas, control.id, periodo);
  if (prueba) return { periodo, estado: "revisado", prueba };
  const anterior = ultimaPrueba(pruebas, control.id, periodoAnterior(periodo));
  return { periodo, estado: anterior ? "por_revisar" : "atrasado", prueba: null };
}

/** Semáforo de varios resultados: rojo si alguno no cumple, ámbar si hay
 * excepciones o falta revisar, verde si todo cumple. */
export function semaforoGeneral(resultados: (ResultadoPrueba | null)[]): Semaforo {
  if (!resultados.length) return "gris";
  if (resultados.includes("no_cumple")) return "rojo";
  if (resultados.some((r) => r === null || r === "excepciones")) return "ambar";
  return "verde";
}

// --- 1. Cambio normativo → tareas del lunes ------------------------------------

export interface AccionPropuesta {
  texto: string;
  fecha: string;
}

/** El lunes siguiente (o el mismo día si ya es lunes). */
export function proximoLunes(hoy: string): string {
  const [a, m, d] = partes(hoy);
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 domingo
  return sumarDias(hoy, dia === 1 ? 0 : (8 - dia) % 7);
}

/** Plantilla para volver una norma trabajo: cinco pasos, el primero el lunes,
 * uno por semana y sin pasar de la entrada en vigor (si ya está cerca, se
 * aprietan hacia esa fecha, nunca antes de hoy). */
export function accionesSugeridas(norma: { titulo: string; fecha_vigor?: string | null; areas?: string[] }, hoy: string): AccionPropuesta[] {
  const areas = (norma.areas ?? []).map((a) => ETIQUETA_AREA[a] ?? a).join(", ");
  const textos = [
    `Leer «${norma.titulo}» y resumir en una hoja qué nos aplica`,
    `Identificar procesos, formatos y personas afectadas${areas ? ` (${areas})` : ""}`,
    "Ajustar el proceso, formato o sistema que cambia",
    "Avisar y capacitar a las personas afectadas",
    "Definir cómo comprobaremos que se cumple (control en Cumplimiento)",
  ];
  const inicio = proximoLunes(hoy);
  const limite = norma.fecha_vigor && norma.fecha_vigor >= hoy ? norma.fecha_vigor : null;
  return textos.map((texto, i) => {
    let fecha = sumarDias(inicio, i * 7);
    if (limite && fecha > limite) fecha = limite < hoy ? hoy : limite;
    return { texto, fecha };
  });
}

/** Días para la entrada en vigor (negativo = ya entró). */
export function diasParaVigor(fechaVigor: string | null | undefined, hoy: string): number | null {
  if (!fechaVigor) return null;
  const [a1, m1, d1] = partes(hoy);
  const [a2, m2, d2] = partes(fechaVigor);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

// --- 3. Informe de incidencia -------------------------------------------------

export interface Incidencia {
  folio: string | null;
  titulo: string;
  empresa?: string | null;
  detectada_el: string;
  ocurrio_el?: string | null;
  severidad: Severidad;
  area: string;
  que_paso?: string | null;
  impacto?: string | null;
  monto_estimado?: number | null;
  personas_afectadas?: string | null;
  causa?: string | null;
  acciones_inmediatas?: string | null;
  acciones_correctivas?: string | null;
  proxima_actualizacion?: string | null;
  estatus: EstatusIncidencia;
  responsable_nombre?: string | null;
  created_by_nombre?: string | null;
}

export function fechaLarga(fecha: string | null | undefined): string {
  if (!fecha) return "";
  const [a, m, d] = partes(fecha);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

const pesos = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

/** Lo que falta para que el informe se pueda mandar: sin esto no se entiende. */
export function faltantesIncidencia(i: Incidencia): string[] {
  const faltan: string[] = [];
  if (!i.que_paso?.trim()) faltan.push("qué pasó");
  if (!i.impacto?.trim()) faltan.push("a quién o qué afecta");
  if (!i.acciones_inmediatas?.trim()) faltan.push("qué se hizo ya");
  if (!i.proxima_actualizacion) faltan.push("cuándo se vuelve a informar");
  return faltan;
}

/** Texto para WhatsApp o correo: con calma, en orden, sin adjetivos. */
export function textoIncidencia(i: Incidencia): string {
  const lineas = [
    `*Informe de incidencia ${i.folio ?? ""}*`.replace(" *", "*"),
    `${i.titulo}${i.empresa ? ` · ${i.empresa}` : ""}`,
    `Severidad: ${ETIQUETA_SEVERIDAD[i.severidad]} · Estatus: ${ETIQUETA_ESTATUS_INCIDENCIA[i.estatus]}`,
    "",
    `*Qué pasó:* ${i.que_paso?.trim() || "En revisión."}`,
    `*Qué significa:* ${i.impacto?.trim() || "Se está evaluando."}${i.monto_estimado ? ` Monto estimado ${pesos(i.monto_estimado)}.` : ""}`,
    `*Qué hicimos ya:* ${i.acciones_inmediatas?.trim() || "Se está atendiendo."}`,
  ];
  if (i.acciones_correctivas?.trim()) lineas.push(`*Qué sigue:* ${i.acciones_correctivas.trim()}`);
  if (i.responsable_nombre) lineas.push(`*Responsable:* ${i.responsable_nombre}`);
  if (i.proxima_actualizacion) lineas.push(`*Próxima actualización:* ${fechaLarga(i.proxima_actualizacion)}`);
  return lineas.join("\n");
}

function esc(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parrafos(s: string | null | undefined, vacio: string): string {
  const t = (s ?? "").trim();
  if (!t) return `<p class="vacio">${esc(vacio)}</p>`;
  return t.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("");
}

const ESTILO_BASE = `
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:0;padding:28px;font-size:12.5px;line-height:1.45}
  h1{font-size:18px;margin:0} h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#475569;margin:16px 0 4px;border-bottom:1px solid #e2e8f0;padding-bottom:2px}
  p{margin:2px 0 6px} .vacio{color:#94a3b8;font-style:italic} .chip{display:inline-block;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:bold}
  .verde{background:#d1fae5;color:#065f46} .ambar{background:#fef3c7;color:#92400e} .rojo{background:#fee2e2;color:#991b1b} .gris{background:#f1f5f9;color:#475569}
  .meta{color:#475569;font-size:11.5px} table{width:100%;border-collapse:collapse;font-size:11.5px} th,td{border-bottom:1px solid #e2e8f0;padding:4px 5px;text-align:left;vertical-align:top}
  th{background:#f8fafc;font-size:10.5px;text-transform:uppercase;color:#475569} .num{text-align:right;white-space:nowrap}
  .firmas{display:flex;gap:40px;margin-top:40px} .firmas div{flex:1;border-top:1px solid #0f172a;padding-top:4px;text-align:center;font-size:11px}
  @media print{body{padding:0} @page{margin:14mm}}`;

const SEMAFORO_SEVERIDAD: Record<Severidad, Semaforo> = { baja: "gris", media: "ambar", alta: "rojo", critica: "rojo" };

export function htmlInformeIncidencia(i: Incidencia, emitido: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Incidencia ${esc(i.folio)}</title><style>${ESTILO_BASE}</style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
    <div><div class="meta">Informe de incidencia${i.empresa ? ` · ${esc(i.empresa)}` : ""}</div><h1>${esc(i.titulo)}</h1></div>
    <div style="text-align:right"><div style="font-weight:bold">${esc(i.folio)}</div>
      <span class="chip ${SEMAFORO_SEVERIDAD[i.severidad]}">Severidad ${esc(ETIQUETA_SEVERIDAD[i.severidad])}</span>
      <div class="meta">${esc(ETIQUETA_ESTATUS_INCIDENCIA[i.estatus])}</div></div>
  </div>
  <p class="meta">Detectada el ${esc(fechaLarga(i.detectada_el))}${i.ocurrio_el ? ` · ocurrió el ${esc(fechaLarga(i.ocurrio_el))}` : ""} · Área: ${esc(ETIQUETA_AREA[i.area] ?? i.area)}${i.responsable_nombre ? ` · Responsable: ${esc(i.responsable_nombre)}` : ""}</p>
  <h2>1. Qué pasó</h2>${parrafos(i.que_paso, "En revisión.")}
  <h2>2. Qué significa</h2>${parrafos(i.impacto, "Se está evaluando el impacto.")}
  ${i.monto_estimado || i.personas_afectadas ? `<p>${i.monto_estimado ? `Monto estimado: <b>${esc(pesos(i.monto_estimado))}</b>. ` : ""}${i.personas_afectadas ? `Afectados: ${esc(i.personas_afectadas)}.` : ""}</p>` : ""}
  <h2>3. Por qué pasó</h2>${parrafos(i.causa, "Causa en análisis.")}
  <h2>4. Qué hicimos ya</h2>${parrafos(i.acciones_inmediatas, "Se está atendiendo.")}
  <h2>5. Qué sigue</h2>${parrafos(i.acciones_correctivas, "Por definir.")}
  <h2>6. Próxima actualización</h2><p>${i.proxima_actualizacion ? esc(fechaLarga(i.proxima_actualizacion)) : "Al cerrar la incidencia."}</p>
  <div class="firmas"><div>Elaboró${i.created_by_nombre ? `<br>${esc(i.created_by_nombre)}` : ""}</div><div>Responsable${i.responsable_nombre ? `<br>${esc(i.responsable_nombre)}` : ""}</div><div>Enterado (dirección)</div></div>
  <p class="meta" style="margin-top:16px">Emitido el ${esc(fechaLarga(emitido))}.</p>
  </body></html>`;
}

// --- 4. Informe al comité: una página -----------------------------------------

export interface FilaComite {
  clave: string;
  nombre: string;
  area: string;
  actual: ResultadoPrueba | null;
  anterior: ResultadoPrueba | null;
  excepciones: number | null;
  poblacion: number | null;
  tendencia: "mejora" | "empeora" | "igual" | "nuevo";
}

export interface ResumenComite {
  periodo: string;
  semaforo: Semaforo;
  controles: FilaComite[];
  incidencias: { abiertas: number; nuevas: number; cerradas: number; graves: { folio: string | null; titulo: string; severidad: Severidad; estatus: EstatusIncidencia }[] };
  normas: { pendientes: number; proximas: { titulo: string; fecha_vigor: string | null; estatus: EstatusNorma }[] };
  mensajes: string[];
}

const ORDEN_RESULTADO: Record<ResultadoPrueba, number> = { no_cumple: 0, excepciones: 1, cumple: 2, no_aplica: 3 };

function tendencia(actual: ResultadoPrueba | null, anterior: ResultadoPrueba | null): FilaComite["tendencia"] {
  if (!actual || !anterior) return "nuevo";
  if (ORDEN_RESULTADO[actual] > ORDEN_RESULTADO[anterior]) return "mejora";
  if (ORDEN_RESULTADO[actual] < ORDEN_RESULTADO[anterior]) return "empeora";
  return "igual";
}

export function resumenComite(datos: {
  periodo: string; // trimestre '2026-T4' o mes '2026-10'
  controles: ControlResumen[];
  pruebas: PruebaResumen[];
  incidencias: (Incidencia & { cerrada_en?: string | null })[];
  normas: { titulo: string; fecha_vigor: string | null; estatus: EstatusNorma }[];
  hoy: string;
}): ResumenComite {
  const { desde, hasta } = rangoPeriodo(datos.periodo);
  const filas: FilaComite[] = datos.controles
    .filter((c) => c.activo)
    .map((c) => {
      const p = periodoDelControl(datos.periodo, c.frecuencia);
      const actual = ultimaPrueba(datos.pruebas, c.id, p);
      const anterior = ultimaPrueba(datos.pruebas, c.id, periodoAnterior(p));
      return {
        clave: c.clave,
        nombre: c.nombre,
        area: c.area,
        actual: actual?.resultado ?? null,
        anterior: anterior?.resultado ?? null,
        excepciones: actual?.excepciones ?? null,
        poblacion: actual?.poblacion ?? null,
        tendencia: tendencia(actual?.resultado ?? null, anterior?.resultado ?? null),
      };
    })
    .sort((a, b) => (a.actual ? ORDEN_RESULTADO[a.actual] : 1.5) - (b.actual ? ORDEN_RESULTADO[b.actual] : 1.5) || a.clave.localeCompare(b.clave));

  const enPeriodo = (f: string | null | undefined) => !!f && f >= desde && f <= hasta;
  const abiertas = datos.incidencias.filter((i) => i.estatus !== "cerrada");
  const graves = datos.incidencias
    .filter((i) => (i.severidad === "alta" || i.severidad === "critica") && (i.estatus !== "cerrada" || enPeriodo(i.detectada_el)))
    .map((i) => ({ folio: i.folio, titulo: i.titulo, severidad: i.severidad, estatus: i.estatus }));
  const pendientesNorma = datos.normas.filter((n) => n.estatus === "por_analizar" || n.estatus === "en_implementacion");
  const proximas = pendientesNorma
    .slice()
    .sort((a, b) => (a.fecha_vigor ?? "9999").localeCompare(b.fecha_vigor ?? "9999"))
    .slice(0, 5);

  const noCumplen = filas.filter((f) => f.actual === "no_cumple");
  const sinRevisar = filas.filter((f) => !f.actual);
  const empeoran = filas.filter((f) => f.tendencia === "empeora");
  const mensajes: string[] = [];
  const revisados = filas.length - sinRevisar.length;
  mensajes.push(`${revisados} de ${filas.length} controles revisados; ${filas.filter((f) => f.actual === "cumple").length} cumplen.`);
  if (noCumplen.length) mensajes.push(`No cumplen: ${noCumplen.map((f) => f.nombre).join("; ")}.`);
  if (empeoran.length) mensajes.push(`Empeoraron contra el periodo anterior: ${empeoran.map((f) => f.nombre).join("; ")}.`);
  if (sinRevisar.length) mensajes.push(`Falta revisar: ${sinRevisar.map((f) => f.nombre).join("; ")}.`);
  if (abiertas.length) mensajes.push(`${abiertas.length} incidencia(s) abierta(s)${graves.length ? `, ${graves.length} alta(s) o crítica(s)` : ""}.`);
  const vencidas = pendientesNorma.filter((n) => n.fecha_vigor && n.fecha_vigor < datos.hoy);
  if (vencidas.length) mensajes.push(`${vencidas.length} norma(s) ya en vigor sin terminar de implementar.`);

  return {
    periodo: datos.periodo,
    semaforo: noCumplen.length || graves.some((g) => g.estatus !== "cerrada") ? "rojo" : semaforoGeneral(filas.map((f) => f.actual)),
    controles: filas,
    incidencias: {
      abiertas: abiertas.length,
      nuevas: datos.incidencias.filter((i) => enPeriodo(i.detectada_el)).length,
      cerradas: datos.incidencias.filter((i) => enPeriodo(i.cerrada_en)).length,
      graves,
    },
    normas: { pendientes: pendientesNorma.length, proximas },
    mensajes,
  };
}

const FLECHA: Record<FilaComite["tendencia"], string> = { mejora: "▲ mejora", empeora: "▼ empeora", igual: "= igual", nuevo: "—" };

export function htmlInformeComite(r: ResumenComite, extra: { organizacion: string; decisiones?: string; elaboro?: string | null; emitido: string }): string {
  const chip = (res: ResultadoPrueba | null) =>
    res ? `<span class="chip ${SEMAFORO_RESULTADO[res]}">${esc(ETIQUETA_RESULTADO[res])}</span>` : `<span class="chip ambar">Sin revisar</span>`;
  const titulo = { verde: "En orden", ambar: "Con pendientes", rojo: "Requiere atención", gris: "Sin datos" }[r.semaforo];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe al comité ${esc(etiquetaPeriodo(r.periodo))}</title><style>${ESTILO_BASE}
    body{font-size:11.5px} h2{margin-top:10px}</style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div><div class="meta">${esc(extra.organizacion)} · Informe de cumplimiento al comité</div><h1>${esc(etiquetaPeriodo(r.periodo))}</h1></div>
    <span class="chip ${r.semaforo}" style="font-size:13px;padding:4px 12px">${esc(titulo)}</span>
  </div>
  <h2>Lo importante</h2><ul style="margin:2px 0 0 18px;padding:0">${r.mensajes.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
  <h2>Controles</h2>
  <table><thead><tr><th>Control</th><th>Área</th><th>Resultado</th><th class="num">Excepciones</th><th>vs. anterior</th></tr></thead><tbody>
  ${r.controles.map((f) => `<tr><td><b>${esc(f.clave)}</b> ${esc(f.nombre)}</td><td>${esc(ETIQUETA_AREA[f.area] ?? f.area)}</td><td>${chip(f.actual)}</td><td class="num">${f.excepciones == null ? "—" : `${f.excepciones}${f.poblacion ? ` de ${f.poblacion}` : ""}`}</td><td>${esc(FLECHA[f.tendencia])}</td></tr>`).join("")}
  </tbody></table>
  <div style="display:flex;gap:20px">
    <div style="flex:1"><h2>Incidencias</h2>
      <p>${r.incidencias.nuevas} nuevas en el periodo · ${r.incidencias.cerradas} cerradas · <b>${r.incidencias.abiertas} abiertas</b></p>
      ${r.incidencias.graves.length ? `<ul style="margin:0 0 0 18px;padding:0">${r.incidencias.graves.map((g) => `<li>${esc(g.folio)} ${esc(g.titulo)} — ${esc(ETIQUETA_SEVERIDAD[g.severidad])}, ${esc(ETIQUETA_ESTATUS_INCIDENCIA[g.estatus].toLowerCase())}</li>`).join("")}</ul>` : `<p class="vacio">Sin incidencias altas o críticas.</p>`}
    </div>
    <div style="flex:1"><h2>Cambios normativos</h2>
      <p><b>${r.normas.pendientes}</b> por implementar</p>
      ${r.normas.proximas.length ? `<ul style="margin:0 0 0 18px;padding:0">${r.normas.proximas.map((n) => `<li>${esc(n.titulo)}${n.fecha_vigor ? ` — en vigor ${esc(fechaLarga(n.fecha_vigor))}` : ""}</li>`).join("")}</ul>` : `<p class="vacio">Nada pendiente.</p>`}
    </div>
  </div>
  <h2>Decisiones que se piden al comité</h2>${parrafos(extra.decisiones, "Ninguna.")}
  <p class="meta" style="margin-top:12px">Elaboró ${esc(extra.elaboro ?? "")} · ${esc(fechaLarga(extra.emitido))}</p>
  </body></html>`;
}
