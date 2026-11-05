// Presentación horizontal del reporte de RH para el director general
// (5-nov-2026, Mario: "cuando genere el PDF que sea la presentación que
// generaste aquí solo con la actualización de datos"). Es la misma
// presentación de 11 láminas del 29-oct-2026 (portada, resumen ejecutivo, qué
// atender, plantilla, asistencia, tiempos, tareas, nómina, evaluaciones/EPP/
// financiamiento/accesos, por definir, por implementar), pero todo el texto
// sale de `fn_reporte_rh_director` y `fn_reporte_rh_tiempos` del periodo que
// se pida. Gráficas en SVG en línea, sin dependencias. Puro, sin DOM.
//
// Las dos últimas láminas (decisiones y plan) no son datos: son la lista
// acordada con Mario el 29-oct; se editan aquí cuando algo se decide o se hace.

import { alertasReporte, resumenEjecutivo, totalesNomina, variacionSemanal, type Alerta, type ReporteRh, type Semaforo } from "./reporteRhDirector.ts";
import { diaSemana, horas, semaforoPersona, type PersonaTiempos, type ReporteTiempos } from "./reporteRhTiempos.ts";

const C = { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", good: "#0ca30c", warn: "#fab219", serious: "#ec835a", crit: "#d03b3b", ink: "#0b0b0b", ink2: "#52514e", mute: "#8a8984", grid: "#e6e5e1", surf: "#fcfcfb" };

const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n0 = (n: number | null | undefined) => Math.round(Number(n ?? 0)).toLocaleString("es-MX");
const money = (n: number | null | undefined) => `$ ${Number(n ?? 0).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)} %`);
const short = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const semPct = (v: number | null | undefined, g: number, r: number): Semaforo => (v == null ? "gris" : v >= g ? "verde" : v >= r ? "ambar" : "rojo");
const semN = (n: number, tope: number): Semaforo => (n <= 0 ? "verde" : n <= tope ? "ambar" : "rojo");
const primerNombre = (s: string) => s.trim().split(/\s+/)[0] ?? s;
/** "Nombre Apellido" para listas cortas: primer nombre y primer apellido. */
const nombreCorto = (s: string) => {
  const p = s.trim().split(/\s+/);
  return p.length >= 3 ? `${p[0]} ${p[p.length - 2]}` : s;
};
const lista = (xs: string[], max = 8) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} y ${xs.length - max} más`);

// ---- gráficas (SVG en línea) ----
interface HBar<T> { items: T[]; label: (x: T) => string; value: (x: T) => number; w?: number; rowH?: number; max?: number; color?: string | ((x: T) => string); fmt?: (v: number) => string; title?: string; marker?: (x: T) => number | null }
function hbar<T>({ items, label, value, w = 440, rowH = 22, max, color = C.s1, fmt = n0, title, marker }: HBar<T>): string {
  if (items.length === 0) return `<p class="note">Sin datos en el periodo.</p>`;
  const m = max ?? Math.max(1, ...items.map(value));
  const lw = 168, vw = 60, bw = w - lw - vw - 8;
  const h = items.length * rowH + (title ? 22 : 0) + 6;
  const top = title ? 22 : 4;
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`;
  if (title) s += `<text x="0" y="13" font-size="11" font-weight="600" fill="${C.ink}">${esc(title)}</text>`;
  items.forEach((it, i) => {
    const y = top + i * rowH;
    const v = value(it);
    const bwid = Math.max(0, Math.min(bw, (v / m) * bw));
    s += `<text x="${lw - 6}" y="${y + rowH / 2 + 4}" font-size="10.5" text-anchor="end" fill="${C.ink}">${esc(short(label(it)))}</text>`;
    s += `<rect x="${lw}" y="${y + 4}" width="${bw}" height="${rowH - 8}" fill="${C.grid}" opacity="0.5"/>`;
    s += `<rect x="${lw}" y="${y + 4}" width="${bwid}" height="${rowH - 8}" rx="3" fill="${typeof color === "function" ? color(it) : color}"/>`;
    s += `<text x="${lw + bwid + 6}" y="${y + rowH / 2 + 4}" font-size="10" fill="${C.ink2}">${esc(fmt(v))}</text>`;
    if (marker) {
      const mv = marker(it);
      if (mv != null) {
        const mx = lw + Math.min(bw, (mv / m) * bw);
        s += `<line x1="${mx}" x2="${mx}" y1="${y + 2}" y2="${y + rowH - 2}" stroke="${C.ink}" stroke-width="2"/>`;
      }
    }
  });
  return `${s}</svg>`;
}
interface VBars<T> { items: T[]; label: (x: T) => string; series: { name: string; value: (x: T) => number; color: string }[]; w?: number; h?: number; title?: string; fmt?: (v: number) => string }
function vbars<T>({ items, label, series, w = 520, h = 190, title, fmt = n0 }: VBars<T>): string {
  if (items.length === 0) return `<p class="note">Sin datos en el periodo.</p>`;
  const m = Math.max(1, ...items.flatMap((it) => series.map((s) => s.value(it))));
  const padL = 34, padB = 28, padT = title ? 26 : 10, padR = 6;
  const cw = w - padL - padR, ch = h - padT - padB;
  const gw = cw / items.length;
  const bw = Math.max(4, (gw - 6) / series.length - 2);
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`;
  if (title) s += `<text x="0" y="13" font-size="11" font-weight="600" fill="${C.ink}">${esc(title)}</text>`;
  for (const f of [0, 0.5, 1]) {
    const y = padT + ch - f * ch;
    s += `<line x1="${padL}" x2="${w - padR}" y1="${y}" y2="${y}" stroke="${C.grid}"/><text x="${padL - 4}" y="${y + 3}" font-size="9" text-anchor="end" fill="${C.mute}">${esc(fmt(m * f))}</text>`;
  }
  const every = items.length > 16 ? 3 : items.length > 8 ? 2 : 1;
  items.forEach((it, i) => {
    series.forEach((sr, j) => {
      const bh = (Math.max(0, sr.value(it)) / m) * ch;
      const x = padL + i * gw + 3 + j * (bw + 2);
      s += `<rect x="${x}" y="${padT + ch - bh}" width="${bw}" height="${bh}" rx="3" fill="${sr.color}"/>`;
    });
    if (i % every === 0) s += `<text x="${padL + i * gw + gw / 2}" y="${h - padB + 12}" font-size="9" text-anchor="middle" fill="${C.ink2}">${esc(label(it))}</text>`;
  });
  let lx = padL;
  for (const sr of series) {
    s += `<rect x="${lx}" y="${h - 10}" width="9" height="9" rx="2" fill="${sr.color}"/><text x="${lx + 13}" y="${h - 2}" font-size="9.5" fill="${C.ink2}">${esc(sr.name)}</text>`;
    lx += 16 + sr.name.length * 5.6;
  }
  return `${s}</svg>`;
}
function tile(k: string, v: string, s: Semaforo = "gris", sub = ""): string {
  const col = { verde: C.good, ambar: C.warn, rojo: C.crit, gris: C.mute }[s];
  return `<div class="tile" style="border-top:4px solid ${col}"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;
}

