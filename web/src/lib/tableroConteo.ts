// Tablero en vivo del conteo de inventario (19-nov-2026, Mario: "genérame
// en el área de almacén un dashboard en tiempo real de quiénes están
// contando, qué llevan contado y en dónde están ubicados"). Reglas puras de
// pages/inventario/TableroConteo.tsx: por persona (activa = capturó en los
// últimos minutos, último lugar, ritmo), por lugar, por artículo y la serie
// por intervalos de tiempo.

import type { ItemConteo } from "./conteoInventario";

/** Minutos sin capturar a partir de los cuales la persona ya no se considera "contando ahora". */
export const MINUTOS_ACTIVO = 10;

export interface PersonaTablero {
  contado_por: string;
  persona: string;
  items: number;
  cantidad: number;
  primero: string;
  ultimo: string;
  /** Minutos desde su última captura. */
  minutos_sin_capturar: number;
  activa: boolean;
  ultima_ubicacion: string | null;
  ultima_empresa_id: string;
  /** Ítems capturados en los últimos 60 minutos. */
  ultima_hora: number;
  empresas: string[];
}

function minutosEntre(desde: string, hasta: Date): number {
  return Math.max(0, Math.round((hasta.getTime() - new Date(desde).getTime()) / 60000));
}

/** Una fila por persona, las activas primero y luego por última captura. */
export function personasTablero(items: ItemConteo[], ahora: Date): PersonaTablero[] {
  const mapa = new Map<string, PersonaTablero>();
  const orden = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const haceUnaHora = new Date(ahora.getTime() - 60 * 60000).toISOString();
  for (const i of orden) {
    let p = mapa.get(i.contado_por);
    if (!p) {
      p = {
        contado_por: i.contado_por,
        persona: i.contado_por_nombre ?? "(sin nombre)",
        items: 0,
        cantidad: 0,
        primero: i.created_at,
        ultimo: i.created_at,
        minutos_sin_capturar: 0,
        activa: false,
        ultima_ubicacion: null,
        ultima_empresa_id: i.empresa_id,
        ultima_hora: 0,
        empresas: [],
      };
      mapa.set(i.contado_por, p);
    }
    p.items += 1;
    p.cantidad = Math.round((p.cantidad + Number(i.cantidad)) * 1000) / 1000;
    p.ultimo = i.created_at;
    p.ultima_ubicacion = i.ubicacion ?? p.ultima_ubicacion;
    p.ultima_empresa_id = i.empresa_id;
    if (i.created_at >= haceUnaHora) p.ultima_hora += 1;
    if (!p.empresas.includes(i.empresa_id)) p.empresas.push(i.empresa_id);
  }
  for (const p of mapa.values()) {
    p.minutos_sin_capturar = minutosEntre(p.ultimo, ahora);
    p.activa = p.minutos_sin_capturar <= MINUTOS_ACTIVO;
  }
  return [...mapa.values()].sort((a, b) => Number(b.activa) - Number(a.activa) || b.ultimo.localeCompare(a.ultimo));
}

export interface LugarTablero {
  ubicacion: string;
  items: number;
  cantidad: number;
  personas: string[];
  ultimo: string;
}

/** Qué hay contado en cada lugar (ubicación del ítem; "sin ubicación" si no la tiene). */
export function lugaresTablero(items: ItemConteo[]): LugarTablero[] {
  const mapa = new Map<string, LugarTablero>();
  for (const i of items) {
    const k = i.ubicacion?.trim() || "(sin ubicación)";
    let l = mapa.get(k);
    if (!l) {
      l = { ubicacion: k, items: 0, cantidad: 0, personas: [], ultimo: i.created_at };
      mapa.set(k, l);
    }
    l.items += 1;
    l.cantidad = Math.round((l.cantidad + Number(i.cantidad)) * 1000) / 1000;
    if (i.created_at > l.ultimo) l.ultimo = i.created_at;
    const nombre = i.contado_por_nombre ?? "(sin nombre)";
    if (!l.personas.includes(nombre)) l.personas.push(nombre);
  }
  return [...mapa.values()].sort((a, b) => b.items - a.items || a.ubicacion.localeCompare(b.ubicacion, "es", { numeric: true }));
}

