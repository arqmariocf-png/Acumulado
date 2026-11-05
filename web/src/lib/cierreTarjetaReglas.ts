// Reglas puras del candado para terminar tareas (Mario, 5-nov-2026); lo que
// habla con la base está en `cierreTarjeta.ts` (este archivo se prueba en node).

export const MENSAJE_CIERRE_REQUIERE_AUTORIZACION = "requiere autorización";

export interface ColumnaOrden {
  id: string;
  orden: number;
  nombre?: string;
}

/** Columnas de cierre: las que se llaman Hecho / Terminado / Listo /
 * Completado / Finalizado y la última del tablero (la que cuentan los KPIs). */
export function esNombreDeCierre(nombre: string | null | undefined): boolean {
  const n = (nombre ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /hech|termin|listo|complet|finaliz/.test(n);
}

function ordenadas(columnas: ColumnaOrden[]): ColumnaOrden[] {
  return [...columnas].sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id));
}

/** A dónde se manda una tarea al darla por terminada: la primera columna de
 * cierre por nombre y, si no hay, la última del tablero. */
export function columnaHecha(columnas: ColumnaOrden[]): string | null {
  if (columnas.length === 0) return null;
  const ord = ordenadas(columnas);
  return (ord.find((c) => esNombreDeCierre(c.nombre)) ?? ord[ord.length - 1]).id;
}

/** ¿Entrar a esta columna es "dar por terminada" la tarea? */
export function esColumnaHecha(columnas: ColumnaOrden[], columnaId: string): boolean {
  if (columnas.length === 0) return false;
  const ord = ordenadas(columnas);
  const col = ord.find((c) => c.id === columnaId);
  if (!col) return false;
  return esNombreDeCierre(col.nombre) || ord[ord.length - 1].id === columnaId;
}

/** ¿El error de la base es el candado (y no otra cosa)? */
export function esErrorDeCandado(mensaje: string | null | undefined): boolean {
  return !!mensaje && mensaje.includes(MENSAJE_CIERRE_REQUIERE_AUTORIZACION);
}

export interface CierrePendiente {
  id: string;
  tarjeta_id: string;
  tablero_id: string;
  tablero: string;
  titulo: string;
  nota: string | null;
  solicitado_por: string;
  solicitante_nombre: string | null;
  created_at: string;
  puedo_resolver: boolean;
  es_mia: boolean;
}

/** Texto de la solicitud para listas y avisos. */
export function textoCierre(c: Pick<CierrePendiente, "solicitante_nombre" | "titulo" | "nota" | "tablero">): string {
  return `${c.solicitante_nombre ?? "Alguien"} terminó «${c.titulo}» (${c.tablero})${c.nota ? `: ${c.nota}` : ""}`;
}
