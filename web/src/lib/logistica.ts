// Logística (9-nov-2026, Mario: "el módulo de logística donde cargaremos las
// unidades consultadas en el calendario de reservas; va a poner el API del
// sistema actual de reservas, y ahí vamos a reportar averías"). Reglas puras
// de la pantalla; la base las repite en los triggers logistica_*_antes.

export type TipoUnidad = "camioneta" | "camion" | "tractocamion" | "remolque" | "auto" | "maquinaria" | "motocicleta" | "otro";
export type EstadoUnidad = "activa" | "taller" | "baja";
export type EstadoReserva = "programada" | "en_curso" | "terminada" | "cancelada";
export type GravedadAveria = "leve" | "media" | "grave";
export type EstadoAveria = "abierta" | "en_taller" | "resuelta" | "descartada";

export const TIPOS_UNIDAD: { clave: TipoUnidad; etiqueta: string }[] = [
  { clave: "camioneta", etiqueta: "Camioneta" },
  { clave: "camion", etiqueta: "Camión" },
  { clave: "tractocamion", etiqueta: "Tractocamión" },
  { clave: "remolque", etiqueta: "Remolque" },
  { clave: "auto", etiqueta: "Auto" },
  { clave: "maquinaria", etiqueta: "Maquinaria" },
  { clave: "motocicleta", etiqueta: "Motocicleta" },
  { clave: "otro", etiqueta: "Otro" },
];
export const ETIQUETA_ESTADO_UNIDAD: Record<EstadoUnidad, string> = { activa: "activa", taller: "en taller", baja: "baja" };
export const CLASE_ESTADO_UNIDAD: Record<EstadoUnidad, string> = { activa: "bg-emerald-100 text-emerald-800", taller: "bg-red-100 text-red-800", baja: "bg-slate-200 text-slate-600" };
export const ETIQUETA_ESTADO_RESERVA: Record<EstadoReserva, string> = { programada: "programada", en_curso: "en curso", terminada: "terminada", cancelada: "cancelada" };
export const CLASE_ESTADO_RESERVA: Record<EstadoReserva, string> = { programada: "bg-sky-100 text-sky-800 border-sky-200", en_curso: "bg-emerald-100 text-emerald-800 border-emerald-200", terminada: "bg-slate-100 text-slate-600 border-slate-200", cancelada: "bg-slate-50 text-slate-400 border-slate-200 line-through" };
export const ETIQUETA_GRAVEDAD: Record<GravedadAveria, string> = { leve: "leve", media: "media", grave: "grave (la unidad no debe salir)" };
export const CLASE_GRAVEDAD: Record<GravedadAveria, string> = { leve: "bg-amber-50 text-amber-800", media: "bg-amber-100 text-amber-900", grave: "bg-red-100 text-red-800" };
export const ETIQUETA_ESTADO_AVERIA: Record<EstadoAveria, string> = { abierta: "abierta", en_taller: "en taller", resuelta: "resuelta", descartada: "descartada" };

export interface Unidad {
  id: string;
  empresa_id: string;
  folio: string | null;
  nombre: string;
  tipo: TipoUnidad;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  placas: string | null;
  numero_serie: string | null;
  capacidad: string | null;
  chofer_id: string | null;
  chofer_nombre: string | null;
  estado: EstadoUnidad;
  externo_id: string | null;
  notas: string | null;
}

export interface Reserva {
  id: string;
  empresa_id: string;
  unidad_id: string;
  desde: string;
  hasta: string;
  titulo: string;
  destino: string | null;
  proyecto_id: string | null;
  cliente: string | null;
  chofer_id: string | null;
  chofer_nombre: string | null;
  estado: EstadoReserva;
  origen: "manual" | "api";
  externo_id: string | null;
  notas: string | null;
}

export interface Averia {
  id: string;
  empresa_id: string;
  unidad_id: string;
  reserva_id: string | null;
  folio: string | null;
  fecha: string;
  descripcion: string;
  gravedad: GravedadAveria;
  kilometraje: number | null;
  reportado_por: string | null;
  reportante_nombre: string | null;
  estado: EstadoAveria;
  resuelto_en: string | null;
  resolucion: string | null;
  costo: number | null;
}

/** Lo que falta para dar de alta la unidad, o null. */
export function revisarUnidad(u: { nombre: string; empresa_id: string; anio?: string | number | null; placas?: string | null }, existentes: Pick<Unidad, "placas" | "empresa_id" | "id">[] = [], idActual?: string): string | null {
  if (u.nombre.trim().length < 2) return "Escribe el nombre de la unidad (ej. Camioneta NP300 blanca).";
  if (!u.empresa_id) return "Elige la empresa dueña de la unidad.";
  if (u.anio !== undefined && u.anio !== null && String(u.anio).trim() !== "") {
    const a = Number(u.anio);
    if (!Number.isInteger(a) || a < 1950 || a > 2100) return "El año no es válido.";
  }
  const placas = normalizarPlacas(u.placas);
  if (placas) {
    const rep = existentes.find((e) => e.id !== idActual && e.empresa_id === u.empresa_id && normalizarPlacas(e.placas) === placas);
    if (rep) return `Ya hay una unidad con placas ${placas} en esa empresa.`;
  }
  return null;
}

