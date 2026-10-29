// Reporte de RH de tiempos y checador (29-oct-2026, Mario: "el reporte del
// área de RH a manera de información más específica en cuanto tiempos y
// checador"). La base (`fn_reporte_rh_tiempos`) entrega por persona el
// resumen del periodo y por persona y día las marcas; aquí viven las reglas
// puras: formato de horas, semáforo por persona, orden, resumen, CSV y HTML
// imprimible. Sin DOM: se prueba en node.

export interface PersonaTiempos {
  personal_id: string;
  profile_id: string;
  nombre: string;
  puesto: string | null;
  area: string | null;
  empresa: string | null;
  jornada: string;
  hora_entrada: string;
  tolerancia: number;
  horas_semana: number;
  dias_semana: number;
  habiles: number;
  dias_con_entrada: number;
  faltas: number;
  retardos: number;
  retardo_min_total: number;
  entrada_prom: string | null;
  salida_prom: string | null;
  minutos_total: number;
  dias_completos: number;
  minutos_esperados: number;
  dias_sin_salida: number;
  dias_con_comida: number;
  comida_prom_min: number | null;
  manuales: number;
  offline: number;
  anuladas: number;
  ubicacion: string | null;
}

export interface DiaTiempos {
  profile_id: string;
  fecha: string;
  entrada: string | null;
  comida_inicio: string | null;
  comida_fin: string | null;
  salida: string | null;
  minutos: number | null;
  comida_min: number | null;
  retardo_min: number;
  manuales: number;
  offline: number;
  anuladas: number;
}

export interface ReporteTiempos {
  desde: string;
  hasta: string;
  resumen: { personas: number; checan: number; dias_con_entrada: number; faltas: number; retardos: number; minutos_total: number; dias_sin_salida: number; manuales: number; offline: number; anuladas: number };
  personas: PersonaTiempos[];
  detalle: DiaTiempos[];
  por_dia: { fecha: string; entradas: number; retardos: number; minutos: number }[];
}

export type Semaforo = "verde" | "ambar" | "rojo" | "gris";

/** "7 h 45 m"; null → "—". */
export function horas(min: number | null | undefined): string {
  if (min == null) return "—";
  const m = Math.round(Number(min));
  const h = Math.floor(Math.abs(m) / 60);
  const r = Math.abs(m) % 60;
  return `${m < 0 ? "−" : ""}${h} h ${String(r).padStart(2, "0")} m`;
}

export function ddmm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export function diaSemana(iso: string): string {
  return DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}

