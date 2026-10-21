// Barra de la sección del menú arriba de cada pantalla (21-oct-2026, Mario:
// "en el menú proyectos, ponle el menú básico de las áreas que puede
// dirigirnos, para no tener que hacer scroll para ir a las ventanas
// correctas; aplícalo para todos"). Recibe las secciones ya acotadas por
// rol, módulo y permisos (`seccionesPara`) y dice cuál le toca a la ruta
// actual. Puro, con pruebas.

import type { EntradaMenu, SeccionMenu } from "./menu.ts";

export interface SeccionActual {
  seccion: SeccionMenu;
  entrada: EntradaMenu;
}

const RUTAS_SIN_BARRA = new Set(["/", "/inicio"]);

function base(ruta: string): string {
  const sinFiltro = ruta.split(/[?#]/)[0] || "/";
  return sinFiltro.length > 1 ? sinFiltro.replace(/\/+$/, "") : sinFiltro;
}

/** La sección cuya entrada empata mejor con la ruta (prefijo más largo). */
export function seccionDeRuta(secciones: SeccionMenu[], pathname: string): SeccionActual | null {
  const ruta = base(pathname);
  if (RUTAS_SIN_BARRA.has(ruta)) return null;
  let mejor: SeccionActual | null = null;
  let largo = -1;
  for (const seccion of secciones) {
    for (const entrada of seccion.entradas) {
      const r = base(entrada.ruta);
      if (RUTAS_SIN_BARRA.has(r)) continue;
      if ((ruta === r || ruta.startsWith(`${r}/`)) && r.length > largo) {
        mejor = { seccion, entrada };
        largo = r.length;
      }
    }
  }
  return mejor;
}

/** La barra solo sale si hay a dónde más ir dentro de la sección. */
export function muestraBarra(actual: SeccionActual | null): actual is SeccionActual {
  return !!actual && actual.seccion.entradas.length > 1;
}

/** Atajo extra de la barra para la pantalla actual (no es una entrada del menú). */
export interface AtajoBarra {
  etiqueta: string;
  ruta: string;
  /** La pestaña o filtro que lo marca como activo. */
  activo: boolean;
  /** Va justo después de la entrada con esta ruta. */
  despuesDe: string;
}

/**
 * Dentro de una obra, el tablero de seguimiento de ESA obra junto a Precios
 * unitarios (Mario, 21-oct-2026: "arriba de cada proyecto pon el tablero de
 * seguimiento junto a precios unitarios"). Es la pestaña con la que abre la
 * obra, así que sin ?tab= también está activo.
 */
export function atajosDeRuta(pathname: string, search = ""): AtajoBarra[] {
  const m = /^\/proyectos\/([0-9a-f-]{8,})\/?$/i.exec(base(pathname));
  if (!m) return [];
  const tab = new URLSearchParams(search).get("tab");
  return [{ etiqueta: "Tablero de seguimiento", ruta: `/proyectos/${m[1]}?tab=avance`, activo: !tab || tab === "avance", despuesDe: "/precios" }];
}