export function normalizarPlacas(p: string | null | undefined): string | null {
  const s = (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s || null;
}

/** Dos reservas vivas de la misma unidad no se enciman (misma regla que el trigger). */
export function choqueReserva(nueva: { unidad_id: string; desde: string; hasta: string; id?: string }, reservas: Pick<Reserva, "id" | "unidad_id" | "desde" | "hasta" | "estado" | "titulo">[]): Pick<Reserva, "id" | "titulo" | "desde" | "hasta"> | null {
  const d = new Date(nueva.desde).getTime();
  const h = new Date(nueva.hasta).getTime();
  for (const r of reservas) {
    if (r.unidad_id !== nueva.unidad_id || r.id === nueva.id || r.estado === "cancelada") continue;
    const rd = new Date(r.desde).getTime();
    const rh = new Date(r.hasta).getTime();
    if (rd < h && rh > d) return r;
  }
  return null;
}

export function revisarReserva(r: { unidad_id: string; desde: string; hasta: string; titulo: string; id?: string }, reservas: Pick<Reserva, "id" | "unidad_id" | "desde" | "hasta" | "estado" | "titulo">[], unidades: Pick<Unidad, "id" | "estado">[] = []): string | null {
  if (!r.unidad_id) return "Elige la unidad.";
  if (r.titulo.trim().length < 3) return "Escribe para qué es la reserva (viaje, obra, cliente).";
  if (!r.desde || !r.hasta) return "Indica desde y hasta cuándo.";
  if (new Date(r.hasta).getTime() <= new Date(r.desde).getTime()) return "La hora de regreso debe ser después de la salida.";
  const u = unidades.find((x) => x.id === r.unidad_id);
  if (u && u.estado === "baja") return "Esa unidad está dada de baja.";
  const c = choqueReserva(r, reservas);
  if (c) return `La unidad ya está reservada: ${c.titulo} (${horaCorta(c.desde)} a ${horaCorta(c.hasta)}).`;
  return null;
}

export function revisarAveria(a: { unidad_id: string; descripcion: string; gravedad: string; kilometraje?: string | number | null }): string | null {
  if (!a.unidad_id) return "Elige la unidad con la avería.";
  if (a.descripcion.trim().length < 8) return "Describe la avería (qué falla, desde cuándo).";
  if (!["leve", "media", "grave"].includes(a.gravedad)) return "Elige la gravedad.";
  if (a.kilometraje !== undefined && a.kilometraje !== null && String(a.kilometraje).trim() !== "" && !(Number(a.kilometraje) >= 0)) return "El kilometraje no es válido.";
  return null;
}

/** Lunes a domingo de la semana que contiene la fecha (ISO AAAA-MM-DD). */
export function semanaDe(fechaIso: string): string[] {
  const d = new Date(`${fechaIso}T12:00:00`);
  const dow = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return isoLocal(x);
  });
}

export function sumarDias(fechaIso: string, n: number): string {
  const d = new Date(`${fechaIso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}

export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Reservas de una unidad que tocan ese día (hora local). */
export function reservasDelDia<T extends Pick<Reserva, "unidad_id" | "desde" | "hasta" | "estado">>(reservas: T[], unidadId: string, diaIso: string, conCanceladas = false): T[] {
  const ini = new Date(`${diaIso}T00:00:00`).getTime();
  const fin = ini + 24 * 60 * 60 * 1000;
  return reservas
    .filter((r) => r.unidad_id === unidadId && (conCanceladas || r.estado !== "cancelada"))
    .filter((r) => new Date(r.desde).getTime() < fin && new Date(r.hasta).getTime() > ini)
    .sort((a, b) => a.desde.localeCompare(b.desde));
}

export function horaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Qué unidades están libres en un rango (sin reserva viva ni taller/baja). */
export function unidadesLibres(unidades: Pick<Unidad, "id" | "estado">[], reservas: Pick<Reserva, "id" | "unidad_id" | "desde" | "hasta" | "estado" | "titulo">[], desde: string, hasta: string): string[] {
  return unidades.filter((u) => u.estado === "activa" && !choqueReserva({ unidad_id: u.id, desde, hasta }, reservas)).map((u) => u.id);
}

/** Semáforo de la unidad: rojo = taller o avería grave abierta; ámbar = avería
 * abierta; gris = baja; verde = sin pendientes. */
export function semaforoUnidad(u: Pick<Unidad, "id" | "estado">, averias: Pick<Averia, "unidad_id" | "estado" | "gravedad">[]): "rojo" | "ambar" | "verde" | "gris" {
  if (u.estado === "baja") return "gris";
  const abiertas = averias.filter((a) => a.unidad_id === u.id && (a.estado === "abierta" || a.estado === "en_taller"));
  if (u.estado === "taller" || abiertas.some((a) => a.gravedad === "grave" || a.estado === "en_taller")) return "rojo";
  if (abiertas.length) return "ambar";
  return "verde";
}

export function resumenAverias(averias: Pick<Averia, "estado" | "gravedad" | "costo">[]): { abiertas: number; enTaller: number; graves: number; costoResueltas: number } {
  let abiertas = 0;
  let enTaller = 0;
  let graves = 0;
  let costo = 0;
  for (const a of averias) {
    if (a.estado === "abierta") abiertas++;
    if (a.estado === "en_taller") enTaller++;
    if ((a.estado === "abierta" || a.estado === "en_taller") && a.gravedad === "grave") graves++;
    if (a.estado === "resuelta") costo += Number(a.costo ?? 0);
  }
  return { abiertas, enTaller, graves, costoResueltas: costo };
}

/** Filtro de texto sin acentos sobre unidades (nombre, placas, folio, marca, modelo, chofer). */
export function filtrarUnidades<T extends Pick<Unidad, "nombre" | "placas" | "folio" | "marca" | "modelo" | "chofer_nombre">>(unidades: T[], texto: string): T[] {
  const q = sinAcentos(texto);
  if (!q) return unidades;
  return unidades.filter((u) => sinAcentos([u.nombre, u.placas, u.folio, u.marca, u.modelo, u.chofer_nombre].filter(Boolean).join(" ")).includes(q));
}

function sinAcentos(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
