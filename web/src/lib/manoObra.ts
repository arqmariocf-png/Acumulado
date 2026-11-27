// Listas de raya de mano de obra (27-nov-2026, Laura: "agregar módulo de mano
// de obra para dejar de trabajar en dos sistemas"; Mario: "RH captura, Laura
// autoriza", "convivir un tiempo", "presupuesto por partida"). Puro, sin DOM,
// con pruebas.
//
// Semana igual que el backoffice: de domingo a sábado; el número de semana es
// la semana ISO del sábado (Fecha_fin). Una lista por obra y semana.

export type EstadoLista = "borrador" | "enviada" | "autorizada" | "rechazada" | "cancelada";
export type FormaPago = "transferencia" | "efectivo";
export type TipoTrabajador = "empleado" | "contratista";

export interface RenglonLista {
  id?: string;
  trabajador_id: string | null;
  trabajador_nombre: string;
  tipo_trabajador: TipoTrabajador;
  partida: string;
  subpartida: string | null;
  dias: number | string | null;
  monto: number | string;
  forma_pago: FormaPago;
  notas?: string | null;
}

export const ESTADOS: Record<EstadoLista, { etiqueta: string; clase: string }> = {
  borrador: { etiqueta: "Borrador", clase: "bg-slate-100 text-slate-700" },
  enviada: { etiqueta: "Por autorizar", clase: "bg-amber-100 text-amber-800" },
  autorizada: { etiqueta: "Autorizada · a pago", clase: "bg-emerald-100 text-emerald-800" },
  rechazada: { etiqueta: "Rechazada", clase: "bg-rose-100 text-rose-800" },
  cancelada: { etiqueta: "Cancelada", clase: "bg-slate-100 text-slate-400 line-through" },
};

