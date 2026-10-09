// Reporte del checador en formato horizontal (Mario, 9-oct-2026): una fila
// por trabajador y día con las 4 etapas (entrada, salida a comer, regreso
// de comer, salida) y las horas activas del día = (salida − entrada) −
// (regreso − salida a comer). Puro, con pruebas; la pantalla y la impresión
// lo usan igual.

export type TipoMarcaReporte = "entrada" | "salida" | "comida_inicio" | "comida_fin";

export interface MarcaReporte {
  profile_id: string;
  nombre: string;
  tipo: TipoMarcaReporte;
  created_at: string;
  anulada?: boolean;
}

export interface FilaChecador {
  profile_id: string;
  nombre: string;
  fecha: string; // AAAA-MM-DD en hora de México
  entrada: string | null; // ISO
  comida_inicio: string | null;
  comida_fin: string | null;
  salida: string | null;
  /** Minutos activos; null si falta entrada o salida. */
  minutos: number | null;
  /** Qué falta para cerrar el día (vacío si está completo). */
  faltan: string[];
}

export const ZONA = "America/Mexico_City";

export function fechaLocal(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function horaLocal(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function formatoHoras(minutos: number | null): string {
  if (minutos == null) return "—";
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return `${h}:${String(m).padStart(2, "0")} h`;
}

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);

/** Arma una fila por persona y día. Entrada = la primera del día; salida =
 * la última; comida = la primera salida a comer y el último regreso.
 * Ordenado por nombre y luego fecha (más reciente primero). */
export function armarReporteChecador(marcas: MarcaReporte[]): FilaChecador[] {
  const grupos = new Map<string, FilaChecador>();
  for (const m of marcas) {
    if (m.anulada) continue;
    const fecha = fechaLocal(m.created_at);
    const llave = `${m.profile_id}|${fecha}`;
    let f = grupos.get(llave);
    if (!f) {
      f = { profile_id: m.profile_id, nombre: m.nombre, fecha, entrada: null, comida_inicio: null, comida_fin: null, salida: null, minutos: null, faltan: [] };
      grupos.set(llave, f);
    }
    const t = m.created_at;
    if (m.tipo === "entrada") f.entrada = f.entrada ? min(f.entrada, t) : t;
    else if (m.tipo === "salida") f.salida = f.salida ? max(f.salida, t) : t;
    else if (m.tipo === "comida_inicio") f.comida_inicio = f.comida_inicio ? min(f.comida_inicio, t) : t;
    else if (m.tipo === "comida_fin") f.comida_fin = f.comida_fin ? max(f.comida_fin, t) : t;
  }
  for (const f of grupos.values()) {
    if (!f.entrada) f.faltan.push("entrada");
    if (!f.comida_inicio) f.faltan.push("salida a comer");
    if (!f.comida_fin) f.faltan.push("regreso de comer");
    if (!f.salida) f.faltan.push("salida");
    if (f.entrada && f.salida && f.salida > f.entrada) {
      let ms = Date.parse(f.salida) - Date.parse(f.entrada);
      if (f.comida_inicio && f.comida_fin && f.comida_fin > f.comida_inicio) ms -= Date.parse(f.comida_fin) - Date.parse(f.comida_inicio);
      f.minutos = Math.max(0, Math.round(ms / 60000));
    }
  }
  return [...grupos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || b.fecha.localeCompare(a.fecha));
}

/** Total de minutos activos por persona en el periodo. */
export function totalesPorPersona(filas: FilaChecador[]): Map<string, { minutos: number; dias: number; incompletos: number }> {
  const t = new Map<string, { minutos: number; dias: number; incompletos: number }>();
  for (const f of filas) {
    const x = t.get(f.profile_id) ?? { minutos: 0, dias: 0, incompletos: 0 };
    x.dias += 1;
    if (f.minutos != null) x.minutos += f.minutos;
    else x.incompletos += 1;
    t.set(f.profile_id, x);
  }
  return t;
}

function fechaTexto(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, d)));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** CSV para Excel (separado por comas, con BOM para acentos). */
export function csvReporteChecador(filas: FilaChecador[]): string {
  const enc = ["Trabajador", "Fecha", "Entrada", "Salida a comer", "Regreso de comer", "Salida", "Horas activas", "Falta"];
  const lineas = filas.map((f) => [f.nombre, f.fecha, horaLocal(f.entrada), horaLocal(f.comida_inicio), horaLocal(f.comida_fin), horaLocal(f.salida), f.minutos != null ? (f.minutos / 60).toFixed(2) : "", f.faltan.join(" / ")]);
  return "﻿" + [enc, ...lineas].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

/** Hoja imprimible en horizontal, agrupada por trabajador con su total. */
export function htmlReporteChecador(filas: FilaChecador[], periodo: string): string {
  const totales = totalesPorPersona(filas);
  const porPersona = new Map<string, FilaChecador[]>();
  for (const f of filas) porPersona.set(f.profile_id, [...(porPersona.get(f.profile_id) ?? []), f]);
  const bloques = [...porPersona.values()]
    .map((fs) => {
      const t = totales.get(fs[0].profile_id)!;
      const renglones = fs
        .map((f) => `<tr><td>${esc(fechaTexto(f.fecha))}</td><td>${horaLocal(f.entrada)}</td><td>${horaLocal(f.comida_inicio)}</td><td>${horaLocal(f.comida_fin)}</td><td>${horaLocal(f.salida)}</td><td class="n">${formatoHoras(f.minutos)}</td><td class="f">${esc(f.faltan.join(", "))}</td></tr>`)
        .join("");
      return `<tbody><tr class="p"><td colspan="7">${esc(fs[0].nombre)}</td></tr>${renglones}<tr class="t"><td colspan="5">Total ${t.dias} día(s)${t.incompletos ? ` · ${t.incompletos} sin cerrar` : ""}</td><td class="n">${formatoHoras(t.minutos)}</td><td></td></tr></tbody>`;
    })
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte del checador</title><style>
@page{size:letter landscape;margin:12mm}body{font-family:system-ui,sans-serif;font-size:11px;color:#0f172a}h1{font-size:16px;margin:0 0 4px}p{margin:0 0 10px;color:#475569}
table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e2e8f0;padding:4px 6px;text-align:left}th{background:#0f172a;color:#fff;font-size:10px;text-transform:uppercase}
.p td{background:#f1f5f9;font-weight:600}.t td{font-weight:600;border-bottom:2px solid #94a3b8}.n{text-align:right;white-space:nowrap}.f{color:#b45309;font-size:10px}
</style></head><body><h1>Reporte del checador</h1><p>${esc(periodo)} · horas activas = salida − entrada − tiempo de comida</p>
<table><thead><tr><th>Fecha</th><th>Entrada</th><th>Salida a comer</th><th>Regreso de comer</th><th>Salida</th><th class="n">Horas activas</th><th>Falta</th></tr></thead>${bloques}</table></body></html>`;
}
