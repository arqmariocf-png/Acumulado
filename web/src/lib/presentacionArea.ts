// Presentación horizontal del reporte de un área para el director general
// (5-nov-2026, Mario: "así como generaste el reporte del área de recursos
// humanos, haz el de todas las áreas para revisarlos e irlos puliendo").
// Mismo molde que `presentacionRh.ts` pero genérico: las láminas salen de la
// configuración del área (`AREAS_REPORTE`) y del jsonb de
// `fn_reporte_area_director`. Láminas: portada, resumen ejecutivo, evolución
// (si hay reportes guardados), qué atender, una por sección y "Por revisar
// con el área". Gráficas en SVG en línea, sin dependencias. Puro, sin DOM.

import { cambiosDestacados, formatoValor, renglonesEvolucion, serieEvolucion, textoDelta, type HistoricoGenerico } from "./historicoRh.ts";
import { AREAS_REPORTE, alertasArea, filasSeccion, formatear, n0, renglonesEvolucionArea, resumenArea, semaforoDe, valorIndicador, type ReporteArea, type SeccionDef, type Semaforo } from "./reporteAreas.ts";

const C = { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", good: "#0ca30c", warn: "#fab219", crit: "#d03b3b", ink: "#0b0b0b", ink2: "#52514e", mute: "#8a8984", grid: "#e6e5e1", surf: "#fcfcfb" };

const esc = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const short = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Barras horizontales (una por renglón de la sección). */
function hbar(items: { etiqueta: string; valor: number }[], fmt: (v: number) => string, w = 440, rowH = 20): string {
  if (items.length === 0) return `<p class="note">Sin datos en el periodo.</p>`;
  const m = Math.max(1, ...items.map((x) => Math.abs(x.valor)));
  const lw = 168, vw = 70, bw = w - lw - vw - 8;
  const h = items.length * rowH + 6;
  let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`;
  items.forEach((it, i) => {
    const y = 4 + i * rowH;
    const bwid = Math.max(0, Math.min(bw, (Math.abs(it.valor) / m) * bw));
    s += `<text x="${lw - 6}" y="${y + rowH / 2 + 4}" font-size="10.5" text-anchor="end" fill="${C.ink}">${esc(short(it.etiqueta))}</text>`;
    s += `<rect x="${lw}" y="${y + 4}" width="${bw}" height="${rowH - 8}" fill="${C.grid}" opacity="0.5"/>`;
    s += `<rect x="${lw}" y="${y + 4}" width="${bwid}" height="${rowH - 8}" rx="3" fill="${it.valor < 0 ? C.crit : C.s1}"/>`;
    s += `<text x="${lw + bwid + 6}" y="${y + rowH / 2 + 4}" font-size="10" fill="${C.ink2}">${esc(fmt(it.valor))}</text>`;
  });
  return `${s}</svg>`;
}

function tile(k: string, v: string, s: Semaforo = "gris", sub = ""): string {
  const col = { verde: C.good, ambar: C.warn, rojo: C.crit, gris: C.mute }[s];
  return `<div class="tile" style="border-top:4px solid ${col}"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;
}

/** Tabla de una sección con sus columnas (hasta `max` renglones). */
function tablaSeccion(d: ReporteArea, sec: SeccionDef, max = 14): string {
  const filas = filasSeccion(d, sec.clave).slice(0, max);
  if (filas.length === 0) return `<p class="note">Sin registros en el periodo.</p>`;
  const numerica = (f: SeccionDef["columnas"][number]) => f.formato === "n" || f.formato === "money" || f.formato === "pct" || f.formato === "dias";
  return `<table class="list sec"><thead><tr>${sec.columnas.map((c) => `<th${numerica(c) ? ' class="r"' : ""}>${esc(c.etiqueta)}</th>`).join("")}</tr></thead><tbody>${filas
    .map((f) => `<tr>${sec.columnas.map((c) => `<td${numerica(c) ? ' class="r"' : ""}>${esc(formatear(f[c.clave], c.formato))}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

export interface OpcionesPresentacionArea {
  organizacion: string;
  /** Fecha de generación (AAAA-MM-DD). */
  hoy: string;
  /** Reportes guardados antes del mismo área y periodo: con al menos uno sale
   * la lámina "Evolución". */
  historico?: HistoricoGenerico[];
}

/** Número de láminas que trae la presentación de un área (para pruebas y la pantalla). */
export function laminasArea(d: ReporteArea, historico: HistoricoGenerico[] = []): number {
  const cfg = AREAS_REPORTE[d.area];
  const serie = serieEvolucion(historico, { desde: d.desde, hasta: d.hasta, dias: d.dias, indicadores: d.indicadores });
  return 4 + cfg.secciones.length + (serie.length >= 2 ? 1 : 0);
}

/** Portada · resumen · (evolución) · qué atender · una lámina por sección · por revisar. */
export function htmlPresentacionArea(d: ReporteArea, o: OpcionesPresentacionArea): string {
  const cfg = AREAS_REPORTE[d.area];
  const anio = d.hasta.slice(0, 4);
  const periodo = `${ddmm(d.desde)} – ${ddmm(d.hasta)}/${anio}`;
  const slides: string[] = [];
  const slide = (titulo: string, cuerpo: string, nota = "") =>
    slides.push(`<section class="slide"><header><h1>${esc(titulo)}</h1><span class="crumb">${esc(cfg.titulo)} · director general · ${esc(periodo)}</span></header><div class="body">${cuerpo}</div><footer><span>${esc(nota)}</span><span class="pg">${slides.length + 1}</span></footer></section>`);

  // 1 Portada
  slides.push(`<section class="slide cover"><div><div class="eyebrow">${esc(o.organizacion)} · Acumulado</div><h1>Reporte de ${esc(cfg.titulo.toLowerCase())}</h1><h2>para el director general</h2><p>Periodo del ${ddmm(d.desde)} al ${ddmm(d.hasta)} de ${esc(anio)} · ${n0(d.dias)} días · generado el ${ddmm(o.hoy)}/${esc(o.hoy.slice(0, 4))}</p><p class="small">${esc(cfg.cubre)}</p><p class="small">Primera versión para revisarla con el área y pulirla.</p></section>`);

  // 2 Resumen ejecutivo
  const destacados = cfg.indicadores.filter((i) => i.destacado).slice(0, 8);
  slide("Resumen ejecutivo", `
<div class="tiles">${destacados.map((i) => tile(i.etiqueta, valorIndicador(i, d.indicadores), semaforoDe(i, d.indicadores), i.sub ? i.sub(d.indicadores) : "")).join("")}</div>
<ol class="bullets">${resumenArea(d).map((b) => `<li>${esc(b)}</li>`).join("")}</ol>`, "Cada cifra tiene en la pantalla una liga a los renglones que la forman.");

  // 3 Evolución contra los reportes guardados
  const serie = serieEvolucion(o.historico ?? [], { desde: d.desde, hasta: d.hasta, dias: d.dias, indicadores: d.indicadores, generado_en: `${o.hoy}T23:59:59Z` });
  if (serie.length >= 2) {
    const renglones = renglonesEvolucion(serie, renglonesEvolucionArea(d.area));
    const cambios = cambiosDestacados(renglones, 5);
    const spark = (vals: (number | null)[], masEsMejor: boolean) => {
      const nums = vals.filter((v): v is number => v != null).map(Math.abs);
      const max = Math.max(1, ...nums);
      const w = 10, gap = 3;
      return `<svg viewBox="0 0 ${vals.length * (w + gap)} 18" width="${vals.length * (w + gap)}" height="18">${vals.map((v, i) => (v == null ? "" : `<rect x="${i * (w + gap)}" y="${18 - Math.max(2, (Math.abs(v) / max) * 16)}" width="${w}" height="${Math.max(2, (Math.abs(v) / max) * 16)}" rx="2" fill="${i === vals.length - 1 ? (masEsMejor ? C.s3 : C.s2) : C.grid}"/>`)).join("")}</svg>`;
    };
    const claseTend = (tnd: string) => (tnd.endsWith("bien") ? "ok" : tnd.endsWith("mal") ? "mal" : "mute");
    slide("Evolución contra los reportes anteriores", `
<table class="list evo"><thead><tr><th>Indicador</th>${serie.map((h) => `<th class="n">${esc(ddmm(h.hasta))}/${esc(h.hasta.slice(2, 4))}</th>`).join("")}<th class="n">Cambio</th><th></th></tr></thead>
<tbody>${renglones.map((r) => `<tr><td>${esc(r.etiqueta)}</td>${r.valores.map((v, i) => `<td class="n${i === r.valores.length - 1 ? " b" : ""}">${esc(formatoValor(v, r.formato))}</td>`).join("")}<td class="n ${claseTend(r.tendencia)}">${esc(textoDelta(r))}</td><td>${spark(r.valores, r.masEsMejor)}</td></tr>`).join("")}</tbody></table>
${cambios.length ? `<h3>Lo que más cambió contra el reporte anterior</h3><ul class="bullets small">${cambios.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}`,
      `Cada columna es un reporte guardado (fecha de corte); verde = mejora, rojo = empeora. ${serie.length} reportes de ${ddmm(serie[0].hasta)} a ${ddmm(serie[serie.length - 1].hasta)}.`);
  }

  // 4 Qué atender
  const alertas = alertasArea(d);
  slide(
    "Qué atender",
    alertas.length === 0
      ? `<p class="bullets">Nada pendiente de atender en este periodo.</p>`
      : `<table class="list"><thead><tr><th></th><th>Hallazgo</th><th>Dónde</th></tr></thead><tbody>${alertas.map((x) => `<tr><td><span class="dot ${x.nivel}"></span></td><td>${esc(x.texto)}</td><td class="mute">${esc(x.ruta)}</td></tr>`).join("")}</tbody></table>`,
    "Rojo = atender esta semana · Ámbar = este mes · Dónde = pantalla de Acumulado",
  );

  // 5… Una lámina por sección: tabla y, si aplica, barras
  for (const sec of cfg.secciones) {
    const filas = filasSeccion(d, sec.clave);
    const barras = sec.barras
      ? hbar(
          filas.slice(0, 12).map((f) => ({ etiqueta: String(f[sec.barras!.etiqueta] ?? "—"), valor: Number(f[sec.barras!.valor] ?? 0) })),
          (v) => formatear(v, sec.columnas.find((c) => c.clave === sec.barras!.valor)?.formato ?? "n"),
        )
      : "";
    const cuerpo = barras ? `<div class="cols"><div>${tablaSeccion(d, sec, 12)}</div><div>${barras}</div></div>` : tablaSeccion(d, sec, 16);
    const extra = filas.length > (barras ? 12 : 16) ? `Se muestran ${barras ? 12 : 16} de ${filas.length} renglones; la pantalla trae todos. ` : "";
    slide(sec.titulo, cuerpo, `${extra}${sec.nota ?? ""}${sec.liga ? ` · Pantalla: ${sec.liga}` : ""}`);
  }

  // Última: por revisar con el área
  slide("Por revisar con el área", `<table class="list def"><thead><tr><th>#</th><th>Qué hay que confirmar o decidir</th></tr></thead><tbody>${cfg.porRevisar.map((x, i) => `<tr><td class="mute">${i + 1}</td><td>${esc(x)}</td></tr>`).join("")}</tbody></table>`, "Primera versión del reporte: estos puntos se van puliendo con el área.");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte ${esc(cfg.titulo)} · director general · ${esc(periodo)}</title>
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
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}
  .tile{background:#fff;border:1px solid ${C.grid};border-radius:6px;padding:9px 12px}
  .tile .v{font-size:22px;font-weight:700;line-height:1.15} .tile .k{font-size:10.5px;color:${C.ink2};margin-top:2px} .tile .sub{font-size:9.5px;color:${C.mute};margin-top:2px}
  .bullets{font-size:13.5px;line-height:1.45;padding-left:20px;margin:4px 0} .bullets li{margin-bottom:3px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  h3{font-size:11px;margin:8px 0 3px;color:${C.ink2};text-transform:uppercase;letter-spacing:.04em}
  table.list{width:100%;border-collapse:collapse;font-size:13px} table.list th{text-align:left;font-size:10px;text-transform:uppercase;color:${C.mute};border-bottom:1px solid ${C.grid};padding:4px 6px}
  table.list td{padding:7px 6px;border-bottom:1px solid ${C.grid};vertical-align:top;line-height:1.35} table.list.def td{font-size:12px;padding:6px}
  table.list.sec{font-size:11px} table.list.sec td{padding:4px 6px} table.list.sec th.r,table.list.sec td.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .dot{display:inline-block;width:11px;height:11px;border-radius:50%} .dot.rojo{background:${C.crit}} .dot.ambar{background:${C.warn}}
  .mute{color:${C.mute};font-size:10.5px;white-space:nowrap}
  table.evo{font-size:11px} table.evo td,table.evo th{padding:3px 5px;white-space:nowrap} table.evo td.n{text-align:right;font-variant-numeric:tabular-nums} table.evo td.b{font-weight:700} table.evo .ok{color:${C.good};font-weight:600} table.evo .mal{color:${C.crit};font-weight:600}
  ul.bullets.small{font-size:11.5px;line-height:1.35;margin-top:4px} .note{font-size:10.5px;color:${C.ink2};margin:4px 0 0;line-height:1.35} .small{font-size:10.5px;line-height:1.4;color:${C.ink2}}
  svg text{font-family:inherit}
  @media print{.btn{display:none}}
</style></head><body><button class="btn" onclick="window.print()">Imprimir / guardar PDF</button>${slides.join("")}</body></html>`;
}