export function pct(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n)} %`;
}

/** Asistencia de la persona sobre sus días hábiles (0-100) o null si no checó. */
export function pctAsistencia(p: PersonaTiempos): number | null {
  if (p.habiles === 0 || p.dias_con_entrada === 0) return null;
  return Math.min(100, Math.round((100 * p.dias_con_entrada) / p.habiles));
}

/** Puntualidad: días sin retardo sobre días con entrada. */
export function pctPuntualidad(p: PersonaTiempos): number | null {
  if (p.dias_con_entrada === 0) return null;
  return Math.round((100 * (p.dias_con_entrada - p.retardos)) / p.dias_con_entrada);
}

/** Horas activas por día completo (entrada y salida). */
export function minutosPorDia(p: PersonaTiempos): number | null {
  return p.dias_completos === 0 ? null : Math.round(p.minutos_total / p.dias_completos);
}

/** Horas activas contra las esperadas por su jornada en los días completos. */
export function diferenciaHoras(p: PersonaTiempos): number | null {
  return p.dias_completos === 0 ? null : p.minutos_total - p.minutos_esperados;
}

/** Semáforo de la persona: rojo si no checa o falta mucho / llega tarde
 * casi siempre; ámbar si hay faltas, retardos o salidas sin marcar; verde si
 * cumple. */
export function semaforoPersona(p: PersonaTiempos): { s: Semaforo; motivo: string } {
  if (p.dias_con_entrada === 0) return { s: "rojo", motivo: "no marcó ninguna entrada" };
  const asis = pctAsistencia(p) ?? 0;
  const punt = pctPuntualidad(p) ?? 100;
  const motivos: string[] = [];
  if (asis < 70) motivos.push(`${p.faltas} faltas`);
  if (punt < 50) motivos.push(`${p.retardos} retardos`);
  if (motivos.length) return { s: "rojo", motivo: motivos.join(", ") };
  if (asis < 90) motivos.push(`${p.faltas} faltas`);
  if (punt < 80) motivos.push(`${p.retardos} retardos`);
  if (p.dias_sin_salida >= 3) motivos.push(`${p.dias_sin_salida} días sin salida`);
  const dif = diferenciaHoras(p);
  if (dif != null && dif < -p.dias_completos * 60) motivos.push(`${horas(-dif)} menos que su jornada`);
  if (motivos.length) return { s: "ambar", motivo: motivos.join(", ") };
  return { s: "verde", motivo: "cumple" };
}

export type OrdenPersonas = "semaforo" | "nombre" | "faltas" | "retardos" | "horas";

/** Ordena para la pantalla y el reporte: lo rojo primero. */
export function ordenarPersonas(lista: PersonaTiempos[], orden: OrdenPersonas = "semaforo"): PersonaTiempos[] {
  const peso: Record<Semaforo, number> = { rojo: 0, ambar: 1, verde: 2, gris: 3 };
  const copia = [...lista];
  copia.sort((a, b) => {
    if (orden === "nombre") return a.nombre.localeCompare(b.nombre, "es");
    if (orden === "faltas") return b.faltas - a.faltas || a.nombre.localeCompare(b.nombre, "es");
    if (orden === "retardos") return b.retardos - a.retardos || b.retardo_min_total - a.retardo_min_total || a.nombre.localeCompare(b.nombre, "es");
    if (orden === "horas") return b.minutos_total - a.minutos_total || a.nombre.localeCompare(b.nombre, "es");
    const sa = semaforoPersona(a).s;
    const sb = semaforoPersona(b).s;
    return peso[sa] - peso[sb] || b.faltas - a.faltas || b.retardos - a.retardos || a.nombre.localeCompare(b.nombre, "es");
  });
  return copia;
}

/** Busca sin acentos por nombre, puesto, área o empresa. */
export function filtrarPersonas(lista: PersonaTiempos[], texto: string): PersonaTiempos[] {
  const q = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (!q) return lista;
  return lista.filter((p) =>
    [p.nombre, p.puesto ?? "", p.area ?? "", p.empresa ?? ""]
      .join(" ")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .includes(q),
  );
}

/** Cuánta gente comparte el perfil base (si es todos, las horas de entrada no son las reales). */
export function conPerfilBase(lista: PersonaTiempos[]): number {
  return lista.filter((p) => p.jornada === "base" || p.jornada === "sin perfil").length;
}

export function resumenTiempos(d: ReporteTiempos): string[] {
  const r = d.resumen;
  const lista = d.personas;
  const rojos = lista.filter((p) => semaforoPersona(p).s === "rojo").length;
  const ambar = lista.filter((p) => semaforoPersona(p).s === "ambar").length;
  const verdes = lista.filter((p) => semaforoPersona(p).s === "verde").length;
  const habiles = lista[0]?.habiles ?? 0;
  const checan = lista.filter((p) => p.dias_con_entrada > 0);
  const asis = checan.length === 0 ? null : Math.round((100 * r.dias_con_entrada) / (checan.length * habiles));
  const punt = r.dias_con_entrada === 0 ? null : Math.round((100 * (r.dias_con_entrada - r.retardos)) / r.dias_con_entrada);
  const base = conPerfilBase(lista);
  const f: string[] = [];
  f.push(`${r.personas} personas con cuenta; ${r.checan} marcaron al menos una entrada entre el ${ddmm(d.desde)} y el ${ddmm(d.hasta)} (${habiles} días hábiles).`);
  f.push(`Asistencia ${pct(asis)} y puntualidad ${pct(punt)} entre quienes checan: ${r.dias_con_entrada} días con entrada, ${r.faltas} faltas, ${r.retardos} retardos.`);
  f.push(`Horas activas registradas: ${horas(r.minutos_total)}; ${r.dias_sin_salida} días con entrada y sin salida (no suman horas).`);
  f.push(`Semáforo: ${rojos} en rojo, ${ambar} en ámbar, ${verdes} en verde.`);
  if (base === lista.length && lista.length > 0) {
    f.push(`Las ${lista.length} personas tienen la jornada base (${lista[0].hora_entrada} + ${lista[0].tolerancia} min, ${lista[0].horas_semana} h en ${lista[0].dias_semana} días): los retardos y las horas esperadas se miden contra esa jornada. Asignar perfiles de jornada reales en RH → Checador → Jornadas.`);
  } else if (base > 0) {
    f.push(`${base} personas siguen con la jornada base; sus retardos se miden contra ${lista[0]?.hora_entrada ?? "08:00"}.`);
  }
  if (r.manuales > 0 || r.anuladas > 0) f.push(`Marcas corregidas a mano: ${r.manuales}; anuladas: ${r.anuladas}.`);
  return f;
}

function csvCelda(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const COLUMNAS_CSV_TIEMPOS = ["Nombre", "Puesto", "Empresa", "Jornada", "Días hábiles", "Días con entrada", "Faltas", "Retardos", "Min. de retardo", "Entrada prom.", "Salida prom.", "Horas activas", "Horas esperadas", "Diferencia", "Horas por día", "Días sin salida", "Comida prom. (min)", "Marcas manuales", "Ubicación frecuente", "Semáforo"];

export function csvTiempos(lista: PersonaTiempos[]): string {
  const filas = lista.map((p) => [
    p.nombre, p.puesto, p.empresa, `${p.jornada} ${p.hora_entrada}`, p.habiles, p.dias_con_entrada, p.faltas, p.retardos, p.retardo_min_total,
    p.entrada_prom, p.salida_prom, (p.minutos_total / 60).toFixed(2), (p.minutos_esperados / 60).toFixed(2),
    diferenciaHoras(p) == null ? "" : (diferenciaHoras(p)! / 60).toFixed(2), minutosPorDia(p) == null ? "" : (minutosPorDia(p)! / 60).toFixed(2),
    p.dias_sin_salida, p.comida_prom_min, p.manuales, p.ubicacion, semaforoPersona(p).s,
  ]);
  return [COLUMNAS_CSV_TIEMPOS, ...filas].map((f) => f.map(csvCelda).join(",")).join("\n");
}

/** Detalle por día de una persona, para la pantalla y el CSV diario. */
export function detalleDe(d: ReporteTiempos, profileId: string): DiaTiempos[] {
  return d.detalle.filter((x) => x.profile_id === profileId).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function csvDetalle(d: ReporteTiempos): string {
  const nombre = new Map(d.personas.map((p) => [p.profile_id, p.nombre]));
  const filas = [...d.detalle]
    .sort((a, b) => (nombre.get(a.profile_id) ?? "").localeCompare(nombre.get(b.profile_id) ?? "", "es") || a.fecha.localeCompare(b.fecha))
    .map((x) => [nombre.get(x.profile_id) ?? x.profile_id, x.fecha, diaSemana(x.fecha), x.entrada, x.comida_inicio, x.comida_fin, x.salida, x.minutos == null ? "" : (x.minutos / 60).toFixed(2), x.comida_min, x.retardo_min, x.manuales, x.anuladas]);
  return [["Nombre", "Fecha", "Día", "Entrada", "Salida a comer", "Regreso", "Salida", "Horas activas", "Comida (min)", "Retardo (min)", "Manuales", "Anuladas"], ...filas].map((f) => f.map(csvCelda).join(",")).join("\n");
}

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const COLOR_HTML: Record<Semaforo, string> = { rojo: "#b91c1c", ambar: "#b45309", verde: "#047857", gris: "#64748b" };

/** Reporte imprimible horizontal: resumen, tabla por persona y, opcional, el detalle por día de cada persona. */
export function htmlReporteTiempos(d: ReporteTiempos, organizacion: string, generadoPor: string | null, conDetalle = false): string {
  const lista = ordenarPersonas(d.personas);
  const filas = lista
    .map((p) => {
      const s = semaforoPersona(p);
      const dif = diferenciaHoras(p);
      return `<tr><td><span class="dot" style="background:${COLOR_HTML[s.s]}"></span>${esc(p.nombre)}<div class="sub">${esc(p.puesto)}${p.empresa ? ` · ${esc(p.empresa)}` : ""}</div></td><td class="r">${p.habiles}</td><td class="r">${p.dias_con_entrada}</td><td class="r">${p.faltas}</td><td class="r">${p.retardos}</td><td class="r">${p.retardo_min_total ? horas(p.retardo_min_total) : "—"}</td><td>${esc(p.entrada_prom ?? "—")}</td><td>${esc(p.salida_prom ?? "—")}</td><td class="r">${horas(p.minutos_total)}</td><td class="r">${minutosPorDia(p) == null ? "—" : horas(minutosPorDia(p))}</td><td class="r${dif != null && dif < 0 ? " neg" : ""}">${dif == null ? "—" : horas(dif)}</td><td class="r">${p.dias_sin_salida}</td><td class="r">${p.comida_prom_min == null ? "—" : `${p.comida_prom_min} m`}</td><td class="sub">${esc(s.motivo)}</td></tr>`;
    })
    .join("");
  const porDia = d.por_dia
    .map((x) => `<tr><td>${ddmm(x.fecha)} ${diaSemana(x.fecha)}</td><td class="r">${x.entradas}</td><td class="r">${x.retardos}</td><td class="r">${horas(x.minutos)}</td></tr>`)
    .join("");
  const detalle = !conDetalle
    ? ""
    : lista
        .filter((p) => p.dias_con_entrada > 0)
        .map((p) => {
          const dias = detalleDe(d, p.profile_id);
          return `<section class="persona"><h3>${esc(p.nombre)} <span class="sub">${esc(p.puesto)} · jornada ${esc(p.hora_entrada)} · ${p.dias_con_entrada} días</span></h3><table><thead><tr><th>Fecha</th><th>Entrada</th><th>Comer</th><th>Regreso</th><th>Salida</th><th class="r">Horas</th><th class="r">Retardo</th></tr></thead><tbody>${dias
            .map((x) => `<tr><td>${ddmm(x.fecha)} ${diaSemana(x.fecha)}</td><td>${esc(x.entrada ?? "—")}</td><td>${esc(x.comida_inicio ?? "—")}</td><td>${esc(x.comida_fin ?? "—")}</td><td>${x.salida ? esc(x.salida) : '<span class="neg">sin salida</span>'}</td><td class="r">${x.minutos == null ? "—" : horas(x.minutos)}</td><td class="r">${x.retardo_min > 0 ? `${x.retardo_min} m` : ""}</td></tr>`)
            .join("")}</tbody></table></section>`;
        })
        .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Tiempos y checador · ${esc(organizacion)}</title>
<style>
  @page{size:letter landscape;margin:10mm}
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;margin:16px;font-size:10.5px}
  h1{font-size:18px;margin:0 0 2px} h2{font-size:13px;margin:14px 0 6px;border-bottom:1px solid #cbd5e1;padding-bottom:3px} h3{font-size:11.5px;margin:12px 0 3px;break-after:avoid}
  .sub{color:#64748b;font-size:9.5px} p.sub{margin:0 0 8px}
  table{border-collapse:collapse;width:100%;margin:4px 0 8px} th,td{border:1px solid #e2e8f0;padding:2px 5px;text-align:left;vertical-align:top}
  th{background:#f1f5f9;font-size:9px;text-transform:uppercase;color:#475569} td.r,th.r{text-align:right;white-space:nowrap} .neg{color:#b91c1c}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
  ol{padding-left:18px;margin:4px 0} tr{break-inside:avoid} section.persona{break-inside:avoid}
</style></head><body>
<h1>Tiempos y checador · recursos humanos</h1>
<p class="sub">${esc(organizacion)} · del ${ddmm(d.desde)} al ${ddmm(d.hasta)}${generadoPor ? ` · generado por ${esc(generadoPor)}` : ""} · retardo = primera entrada después de la hora de entrada + tolerancia de su jornada · horas activas = salida − entrada − comida (sin comida marcada, el día completo)</p>
<h2>Resumen</h2><ol>${resumenTiempos(d).map((f) => `<li>${esc(f)}</li>`).join("")}</ol>
<h2>Por persona (rojo primero)</h2>
<table><thead><tr><th>Persona</th><th class="r">Hábiles</th><th class="r">Con entrada</th><th class="r">Faltas</th><th class="r">Retardos</th><th class="r">Min. tarde</th><th>Entrada prom.</th><th>Salida prom.</th><th class="r">Horas activas</th><th class="r">Por día</th><th class="r">vs jornada</th><th class="r">Sin salida</th><th class="r">Comida</th><th>Observación</th></tr></thead><tbody>${filas}</tbody></table>
<h2>Por día</h2>
<table style="width:auto;min-width:50%"><thead><tr><th>Día</th><th class="r">Entradas</th><th class="r">Retardos</th><th class="r">Horas activas</th></tr></thead><tbody>${porDia}</tbody></table>
${conDetalle ? `<h2>Detalle por persona y día</h2>${detalle}` : ""}
</body></html>`;
}
