// Días de retraso en la entrega de actividades (Laura, 27-nov-2026: "hacer un
// formato de penalización o dejar en evidencia los días de retraso que han
// tenido para la entrega de actividades"). Puro: se prueba en node.
//
// Retraso = días naturales entre la fecha límite y el día en que se terminó
// (hecha tarde) o hoy (vencida sin terminar). El formato no calcula montos: un
// descuento por retraso no es legal vía nómina (art. 110 LFT); deja la
// evidencia, el acuerdo y las firmas.

import { clasificar, type ActividadBase, type EstadoCumplimiento } from "./cumplimiento.ts";

function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10));
  const b = Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Días de retraso de una actividad (0 si va a tiempo, pendiente o sin fecha). */
export function diasRetraso(a: ActividadBase, hoyIso: string): number {
  if (!a.fecha_limite) return 0;
  const estado = clasificar(a, hoyIso);
  if (estado === "vencida") return Math.max(0, diasEntre(a.fecha_limite, hoyIso.slice(0, 10)));
  if (estado === "tarde") return Math.max(0, diasEntre(a.fecha_limite, (a.hecha_en ?? hoyIso).slice(0, 10)));
  return 0;
}

export function textoRetraso(dias: number, estado: EstadoCumplimiento): string {
  if (dias <= 0) return "";
  const d = dias === 1 ? "1 día" : `${dias} días`;
  return estado === "vencida" ? `${d} de retraso` : `entregada con ${d} de retraso`;
}

export interface RenglonRetraso {
  id: string;
  titulo: string;
  tablero: string;
  asignado_a: string | null;
  fecha_limite: string;
  terminada: string | null;
  estado: "vencida" | "tarde";
  dias: number;
}

export interface PersonaRetraso {
  asignado_a: string | null;
  nombre: string;
  tareas: number;
  con_retraso: number;
  vencidas: number;
  tarde: number;
  dias_total: number;
  dias_max: number;
  dias_promedio: number;
  renglones: RenglonRetraso[];
}

/** Agrupa por responsable las actividades con retraso (más días primero). */
export function retrasosPorPersona(
  actividades: (ActividadBase & { tablero?: string })[],
  hoyIso: string,
  nombre: (id: string | null) => string,
): PersonaRetraso[] {
  const mapa = new Map<string | null, PersonaRetraso>();
  for (const a of actividades) {
    const fila = mapa.get(a.asignado_a) ?? { asignado_a: a.asignado_a, nombre: nombre(a.asignado_a), tareas: 0, con_retraso: 0, vencidas: 0, tarde: 0, dias_total: 0, dias_max: 0, dias_promedio: 0, renglones: [] };
    fila.tareas++;
    const estado = clasificar(a, hoyIso);
    const dias = diasRetraso(a, hoyIso);
    if (dias > 0 && (estado === "vencida" || estado === "tarde") && a.fecha_limite) {
      fila.con_retraso++;
      if (estado === "vencida") fila.vencidas++;
      else fila.tarde++;
      fila.dias_total += dias;
      fila.dias_max = Math.max(fila.dias_max, dias);
      fila.renglones.push({ id: a.id, titulo: a.titulo, tablero: a.tablero ?? "", asignado_a: a.asignado_a, fecha_limite: a.fecha_limite, terminada: estado === "tarde" ? (a.hecha_en ?? hoyIso).slice(0, 10) : null, estado, dias });
    }
    mapa.set(a.asignado_a, fila);
  }
  const salida = [...mapa.values()].filter((f) => f.con_retraso > 0);
  for (const f of salida) {
    f.dias_promedio = Math.round((10 * f.dias_total) / f.con_retraso) / 10;
    f.renglones.sort((x, y) => y.dias - x.dias || x.fecha_limite.localeCompare(y.fecha_limite));
  }
  return salida.sort((a, b) => b.dias_total - a.dias_total || a.nombre.localeCompare(b.nombre));
}

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fecha(iso: string | null): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Formato imprimible: una hoja por persona con sus actividades con retraso,
 * espacio para el acuerdo y firmas (persona, jefe directo, RH). */
export function htmlFormatoRetrasos(personas: PersonaRetraso[], opciones: { organizacion: string; hoy: string; periodo?: string }): string {
  const hojas = personas.map((p) => `
  <section class="hoja">
    <header><div><h1>Retraso en la entrega de actividades</h1><p>${esc(opciones.organizacion)}${opciones.periodo ? ` · ${esc(opciones.periodo)}` : ""}</p></div><p class="der">Fecha: ${fecha(opciones.hoy)}</p></header>
    <table class="datos"><tr><th>Responsable</th><td>${esc(p.nombre)}</td><th>Actividades</th><td>${p.tareas}</td></tr>
    <tr><th>Con retraso</th><td>${p.con_retraso} (${p.vencidas} sin terminar · ${p.tarde} entregadas tarde)</td><th>Días de retraso</th><td><b>${p.dias_total}</b> en total · máx. ${p.dias_max} · prom. ${p.dias_promedio}</td></tr></table>
    <table class="lista"><thead><tr><th>#</th><th>Actividad</th><th>Tablero</th><th>Fecha límite</th><th>Terminada</th><th class="n">Días de retraso</th></tr></thead><tbody>
    ${p.renglones.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.titulo.split("\n")[0])}</td><td>${esc(r.tablero)}</td><td>${fecha(r.fecha_limite)}</td><td>${r.terminada ? fecha(r.terminada) : "<b>sin terminar</b>"}</td><td class="n"><b>${r.dias}</b></td></tr>`).join("")}
    </tbody></table>
    <div class="caja"><b>Explicación de la persona:</b></div>
    <div class="caja"><b>Acuerdo / medida (nueva fecha, apoyo, llamada de atención, acta administrativa):</b></div>
    <p class="nota">Los días se cuentan naturales desde la fecha límite hasta que la actividad se terminó o hasta hoy. Este formato es evidencia del cumplimiento; cualquier medida disciplinaria se apega al reglamento interior y a la LFT (no se descuenta de nómina por retraso).</p>
    <div class="firmas"><div>Responsable<br>${esc(p.nombre)}</div><div>Jefe directo</div><div>Recursos humanos</div></div>
  </section>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Retrasos en actividades</title><style>
  @page { size: letter; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; margin: 0; }
  .hoja { page-break-after: always; } .hoja:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; border-bottom: 2px solid #111; margin-bottom: 8px; }
  h1 { font-size: 16px; margin: 0 0 2px; } header p { margin: 0 0 6px; color: #555; } .der { align-self: flex-end; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .datos th { text-align: left; background: #f1f5f9; width: 14%; } .datos th, .datos td { border: 1px solid #cbd5e1; padding: 4px 6px; }
  .lista th { background: #111; color: #fff; text-align: left; padding: 4px; font-size: 10px; } .lista td { border-bottom: 1px solid #e2e8f0; padding: 4px; vertical-align: top; }
  .n { text-align: right; } .caja { border: 1px solid #94a3b8; min-height: 60px; padding: 4px 6px; margin-bottom: 8px; }
  .nota { color: #555; font-size: 9px; } .firmas { display: flex; gap: 24px; margin-top: 48px; } .firmas div { flex: 1; border-top: 1px solid #111; text-align: center; padding-top: 4px; }
  </style></head><body>${hojas || "<p>No hay actividades con retraso.</p>"}</body></html>`;
}