const n = (x: unknown) => (x == null || x === "" ? 0 : Number(x) || 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

function fechaUtc(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = fechaUtc(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return iso(d);
}

/** Domingo con que empieza la semana de una fecha (como el backoffice). */
export function domingoDe(fecha: string): string {
  const d = fechaUtc(fecha);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return iso(d);
}

/** Número de semana = semana ISO del sábado (igual que `Num_sem` del backoffice). */
export function numeroSemana(domingo: string): number {
  const t = fechaUtc(sumarDias(domingo, 6));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3); // jueves de esa semana ISO
  const jueves = t.getTime();
  const primero = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  if (primero.getUTCDay() !== 4) primero.setUTCDate(1 + ((4 - primero.getUTCDay() + 7) % 7));
  return 1 + Math.round((jueves - primero.getTime()) / 604_800_000);
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function textoSemana(domingo: string): string {
  const fin = sumarDias(domingo, 6);
  const f = (x: string) => `${Number(x.slice(8, 10))} ${MES[Number(x.slice(5, 7)) - 1]}`;
  return `Semana ${numeroSemana(domingo)} · ${f(domingo)} al ${f(fin)} ${fin.slice(0, 4)}`;
}

export interface TotalesLista {
  total: number;
  transferencia: number;
  efectivo: number;
  renglones: number;
  trabajadores: number;
  porPartida: { partida: string; total: number }[];
}

export function totalesLista(renglones: RenglonLista[]): TotalesLista {
  const t: TotalesLista = { total: 0, transferencia: 0, efectivo: 0, renglones: renglones.length, trabajadores: 0, porPartida: [] };
  const gente = new Set<string>();
  const partidas = new Map<string, number>();
  for (const r of renglones) {
    const m = n(r.monto);
    t.total += m;
    t[r.forma_pago] += m;
    gente.add(r.trabajador_id ?? r.trabajador_nombre.trim().toUpperCase());
    const p = r.partida.trim() || "Sin partida";
    partidas.set(p, (partidas.get(p) ?? 0) + m);
  }
  t.total = r2(t.total);
  t.transferencia = r2(t.transferencia);
  t.efectivo = r2(t.efectivo);
  t.trabajadores = gente.size;
  t.porPartida = [...partidas.entries()].map(([partida, total]) => ({ partida, total: r2(total) })).sort((a, b) => b.total - a.total);
  return t;
}

/** Errores de un renglón antes de guardarlo (vacío = bien). */
export function revisarRenglon(r: Pick<RenglonLista, "trabajador_nombre" | "partida" | "monto" | "dias">): string[] {
  const e: string[] = [];
  if (!r.trabajador_nombre.trim()) e.push("Escribe o elige al trabajador.");
  if (!r.partida.trim()) e.push("Escribe la partida.");
  if (!(n(r.monto) > 0)) e.push("El monto debe ser mayor a cero.");
  const d = r.dias;
  if (d != null && d !== "" && (n(d) < 0 || n(d) > 7)) e.push("Los días van de 0 a 7.");
  return e;
}

/** Avisos para enviar la lista a autorizar (no bloquean salvo que no haya renglones). */
export function revisarLista(renglones: RenglonLista[]): { puede: boolean; avisos: string[] } {
  if (!renglones.length) return { puede: false, avisos: ["La lista no tiene renglones."] };
  const avisos: string[] = [];
  const vistos = new Map<string, number>();
  for (const r of renglones) {
    const k = `${r.trabajador_nombre.trim().toUpperCase()}|${r.partida.trim().toUpperCase()}|${(r.subpartida ?? "").trim().toUpperCase()}`;
    vistos.set(k, (vistos.get(k) ?? 0) + 1);
  }
  for (const [k, c] of vistos) if (c > 1) avisos.push(`${k.split("|")[0]} aparece ${c} veces en la misma partida.`);
  return { puede: true, avisos };
}

export type EstadoPresupuesto = "sin_presupuesto" | "en_linea" | "por_agotarse" | "excedido";

export interface AvancePartida {
  partida: string;
  subpartida: string | null;
  presupuesto: number | null;
  ejercido: number;
  conLista?: number;
}

/** Presupuesto contra lo pagado (y lo de la lista que se está revisando). */
export function avancePresupuesto(a: AvancePartida): { total: number; restante: number | null; pct: number | null; estado: EstadoPresupuesto } {
  const total = r2(n(a.ejercido) + n(a.conLista));
  if (a.presupuesto == null) return { total, restante: null, pct: null, estado: "sin_presupuesto" };
  const p = n(a.presupuesto);
  const pct = p > 0 ? Math.round((total / p) * 1000) / 10 : null;
  const restante = r2(p - total);
  const estado: EstadoPresupuesto = restante < 0 ? "excedido" : pct != null && pct >= 90 ? "por_agotarse" : "en_linea";
  return { total, restante, pct, estado };
}

const norm = (t: string | null | undefined) => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase().replace(/\s+/g, " ");

/** Suma lo de la lista a cada partida del avance (por partida y subpartida). */
export function avanceConLista(avance: AvancePartida[], renglones: RenglonLista[]): AvancePartida[] {
  const salida = avance.map((a) => ({ ...a, conLista: 0 }));
  for (const r of renglones) {
    const k = `${norm(r.partida)}|${norm(r.subpartida)}`;
    let fila = salida.find((a) => `${norm(a.partida)}|${norm(a.subpartida)}` === k);
    if (!fila) {
      fila = { partida: r.partida.trim(), subpartida: r.subpartida?.trim() || null, presupuesto: null, ejercido: 0, conLista: 0 };
      salida.push(fila);
    }
    fila.conLista = r2(n(fila.conLista) + n(r.monto));
  }
  return salida;
}

export function filtrarPorTexto<T>(filas: T[], texto: string, campos: (f: T) => (string | null | undefined)[]): T[] {
  const palabras = norm(texto).split(" ").filter(Boolean);
  if (!palabras.length) return filas;
  return filas.filter((f) => {
    const t = norm(campos(f).join(" "));
    return palabras.every((p) => t.includes(p));
  });
}

function esc(t: string | number | null | undefined): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const dinero = (x: number) => `$${x.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface ListaImpresion {
  folio: string | null;
  obra: string;
  empresa: string;
  semana_inicio: string;
  estado: EstadoLista;
  capturo: string | null;
  autorizo: string | null;
  fecha_pago: string | null;
  notas: string | null;
}

/** Lista de raya imprimible (horizontal) con firmas de recibido. */
export function htmlListaRaya(l: ListaImpresion, renglones: RenglonLista[], logo?: string | null): string {
  const t = totalesLista(renglones);
  const filas = renglones
    .map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.trabajador_nombre)}<div class="m">${r.tipo_trabajador === "contratista" ? "Contratista" : "Empleado"}</div></td><td>${esc(r.partida)}</td><td>${esc(r.subpartida)}</td><td class="n">${r.dias == null || r.dias === "" ? "" : esc(r.dias)}</td><td>${r.forma_pago === "efectivo" ? "Efectivo" : "Transferencia"}</td><td class="n">${dinero(n(r.monto))}</td><td class="f"></td></tr>`)
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Lista de raya ${esc(l.folio)}</title><style>
  @page { size: letter landscape; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
  header img { max-height: 48px; max-width: 160px; } h1 { font-size: 16px; margin: 0; } .s { color: #555; margin: 2px 0 0; }
  table { width: 100%; border-collapse: collapse; } th { background: #111; color: #fff; text-align: left; padding: 4px; font-size: 10px; }
  td { border-bottom: 1px solid #ddd; padding: 4px; vertical-align: top; } .n { text-align: right; white-space: nowrap; } .m { color: #666; font-size: 9px; }
  .f { width: 120px; } tfoot td { font-weight: bold; border-top: 2px solid #111; }
  .firmas { display: flex; gap: 32px; margin-top: 40px; } .firmas div { flex: 1; border-top: 1px solid #111; text-align: center; padding-top: 4px; }
  </style></head><body>
  <header><div>${logo ? `<img src="${esc(logo)}" alt="">` : ""}<h1>Lista de raya ${esc(l.folio)}</h1><p class="s">${esc(l.empresa)} · ${esc(l.obra)}</p><p class="s">${esc(textoSemana(l.semana_inicio))}</p></div>
  <div style="text-align:right"><b>${esc(ESTADOS[l.estado].etiqueta)}</b>${l.fecha_pago ? `<p class="s">Pago: ${esc(l.fecha_pago.split("-").reverse().join("/"))}</p>` : ""}<p class="s">${t.trabajadores} trabajadores · ${t.renglones} renglones</p></div></header>
  <table><thead><tr><th>#</th><th>Trabajador</th><th>Partida</th><th>Subpartida</th><th class="n">Días</th><th>Forma</th><th class="n">Monto</th><th>Firma de recibido</th></tr></thead>
  <tbody>${filas || `<tr><td colspan="8">Sin renglones.</td></tr>`}</tbody>
  <tfoot><tr><td colspan="6">Transferencia ${dinero(t.transferencia)} · Efectivo ${dinero(t.efectivo)}</td><td class="n">${dinero(t.total)}</td><td></td></tr></tfoot></table>
  ${l.notas ? `<p><b>Notas:</b> ${esc(l.notas)}</p>` : ""}
  <div class="firmas"><div>Capturó (RH)<br>${esc(l.capturo)}</div><div>Autorizó (dirección)<br>${esc(l.autorizo)}</div><div>Residente de obra</div></div>
  </body></html>`;
}

function celdaCsv(v: string | number | null | undefined): string {
  const t = String(v ?? "");
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function csvLista(l: ListaImpresion, renglones: RenglonLista[]): string {
  const enc = ["Folio", "Empresa", "Obra", "Semana", "Del", "Al", "Estado", "Trabajador", "Tipo", "Partida", "Subpartida", "Días", "Forma de pago", "Monto"];
  const filas = renglones.map((r) => [l.folio, l.empresa, l.obra, numeroSemana(l.semana_inicio), l.semana_inicio, sumarDias(l.semana_inicio, 6), ESTADOS[l.estado].etiqueta, r.trabajador_nombre, r.tipo_trabajador, r.partida, r.subpartida, r.dias, r.forma_pago, n(r.monto)]);
  return [enc, ...filas].map((f) => f.map(celdaCsv).join(",")).join("\n");
}