export interface ArticuloTablero {
  clave: string;
  descripcion: string;
  empresa_id: string;
  unidad: string;
  cantidad: number;
  renglones: number;
  lugares: string[];
}

/**
 * Lo contado por artículo: por producto del catálogo (clave de control) o,
 * si el ítem no tiene producto, por descripción normalizada dentro de la empresa.
 */
export function articulosTablero(items: ItemConteo[], claves: Map<string, string>): ArticuloTablero[] {
  const mapa = new Map<string, ArticuloTablero>();
  for (const i of items) {
    const k = i.producto_id ? `p:${i.producto_id}` : `d:${i.empresa_id}|${normalizar(i.descripcion)}|${i.unidad}`;
    let a = mapa.get(k);
    if (!a) {
      a = { clave: (i.producto_id && claves.get(i.producto_id)) || (i.herramienta_id && i.codigo_barras ? i.codigo_barras : i.codigo), descripcion: i.descripcion, empresa_id: i.empresa_id, unidad: i.unidad, cantidad: 0, renglones: 0, lugares: [] };
      mapa.set(k, a);
    }
    a.cantidad = Math.round((a.cantidad + Number(i.cantidad)) * 1000) / 1000;
    a.renglones += 1;
    if (i.ubicacion && !a.lugares.includes(i.ubicacion)) a.lugares.push(i.ubicacion);
  }
  return [...mapa.values()].sort((a, b) => b.cantidad - a.cantidad || a.descripcion.localeCompare(b.descripcion, "es"));
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface TramoTiempo {
  /** Inicio del tramo (ISO). */
  desde: string;
  etiqueta: string;
  items: number;
}

/** Ítems capturados por tramos de N minutos entre la primera captura y ahora (máximo 48 tramos). */
export function serieTiempo(items: ItemConteo[], ahora: Date, minutos = 15): TramoTiempo[] {
  if (!items.length) return [];
  const paso = minutos * 60000;
  const primero = Math.min(...items.map((i) => new Date(i.created_at).getTime()));
  let inicio = Math.floor(primero / paso) * paso;
  const fin = Math.floor(ahora.getTime() / paso) * paso;
  const tramos: TramoTiempo[] = [];
  const maxTramos = 48;
  if ((fin - inicio) / paso + 1 > maxTramos) inicio = fin - (maxTramos - 1) * paso;
  for (let t = inicio; t <= fin; t += paso) tramos.push({ desde: new Date(t).toISOString(), etiqueta: horaCorta(new Date(t)), items: 0 });
  for (const i of items) {
    const t = Math.floor(new Date(i.created_at).getTime() / paso) * paso;
    const idx = Math.round((t - inicio) / paso);
    if (idx >= 0 && idx < tramos.length) tramos[idx].items += 1;
  }
  return tramos;
}

export function horaCorta(d: Date): string {
  return new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

/** "hace 3 min", "hace 1 h 05 min". */
export function textoHace(minutos: number): string {
  if (minutos < 1) return "ahora mismo";
  if (minutos < 60) return `hace ${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `hace ${h} h ${String(m).padStart(2, "0")} min`;
}

export interface TotalesTablero {
  personas: number;
  activas: number;
  items: number;
  cantidad: number;
  lugares: number;
  empresas: number;
  ultima_captura: string | null;
}

export function totalesTablero(items: ItemConteo[], personas: PersonaTablero[]): TotalesTablero {
  return {
    personas: personas.length,
    activas: personas.filter((p) => p.activa).length,
    items: items.length,
    cantidad: Math.round(items.reduce((s, i) => s + Number(i.cantidad), 0) * 1000) / 1000,
    lugares: new Set(items.map((i) => i.ubicacion?.trim() || "")).size - (items.some((i) => !i.ubicacion?.trim()) ? 1 : 0),
    empresas: new Set(items.map((i) => i.empresa_id)).size,
    ultima_captura: items.length ? items.reduce((m, i) => (i.created_at > m ? i.created_at : m), items[0].created_at) : null,
  };
}
