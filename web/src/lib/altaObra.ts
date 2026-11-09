import { esRolBasico } from "./modulos.ts";
import type { AppRol } from "../types/database";

// Dar de alta obras y tableros desde la app (9-nov-2026, Mario: "permite a
// Timo abrir tableros y proyectos"). Reglas puras; la base las repite en
// proyectos_insert_empresa / auth_administra_tableros_de.

export interface PerfilAlta {
  rol: string;
  empresa_id?: string | null;
  modulos?: string[];
}

/** Quién puede dar de alta una obra: admin, corporativo y dirección en
 * cualquier empresa de su alcance; empresa, responsable y los básicos con
 * módulo proyectos en las suyas. */
export function puedeCrearObra(p: PerfilAlta | null | undefined): boolean {
  if (!p) return false;
  if (["admin", "corporativo", "direccion", "empresa", "responsable"].includes(p.rol)) return true;
  return esRolBasico(p.rol as AppRol) && (p.modulos ?? []).includes("proyectos");
}

/** Quién puede crear tableros (y en qué empresas): admin y corporativo en
 * todas, también en el corporativo sin empresa; empresa, responsable y los
 * básicos con módulo proyectos solo en las empresas de su alcance. */
export function puedeCrearTablero(p: PerfilAlta | null | undefined, empresasAlcance: string[]): { puede: boolean; soloEnAlcance: boolean } {
  if (!p) return { puede: false, soloEnAlcance: false };
  if (p.rol === "admin" || p.rol === "corporativo") return { puede: true, soloEnAlcance: false };
  const opera = p.rol === "empresa" || p.rol === "responsable" || (esRolBasico(p.rol as AppRol) && (p.modulos ?? []).includes("proyectos"));
  return { puede: opera && empresasAlcance.length > 0, soloEnAlcance: true };
}

export interface ObraNueva {
  nombre: string;
  empresa_id: string;
  cliente?: string | null;
  tipo?: string | null;
}

/** Lo que falta para dar de alta la obra, o null. Avisa si ya hay una obra
 * con el mismo nombre en esa empresa (las del backoffice se cruzan por
 * nombre: repetirlo duplicaría el gasto). */
export function revisarObra(o: ObraNueva, existentes: { nombre: string; empresa_id: string; activo: boolean }[]): string | null {
  const nombre = o.nombre.trim();
  if (nombre.length < 3) return "Escribe el nombre de la obra (mínimo 3 letras).";
  if (!o.empresa_id) return "Elige la empresa de la obra.";
  const clave = normalizar(nombre);
  const repetida = existentes.find((e) => e.empresa_id === o.empresa_id && normalizar(e.nombre) === clave);
  if (repetida) return `Ya existe la obra "${repetida.nombre}" en esa empresa${repetida.activo ? "" : " (desactivada: reactívala en vez de crear otra)"}.`;
  return null;
}

export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
