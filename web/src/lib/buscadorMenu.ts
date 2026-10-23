// Buscador de pantallas (23-oct-2026, Mario: "en todos los menús ponles una
// opción de buscador para llegar más rápido a la información requerida").
// Índice de todo lo que la persona puede abrir (sus menús ya acotados por rol,
// módulo y permisos, con sus subniveles) más las obras activas; se busca sin
// acentos y por palabras en cualquier orden. Puro, con pruebas.

import type { GrupoMenu, NivelMenu, SeccionMenu } from "./menu";

export interface ItemBusqueda {
  ruta: string;
  etiqueta: string;
  /** "Grupo › Menú" (o "Obra · Empresa"). */
  camino: string;
  descripcion: string;
  /** Texto adicional que también se busca (uso, nombres de pestañas). */
  extra?: string;
  tipo: "pantalla" | "pestaña" | "obra";
}

export function sinAcentos(t: string | null | undefined): string {
  return String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function aplanarNiveles(niveles: NivelMenu[] | undefined, camino: string, acumulado: ItemBusqueda[]): void {
  for (const n of niveles ?? []) {
    acumulado.push({ ruta: n.ruta, etiqueta: n.etiqueta, camino, descripcion: "", tipo: "pestaña" });
    aplanarNiveles(n.hijos, `${camino} › ${n.etiqueta}`, acumulado);
  }
}

/** Todas las pantallas y pestañas de los menús que ve la persona. */
export function indiceMenu(secciones: SeccionMenu[], grupos: { clave: GrupoMenu; titulo: string }[]): ItemBusqueda[] {
  const tituloGrupo = new Map(grupos.map((g) => [g.clave, g.titulo]));
  const items: ItemBusqueda[] = [];
  const vistas = new Set<string>();
  for (const s of secciones) {
    const camino = [s.grupo ? tituloGrupo.get(s.grupo) : null, s.titulo].filter(Boolean).join(" › ");
    for (const e of s.entradas) {
      if (vistas.has(e.ruta)) continue;
      vistas.add(e.ruta);
      items.push({ ruta: e.ruta, etiqueta: e.etiqueta, camino, descripcion: e.descripcion, extra: e.uso, tipo: "pantalla" });
      aplanarNiveles(e.niveles, `${camino} › ${e.etiqueta}`, items);
    }
  }
  return items;
}

export function itemsObras(obras: { id: string; nombre: string; empresa?: string | null }[]): ItemBusqueda[] {
  return obras.map((o) => ({ ruta: `/proyectos/${o.id}`, etiqueta: o.nombre, camino: `Obra${o.empresa ? ` · ${o.empresa}` : ""}`, descripcion: "abrir la obra en su tablero de seguimiento", tipo: "obra" }));
}

/** Resultados por relevancia: primero lo que coincide en el nombre (y al
 * inicio), luego en el camino o la descripción, al final en el uso. Todas las
 * palabras tienen que aparecer en algún campo. Sin texto: los primeros `limite`. */
export function buscarMenu(items: ItemBusqueda[], texto: string, limite = 12): ItemBusqueda[] {
  const palabras = sinAcentos(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return items.filter((i) => i.tipo === "pantalla").slice(0, limite);
  const puntuados: { item: ItemBusqueda; puntos: number }[] = [];
  for (const item of items) {
    const nombre = sinAcentos(item.etiqueta);
    const camino = sinAcentos(item.camino);
    const desc = sinAcentos(item.descripcion);
    const extra = sinAcentos(item.extra);
    const todo = `${nombre} ${camino} ${desc} ${extra}`;
    if (!palabras.every((p) => todo.includes(p))) continue;
    let puntos = 0;
    for (const p of palabras) {
      if (nombre.startsWith(p)) puntos += 40;
      else if (nombre.includes(p)) puntos += 25;
      else if (camino.includes(p)) puntos += 12;
      else if (desc.includes(p)) puntos += 10;
      else puntos += 3;
    }
    if (item.tipo === "pantalla") puntos += 2;
    if (item.tipo === "obra") puntos -= 1;
    puntuados.push({ item, puntos });
  }
  puntuados.sort((a, b) => b.puntos - a.puntos || a.item.etiqueta.localeCompare(b.item.etiqueta, "es"));
  return puntuados.slice(0, limite).map((p) => p.item);
}

/** Evento con el que los botones "Buscar" abren el buscador (`abrirBuscador`
 * en components/BuscadorMenu.tsx; aquí no hay DOM: este módulo corre en node). */
export const EVENTO_ABRIR_BUSCADOR = "acumulado:buscar";

/** Ctrl+K / ⌘K (o "/" fuera de un campo de texto) abre el buscador. */
export function esAtajoBuscador(e: { key: string; ctrlKey: boolean; metaKey: boolean; target?: EventTarget | null }): boolean {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") return true;
  if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
    const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
    const tag = (t?.tagName ?? "").toUpperCase();
    return !["INPUT", "TEXTAREA", "SELECT"].includes(tag) && !t?.isContentEditable;
  }
  return false;
}