const DONDE: Record<Alerta["area"], string> = {
  plantilla: "RH → Personal",
  asistencia: "Checador",
  tareas: "Actividades",
  evaluaciones: "Evaluación de desempeño",
  nomina: "Nómina",
  epp: "EPP",
  herramienta: "Herramienta y equipo",
  financiamiento: "Financiamiento",
  accesos: "RH → Accesos",
};

/** Decisiones que siguen abiertas (acordadas el 29-oct-2026; se editan aquí). */
export const DECISIONES_PENDIENTES: { tema: string; que: string; quien: string }[] = [
  { tema: "Jornadas reales por persona", que: "Mientras todos tengan la jornada base (08:00 + 15 min, 48 h en 6 días) los retardos y las horas esperadas no son reales. Definir turnos: oficina, obra, practicantes de medio turno, cocina y limpieza, sábados.", quien: "Mario con RH" },
  { tema: "Quién está obligado a checar", que: "Hay personas con cuenta que nunca marcan. ¿Checan todos, solo operativos, o a supervisores se les mide por tareas?", quien: "Mario" },
  { tema: "Política de retardos y faltas", que: "¿Qué tolerancia aplica, cuántos retardos equivalen a una falta y qué consecuencia tiene? Hoy el reporte solo informa.", quien: "Mario con RH" },
  { tema: "Salida y comida obligatorias", que: "Desde el 3-nov la salida que no se marca se cierra sola a la hora de la jornada. ¿Se exige marcar comida para que cuente? ¿Se corrige a mano o se descuenta?", quien: "RH" },
  { tema: "Empresa de cada persona", que: "Sin empresa en la contratación o en la cuenta, la plantilla y la nómina no se reparten por empresa.", quien: "RH" },
  { tema: "Cadencia de evaluaciones", que: "¿Trimestral o semestral? ¿Evalúa el jefe directo? (Las personas sin jefe asignado no tienen quién las evalúe.)", quien: "Mario" },
  { tema: "Arranque del financiamiento", que: "¿Quién arranca y con qué tope? Falta definir la financiera (sin intereses hasta entonces).", quien: "Mario y Laura" },
  { tema: "Frecuencia de este reporte", que: "¿Semanal (lunes) o mensual? ¿Solo por notificación a ti, o también a RH?", quien: "Mario" },
];

