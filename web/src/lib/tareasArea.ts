// Tareas por área (21-oct-2026, Mario: "agrega una barra de tareas a cada una
// de las áreas… muévelas para que sea más fácil para las áreas llevar el
// control en su propio menú"). Cada sección del menú tiene su tablero; la
// clave del área es la de la sección en lib/menu.ts. La misma lista vive en
// fn_tablero_area (SQL). Puro, con pruebas.

export const AREAS_TAREAS = [
  { clave: "finanzas", nombre: "Finanzas" },
  { clave: "contabilidad", nombre: "Contabilidad" },
  { clave: "legal", nombre: "Legal" },
  { clave: "rh", nombre: "Recursos humanos" },
  { clave: "almacen", nombre: "Almacén" },
  { clave: "compras", nombre: "Compras" },
  { clave: "logistica", nombre: "Logística" },
  { clave: "mantenimiento", nombre: "Mantenimiento" },
  { clave: "operacion", nombre: "Operación" },
] as const;

export type AreaTareas = (typeof AREAS_TAREAS)[number]["clave"];

export function esAreaTareas(clave: string | null | undefined): clave is AreaTareas {
  return AREAS_TAREAS.some((a) => a.clave === clave);
}

export function nombreArea(clave: string | null | undefined): string {
  return AREAS_TAREAS.find((a) => a.clave === clave)?.nombre ?? "Sin área";
}

export function rutaTareasArea(clave: AreaTareas): string {
  return `/tareas/area/${clave}`;
}

/** Tableros agrupados en el orden del menú; los que no tienen área, al final. */
export function agruparPorArea<T extends { area?: string | null }>(tableros: T[]): { area: string | null; nombre: string; tableros: T[] }[] {
  const grupos: { area: string | null; nombre: string; tableros: T[] }[] = [];
  for (const a of AREAS_TAREAS) {
    const delArea = tableros.filter((t) => t.area === a.clave);
    if (delArea.length) grupos.push({ area: a.clave, nombre: a.nombre, tableros: delArea });
  }
  const sinArea = tableros.filter((t) => !esAreaTareas(t.area));
  if (sinArea.length) grupos.push({ area: null, nombre: "Sin área", tableros: sinArea });
  return grupos;
}

export interface TarjetaAvance {
  tablero_id: string;
  columna_id: string;
  asignado_a: string | null;
  supervisor_id: string | null;
  corresponsables: string[] | null;
}

/** Hecha = en la última columna de su tablero (la misma regla que RH). */
export function avancePorTablero(
  columnas: { id: string; tablero_id: string; orden: number }[],
  tarjetas: TarjetaAvance[],
  persona?: string | null,
): Map<string, { total: number; hechas: number; mias: number; pct: number }> {
  const ultima = new Map<string, { id: string; orden: number }>();
  for (const c of columnas) {
    const actual = ultima.get(c.tablero_id);
    if (!actual || c.orden > actual.orden) ultima.set(c.tablero_id, { id: c.id, orden: c.orden });
  }
  const res = new Map<string, { total: number; hechas: number; mias: number; pct: number }>();
  for (const t of tarjetas) {
    const r = res.get(t.tablero_id) ?? { total: 0, hechas: 0, mias: 0, pct: 0 };
    r.total++;
    if (ultima.get(t.tablero_id)?.id === t.columna_id) r.hechas++;
    if (persona && (t.asignado_a === persona || t.supervisor_id === persona || (t.corresponsables ?? []).includes(persona))) r.mias++;
    r.pct = Math.round((r.hechas / r.total) * 100);
    res.set(t.tablero_id, r);
  }
  return res;
}