/** Plan de implementación acordado el 29-oct-2026, con lo que ya quedó. */
export const PLAN_IMPLEMENTACION: { area: string; accion: string; cuando: string }[] = [
  { area: "RH", accion: "Asignar perfil de jornada a cada persona (RH → Checador → Jornadas).", cuando: "Esta semana" },
  { area: "RH", accion: "Cerrar las cuentas de las bajas; dar cuenta a las personas sin acceso; completar expedientes; asignar jefe directo a quien no lo tiene.", cuando: "Esta semana" },
  { area: "RH", accion: "Capturar la empresa de cada persona y el sueldo semanal en el Estudio (base del financiamiento).", cuando: "Este mes" },
  { area: "RH / jefes", accion: "Primera ronda de evaluaciones de desempeño firmadas con el formato del sistema.", cuando: "Noviembre" },
  { area: "Sistema", accion: "Cierre automático de la jornada a las 23:59 cuando no se marca salida (la salida real posterior la anula).", cuando: "Hecho 3-nov" },
  { area: "Sistema", accion: "Vacaciones y permisos con recordatorio de quién sale y cuándo regresa; las ausencias autorizadas no cuentan como falta.", cuando: "Hecho 3-nov" },
  { area: "Sistema", accion: "Reporte semanal automático al director general por notificación (lunes 8:00) con lo que cambió contra la semana anterior.", cuando: "Por hacer" },
  { area: "Sistema", accion: "Retardos y faltas medidos con la jornada real de cada persona y la política que se defina (retardos → falta, descuento), con histórico mensual.", cuando: "Al definir política" },
  { area: "Sistema", accion: "Comparativo mes contra mes (asistencia, puntualidad, horas, nómina) y tendencia de 6 meses en este reporte.", cuando: "Por hacer" },
  { area: "Sistema", accion: "Nómina por persona ligada al expediente para ver costo por persona y por obra junto con sus horas.", cuando: "Por hacer" },
];

export interface OpcionesPresentacion {
  organizacion: string;
  /** Fecha de generación (AAAA-MM-DD). */
  hoy: string;
}

/** Las 11 láminas (10 si no hay reporte de tiempos) en una hoja carta horizontal. */
export function htmlPresentacionRh(d: ReporteRh, t: ReporteTiempos | null, o: OpcionesPresentacion): string {
  const p = d.plantilla, a = d.asistencia, tr = d.tareas, nm = d.nomina;
  const tot = totalesNomina(nm);
  const anio = d.hasta.slice(0, 4);
  const periodo = `${ddmm(d.desde)} – ${ddmm(d.hasta)}/${anio}`;
  const slides: string[] = [];
  const slide = (titulo: string, cuerpo: string, nota = "") =>
    slides.push(`<section class="slide"><header><h1>${esc(titulo)}</h1><span class="crumb">Recursos humanos · director general · ${esc(periodo)}</span></header><div class="body">${cuerpo}</div><footer><span>${esc(nota)}</span><span class="pg">${slides.length + 1}</span></footer></section>`);

  // 1 Portada
  slides.push(`<section class="slide cover"><div><div class="eyebrow">${esc(o.organizacion)} · Acumulado</div><h1>Reporte de recursos humanos</h1><h2>para el director general</h2><p>Periodo del ${ddmm(d.desde)} al ${ddmm(d.hasta)} de ${esc(anio)} · ${n0(d.habiles)} días hábiles · generado el ${ddmm(o.hoy)}/${esc(o.hoy.slice(0, 4))}</p><p class="small">Plantilla · asistencia y tiempos · tareas · evaluaciones · nómina · EPP, herramienta y financiamiento · accesos · por definir · por implementar</p></div></section>`);

  // 2 Resumen ejecutivo
  const rotUlt = p.rotacion[p.rotacion.length - 1];
  const bullets = [
    ...resumenEjecutivo(d),
    `EPP: ${n0(d.epp.entregadas)} piezas en uso, ${n0(d.epp.vencidas)} vencidas, ${n0(d.epp.solicitudes_pendientes)} solicitud(es) sin atender. Financiamiento: ${d.financiamiento.cuentas > 0 ? `${n0(d.financiamiento.cuentas)} cuentas de nómina, ${money(d.financiamiento.saldo_vigente)} vigente` : "sin cuentas de nómina todavía"}.`,
    `Accesos: ${n0(p.bajas_con_cuenta.length)} baja(s) con cuenta activa; ${n0(d.accesos.activas - d.accesos.con_push)} de ${n0(d.accesos.activas)} cuentas no reciben notificaciones.`,
  ];
  slide("Resumen ejecutivo", `
<div class="tiles">
  ${tile("Plantilla activa", n0(p.activos), "gris", `${n0(p.con_cuenta)} con cuenta · ${n0(p.checan)} checan`)}
  ${tile("Altas / bajas del periodo", `${p.altas.length} / ${p.bajas.length}`, "gris", rotUlt ? `rotación ${ddmm(rotUlt.mes).slice(3)}/${rotUlt.mes.slice(2, 4)}: ${pct(rotUlt.rotacion_pct)}` : "")}
  ${tile("Asistencia (quienes checan)", pct(a.pct_asistencia), semPct(a.pct_asistencia, 90, 75), `${n0(a.dias_con_entrada)} días con entrada`)}
  ${tile("Puntualidad", pct(a.pct_puntualidad), semPct(a.pct_puntualidad, 85, 60), `${n0(a.retardos)} retardos`)}
  ${tile("Tareas hechas", `${n0(tr.periodo.hechas)} de ${n0(tr.periodo.total)} · ${pct(tr.periodo.pct_cumplimiento)}`, semPct(tr.periodo.pct_cumplimiento, 85, 65), `${pct(tr.periodo.pct_a_tiempo)} a tiempo`)}
  ${tile("Tareas vencidas hoy", n0(tr.vencidas), semN(tr.vencidas, 5), `en ${n0(tr.tableros)} tableros`)}
  ${tile("Nómina fiscal (última)", money(tot.fiscal), "gris", `semanal ${money(tot.semanal)} + quincenal ${money(tot.quincenal)}`)}
  ${tile("Mano de obra (última semana)", money(tot.manoObra), "gris", nm.mano_obra.map((x) => x.empresa).join(", ") || "sin registros")}
</div>
<ol class="bullets">${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ol>`);

  // 3 Qué atender
  const alertas = alertasReporte(d);
  slide(
    "Qué atender",
    alertas.length === 0
      ? `<p class="bullets">Nada pendiente de atender en este periodo.</p>`
      : `<table class="list"><thead><tr><th></th><th>Hallazgo</th><th>Dónde</th></tr></thead><tbody>${alertas.map((x) => `<tr><td><span class="dot ${x.nivel}"></span></td><td>${esc(x.texto)}</td><td class="mute">${esc(DONDE[x.area])}</td></tr>`).join("")}</tbody></table>`,
    "Rojo = atender esta semana · Ámbar = este mes",
  );

  // 4 Plantilla
  const sinEmpresa = p.por_empresa.find((x) => /sin empresa/i.test(x.empresa))?.n ?? 0;
  const expedientes = p.expedientes_incompletos;
  slide("Plantilla", `
<div class="cols plantilla">
  <div>${hbar({ title: `Por área (${n0(p.activos)} activos)`, items: p.por_area, label: (x) => x.area, value: (x) => x.n, w: 330 })}
  <div class="gap"></div>
  ${hbar({ title: "Por empresa (contratación o cuenta)", items: p.por_empresa, label: (x) => x.empresa, value: (x) => x.n, w: 330 })}
  ${sinEmpresa > 0 ? `<p class="note">${n0(sinEmpresa)} personas no tienen empresa registrada en su contratación ni en su cuenta: la plantilla y la nómina no se reparten por empresa hasta que RH la capture.</p>` : ""}</div>
  <div>${vbars({ title: "Rotación mensual: altas y bajas (plantilla al cierre entre paréntesis)", items: p.rotacion, label: (x) => `${x.mes.slice(5, 7)}/${x.mes.slice(2, 4)} (${x.plantilla_fin})`, series: [{ name: "Altas", value: (x) => x.altas, color: C.s1 }, { name: "Bajas", value: (x) => x.bajas, color: C.s2 }], w: 470, h: 180 })}
  <div class="two">
    <div><h3>Altas del periodo (${p.altas.length})</h3>${p.altas.length ? `<table class="mini">${p.altas.slice(0, 12).map((x) => `<tr><td>${esc(nombreCorto(x.nombre))}</td><td class="mute">${esc(x.puesto ?? "")}</td><td class="r">${ddmm(x.fecha)}</td></tr>`).join("")}</table>` : `<p class="small">Ninguna.</p>`}</div>
    <div><h3>Bajas del periodo (${p.bajas.length})</h3>${p.bajas.length ? `<table class="mini">${p.bajas.slice(0, 8).map((x) => `<tr><td>${esc(nombreCorto(x.nombre))}</td><td class="mute">${esc(x.puesto ?? "")}</td><td class="r">${ddmm(x.fecha)}</td><td class="r">${x.cuenta_activa ? '<span class="crit">cuenta activa</span>' : ""}</td></tr>`).join("")}</table>` : `<p class="small">Ninguna.</p>`}
    <h3>Expedientes incompletos (${expedientes.length})</h3><p class="small">${expedientes.length ? esc(expedientes.slice(0, 6).map((x) => `${nombreCorto(x.nombre)}: ${x.faltan}`).join(" · ")) : "Todos completos."}${p.sin_jefe > 0 ? ` ${n0(p.sin_jefe)} personas sin jefe directo asignado.` : ""}</p></div>
  </div></div>
</div>`);

  // 5 Asistencia
  const porDia = (t?.por_dia ?? []).filter((x) => diaSemana(x.fecha) !== "dom");
  const diaMax = porDia.reduce<{ fecha: string; entradas: number } | null>((m, x) => (!m || x.entradas > m.entradas ? x : m), null);
  const sabados = porDia.filter((x) => diaSemana(x.fecha) === "sáb");
  const notaAsis = [
    diaMax ? `El día con más gente fue el ${diaSemana(diaMax.fecha)} ${ddmm(diaMax.fecha)}: ${n0(diaMax.entradas)} entradas.` : "",
    sabados.length ? `Los sábados vienen de ${Math.min(...sabados.map((x) => x.entradas))} a ${Math.max(...sabados.map((x) => x.entradas))} personas.` : "",
  ].filter(Boolean).join(" ");
  slide("Asistencia: quién viene y a qué hora", `
<div class="tiles small4">
  ${tile("Asistencia", pct(a.pct_asistencia), semPct(a.pct_asistencia, 90, 75), "entre quienes checan")}
  ${tile("Puntualidad", pct(a.pct_puntualidad), semPct(a.pct_puntualidad, 85, 60), "contra la jornada de cada quien")}
  ${tile("Con cuenta y sin entradas", n0(a.no_checan.length), semN(a.no_checan.length, 3), lista(a.no_checan.map((x) => primerNombre(x.nombre)), 5))}
  ${tile("Días sin salida", n0(t?.resumen.dias_sin_salida ?? 0), semN(t?.resumen.dias_sin_salida ?? 0, 20), "no suman horas")}
</div>
<div class="cols">
  <div>${t ? vbars({ title: "Entradas y retardos por día (lun-sáb)", items: porDia, label: (x) => `${ddmm(x.fecha)} ${diaSemana(x.fecha)}`, series: [{ name: "Personas con entrada", value: (x) => x.entradas, color: C.s1 }, { name: "Con retardo", value: (x) => x.retardos, color: C.s2 }], w: 560, h: 210 }) : `<p class="note">Sin el reporte de tiempos no hay detalle por día.</p>`}
  <p class="note">${esc(notaAsis)}</p></div>
  <div>${hbar({ title: `Menos días con entrada (de ${n0(d.habiles)} hábiles)`, items: a.mas_faltas.slice(0, 8), label: (x) => nombreCorto(x.nombre), value: (x) => x.dias, max: Math.max(d.habiles, 1), color: C.crit, fmt: (v) => `${v} días`, w: 400 })}
  <div class="gap"></div>
  ${hbar({ title: "Más retardos (días con retardo)", items: a.mas_retardos.slice(0, 8), label: (x) => nombreCorto(x.nombre), value: (x) => x.retardos, max: Math.max(d.habiles, 1), color: C.serious, w: 400 })}</div>
</div>`, "Retardo = primera entrada después de la hora de entrada + tolerancia del perfil de jornada de la persona.");

  // 6 Tiempos vs jornada (solo con el reporte de tiempos)
  if (t) {
    const personas = t.personas;
    const sem: Record<Semaforo, number> = { rojo: 0, ambar: 0, verde: 0, gris: 0 };
    for (const q of personas) sem[semaforoPersona(q).s]++;
    const conHoras = personas.filter((q) => q.dias_completos > 0).sort((x, y) => y.minutos_total - x.minutos_total);
    const sinSalida = personas.filter((q) => q.dias_sin_salida > 0).sort((x, y) => y.dias_sin_salida - x.dias_sin_salida).slice(0, 10);
    const entradaProm = personas.filter((q) => q.entrada_prom).sort((x, y) => (y.entrada_prom ?? "").localeCompare(x.entrada_prom ?? "")).slice(0, 10);
    const minutosDesde7 = (q: PersonaTiempos) => { const [h, m] = (q.entrada_prom ?? "07:00").split(":").map(Number); return Math.max(0, h * 60 + m - 420); };
    const comidaLarga = personas.filter((q) => (q.comida_prom_min ?? 0) >= 120).sort((x, y) => (y.comida_prom_min ?? 0) - (x.comida_prom_min ?? 0))[0];
    const base = personas.filter((q) => q.jornada === "base").length;
    slide("Tiempos: horas activas contra la jornada", `
<div class="tiles small4">
  ${tile("Horas activas registradas", horas(t.resumen.minutos_total), "gris", `${n0(d.dias)} días, ${n0(t.resumen.checan)} personas`)}
  ${tile("En rojo", n0(sem.rojo), "rojo", "sin entradas, <70 % asistencia o <50 % puntualidad")}
  ${tile("En ámbar", n0(sem.ambar), "ambar", "faltas, retardos o salidas sin marcar")}
  ${tile("En verde", n0(sem.verde), "verde", "cumple su jornada")}
</div>
<div class="cols">
  <div>${hbar({ title: "Horas activas en el periodo (la raya negra = horas esperadas por su jornada)", marker: (x) => x.minutos_esperados, items: conHoras.slice(0, 14), label: (x) => nombreCorto(x.nombre), value: (x) => x.minutos_total, max: Math.max(1, ...conHoras.map((x) => Math.max(x.minutos_total, x.minutos_esperados))), fmt: (v) => horas(v), color: (x) => (x.minutos_total >= x.minutos_esperados ? C.s3 : C.s2), w: 470, rowH: 19 })}</div>
  <div>${hbar({ title: "Hora promedio de entrada (quienes checan, más tarde primero)", items: entradaProm, label: (x) => nombreCorto(x.nombre), value: minutosDesde7, max: 6 * 60, fmt: (v) => `${String(Math.floor((v + 420) / 60)).padStart(2, "0")}:${String(Math.round(v + 420) % 60).padStart(2, "0")}`, color: C.s1, w: 400, rowH: 19 })}
  <div class="gap"></div>
  ${hbar({ title: "Días con entrada y sin salida", items: sinSalida, label: (x) => nombreCorto(x.nombre), value: (x) => x.dias_sin_salida, color: C.warn, w: 400, rowH: 19 })}</div>
</div>`, `Verde = cumple o supera las horas esperadas de su jornada en los días completos; naranja = por debajo.${base > 0 ? ` ${n0(base)} de ${n0(personas.length)} personas siguen con la jornada base.` : ""}${comidaLarga ? ` ${nombreCorto(comidaLarga.nombre)} registra comidas de ${Math.round((comidaLarga.comida_prom_min ?? 0) / 60)} h en promedio.` : ""}`);
  }

  // 7 Tareas
  const areaMax = [...tr.por_area].sort((x, y) => y.total - x.total)[0];
  const areaVenc = [...tr.por_area].sort((x, y) => y.vencidas - x.vencidas)[0];
  const areaMejor = [...tr.por_area].filter((x) => x.total >= 5).sort((x, y) => y.hechas / y.total - x.hechas / x.total)[0];
  const notaTareas = [
    areaMax ? `${areaMax.area} concentra ${n0(areaMax.total)} de ${n0(tr.periodo.total)} tareas` : "",
    areaVenc && areaVenc.vencidas > 0 ? `${areaVenc === areaMax ? "y" : `${areaVenc.area} tiene`} ${n0(areaVenc.vencidas)} de las ${n0(tr.periodo.vencidas)} vencidas` : "",
  ].filter(Boolean).join(" ");
  slide("Cumplimiento de tareas", `
<div class="tiles small4">
  ${tile("Tareas del periodo", n0(tr.periodo.total), "gris", `${n0(tr.tableros)} tableros activos`)}
  ${tile("Hechas", `${n0(tr.periodo.hechas)} · ${pct(tr.periodo.pct_cumplimiento)}`, semPct(tr.periodo.pct_cumplimiento, 85, 65))}
  ${tile("A tiempo (de las hechas)", pct(tr.periodo.pct_a_tiempo), semPct(tr.periodo.pct_a_tiempo, 80, 60), `${n0(tr.periodo.cambios_fecha)} cambios de fecha`)}
  ${tile("Vencidas hoy", n0(tr.vencidas), semN(tr.vencidas, 5), `${n0(tr.abiertas)} abiertas en total`)}
</div>
<div class="cols">
  <div>${vbars({ title: "Por área: hechas y vencidas", items: tr.por_area, label: (x) => x.area, series: [{ name: "Hechas", value: (x) => x.hechas, color: C.s3 }, { name: "Vencidas", value: (x) => x.vencidas, color: C.s2 }], w: 470, h: 200 })}
  <p class="note">${esc(notaTareas ? `${notaTareas}.` : "")}${areaMejor ? esc(` ${areaMejor.area} cumple ${n0(areaMejor.hechas)} de ${n0(areaMejor.total)}.`) : ""}</p></div>
  <div>${hbar({ title: "Por persona: vencidas", items: [...tr.por_persona].filter((x) => x.vencidas > 0).sort((x, y) => y.vencidas - x.vencidas).slice(0, 10), label: (x) => nombreCorto(x.nombre), value: (x) => x.vencidas, fmt: (v) => `${v} vencidas`, color: C.serious, w: 430, rowH: 20 })}
  <div class="gap"></div>
  ${hbar({ title: "Más tareas hechas", items: [...tr.por_persona].sort((x, y) => y.hechas - x.hechas).slice(0, 6), label: (x) => nombreCorto(x.nombre), value: (x) => x.hechas, fmt: (v) => `${v} hechas`, color: C.s3, w: 430, rowH: 20 })}</div>
</div>`);

  // 8 Nómina
  const tend = nm.semanal_tendencia;
  const primera = tend[0], ultima = tend[tend.length - 1];
  const var8 = primera && ultima && Number(primera.total) > 0 ? Math.round(((Number(ultima.total) - Number(primera.total)) / Number(primera.total)) * 100) : null;
  const enCero = nm.semanal.filter((x) => Number(x.total) === 0 && Number(x.personas) > 0).map((x) => x.empresa);
  const cierre = nm.semanal[0]?.fin ?? nm.quincenal[0]?.fin ?? null;
  slide("Nómina del backoffice", `
<div class="tiles small4">
  ${tile(`Semanal (última, ${n0(tot.personasSemanal)} personas)`, money(tot.semanal), "gris", cierre ? `cierre ${ddmm(cierre)}` : "")}
  ${tile(`Quincenal (última, ${n0(tot.personasQuincenal)} personas)`, money(tot.quincenal), "gris", nm.quincenal[0] ? `cierre ${ddmm(nm.quincenal[0].fin)}` : "")}
  ${tile("Nómina fiscal total", money(tot.fiscal), "gris", "semana + quincena")}
  ${tile("Mano de obra (contratistas)", money(tot.manoObra), "gris", `última semana, ${n0(nm.mano_obra.reduce((s, x) => s + Number(x.personas), 0))} personas`)}
</div>
<div class="cols">
  <div>${vbars({ title: `Nómina semanal, últimas ${tend.length} semanas (cierre)`, items: tend, label: (x) => ddmm(x.fin), series: [{ name: "Total semanal", value: (x) => Number(x.total), color: C.s1 }], w: 520, h: 200, fmt: (v) => `$${Math.round(v / 1000)}k` })}
  <p class="note">${primera && ultima && var8 != null ? esc(`De ${money(primera.total)} (${ddmm(primera.fin)}) a ${money(ultima.total)} (${ddmm(ultima.fin)}): ${var8 >= 0 ? "+" : ""}${var8} % en ${tend.length} semanas; las personas pasaron de ${n0(primera.personas)} a ${n0(ultima.personas)}.`) : ""}${(() => { const v = variacionSemanal(tend); return v && v.pct != null ? esc(` Contra la semana anterior: ${v.pct >= 0 ? "+" : ""}${v.pct} %.`) : ""; })()}</p></div>
  <div>${hbar({ title: "Semanal por empresa", items: nm.semanal, label: (x) => x.empresa, value: (x) => Number(x.total), fmt: money, color: C.s1, w: 400, rowH: 18 })}
  ${hbar({ title: "Quincenal por empresa", items: nm.quincenal, label: (x) => x.empresa, value: (x) => Number(x.total), fmt: money, color: C.s1, w: 400, rowH: 18 })}
  ${hbar({ title: "Mano de obra por empresa", items: nm.mano_obra, label: (x) => `${x.empresa} (${ddmm(x.fin)})`, value: (x) => Number(x.total), fmt: money, color: C.s2, w: 400, rowH: 18 })}</div>
</div>`, enCero.length ? `${enCero.join(", ")} aparece con personas y $0 en la semanal: renglones sin pago en el backoffice.` : "");

  // 9 Evaluaciones, EPP, financiamiento y accesos
  const ac = d.accesos, ep = d.epp, fi = d.financiamiento, ev = d.evaluaciones;
  const pctPush = ac.activas > 0 ? (100 * ac.con_push) / ac.activas : null;
  slide("Evaluaciones, EPP, financiamiento y accesos", `
<div class="tiles small4">
  ${tile("Evaluaciones firmadas (12 m)", n0(ev.firmadas_12m), ev.firmadas_12m ? "verde" : "rojo", `${n0(ev.sin_evaluacion_6m)} personas por evaluar${ev.promedio != null ? ` · promedio ${ev.promedio}` : ""}`)}
  ${tile("EPP en uso / vencido", `${n0(ep.entregadas)} / ${n0(ep.vencidas)}`, semN(ep.vencidas, 0), `${n0(ep.solicitudes_pendientes)} solicitud(es) pendiente(s)`)}
  ${tile("Cuentas de nómina", n0(fi.cuentas), fi.con_atraso > 0 ? "rojo" : "gris", fi.cuentas > 0 ? `${money(fi.saldo_vigente)} vigente · ${n0(fi.con_atraso)} con atraso` : "sin financiamiento activo")}
  ${tile("Herramienta asignada", n0(d.herramienta.asignadas), semN(d.herramienta.regreso_vencido, 0), d.herramienta.asignadas > 0 ? `${n0(d.herramienta.regreso_vencido)} con regreso vencido` : "módulo sin uso todavía")}
</div>
<div class="cols">
  <div>${hbar({ title: `Cuentas activas por rol (${n0(ac.activas)})`, items: ac.por_rol, label: (x) => x.rol, value: (x) => x.n, w: 420, rowH: 17 })}</div>
  <div class="tiles small2">
    ${tile("Con notificaciones push", `${n0(ac.con_push)} de ${n0(ac.activas)}`, semPct(pctPush, 80, 60), pctPush != null ? `${Math.round(100 - pctPush)} % no recibe avisos de tareas` : "")}
    ${tile("Bajas con cuenta activa", n0(p.bajas_con_cuenta.length), semN(p.bajas_con_cuenta.length, 0), lista(p.bajas_con_cuenta.map((x) => primerNombre(x.nombre)), 4))}
    ${tile("Personas activas sin cuenta", n0(p.sin_cuenta.length), p.sin_cuenta.length ? "ambar" : "verde", "no checan ni reciben tareas")}
    ${tile("Sin jefe directo", n0(p.sin_jefe), p.sin_jefe ? "ambar" : "verde", "sin escalamiento de tareas")}
  </div>
</div>
<h3>Sin notificaciones (${n0(ac.sin_push.length)})</h3><p class="small">${esc(ac.sin_push.map((x) => nombreCorto(x.nombre)).join(" · ") || "Todas las cuentas reciben avisos.")}</p>`);

  // 10 Por definir
  slide("Por definir (decisiones)", `<table class="list def"><thead><tr><th>Tema</th><th>Qué hay que decidir</th><th>Quién</th></tr></thead><tbody>${DECISIONES_PENDIENTES.map((x) => `<tr><td><b>${esc(x.tema)}</b></td><td>${esc(x.que)}</td><td class="mute">${esc(x.quien)}</td></tr>`).join("")}</tbody></table>`);

  // 11 Por implementar
  slide("Por implementar", `<table class="list def"><thead><tr><th>Área</th><th>Acción</th><th>Cuándo</th></tr></thead><tbody>${PLAN_IMPLEMENTACION.map((x) => `<tr><td><b>${esc(x.area)}</b></td><td>${esc(x.accion)}</td><td class="mute${/^hecho/i.test(x.cuando) ? " ok" : ""}">${esc(x.cuando)}</td></tr>`).join("")}</tbody></table>`, "Las pantallas ya existen en Acumulado: Recursos humanos → Reporte para el director general y Tiempos y checador.");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte RH · director general · ${esc(periodo)}</title>
<style>
  @page{size:11in 8.5in;margin:0}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:${C.ink};background:#fff}
  .btn{position:fixed;top:10px;right:10px;padding:8px 14px;background:#0f172a;color:#fff;border:0;border-radius:6px;font-size:13px;cursor:pointer;z-index:9}
  .slide{width:11in;height:8.5in;padding:0.45in 0.55in 0.4in;break-after:page;position:relative;background:${C.surf};display:flex;flex-direction:column;margin:0 auto}
  .slide:last-child{break-after:auto}
  header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid ${C.s1};padding-bottom:6px;margin-bottom:12px}
  header h1{font-size:22px;margin:0;font-weight:700} .crumb{font-size:10px;color:${C.mute}}
  .body{flex:1;overflow:hidden}
  footer{font-size:9px;color:${C.mute};display:flex;justify-content:space-between;margin-top:6px} .pg{font-weight:600}
  .cover{justify-content:center;background:linear-gradient(135deg,#0f2a4a,#2a78d6);color:#fff;padding:1in}
  .cover .eyebrow{letter-spacing:.18em;text-transform:uppercase;font-size:12px;opacity:.85}
  .cover h1{font-size:44px;margin:10px 0 0} .cover h2{font-size:26px;font-weight:400;margin:4px 0 20px;opacity:.95}
  .cover p{font-size:14px;opacity:.95;margin:4px 0} .cover .small{font-size:11px;opacity:.8}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px} .tiles.small4 .tile{padding:7px 10px} .tiles.small2{grid-template-columns:1fr 1fr;margin:0}
  .tile{background:#fff;border:1px solid ${C.grid};border-radius:6px;padding:9px 12px}
  .tile .v{font-size:22px;font-weight:700;line-height:1.15} .tile .k{font-size:10.5px;color:${C.ink2};margin-top:2px} .tile .sub{font-size:9.5px;color:${C.mute};margin-top:2px}
  .tiles.small4 .tile .v{font-size:17px}
  .bullets{font-size:13.5px;line-height:1.45;padding-left:20px;margin:4px 0} .bullets li{margin-bottom:3px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px} .cols.plantilla{grid-template-columns:330px 1fr} .two{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}
  .gap{height:10px}
  h3{font-size:11px;margin:8px 0 3px;color:${C.ink2};text-transform:uppercase;letter-spacing:.04em}
  table.mini{font-size:10px;border-collapse:collapse;width:100%} table.mini td{padding:2px 4px 2px 0;border-bottom:1px solid ${C.grid}} table.mini td:first-child{white-space:nowrap;font-weight:500} table.mini td.mute{white-space:normal;font-size:9.5px} td.r{text-align:right;white-space:nowrap}
  table.list{width:100%;border-collapse:collapse;font-size:13px} table.list th{text-align:left;font-size:10px;text-transform:uppercase;color:${C.mute};border-bottom:1px solid ${C.grid};padding:4px 6px}
  table.list td{padding:7px 6px;border-bottom:1px solid ${C.grid};vertical-align:top;line-height:1.35} table.list.def td{font-size:12px;padding:6px}
  .dot{display:inline-block;width:11px;height:11px;border-radius:50%} .dot.rojo{background:${C.crit}} .dot.ambar{background:${C.warn}}
  .mute{color:${C.mute};font-size:10.5px;white-space:nowrap} .mute.ok{color:${C.good};font-weight:600} .crit{color:${C.crit};font-weight:600} .note{font-size:10.5px;color:${C.ink2};margin:4px 0 0;line-height:1.35} .small{font-size:10.5px;line-height:1.4;color:${C.ink2}}
  svg text{font-family:inherit}
  @media print{.btn{display:none}}
</style></head><body><button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>${slides.join("")}</body></html>`;
}
