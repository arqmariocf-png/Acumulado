import type { AppRol } from "../types/database";

/** Roles de personal contratado: entran al checador y a los módulos que RH
 * les asigne uno por uno (permisos_modulo). Nunca a finanzas/bancos. */
export const ROLES_BASICOS: AppRol[] = ["operativo", "administrativo", "supervisor", "directivo"];

export function esRolBasico(rol: AppRol | undefined | null): boolean {
  return !!rol && (ROLES_BASICOS as string[]).includes(rol);
}

export const ETIQUETA_ROL_BASICO: Record<string, string> = {
  operativo: "Operativo (solo checador)",
  administrativo: "Administrativo",
  supervisor: "Supervisor (ve el checador de su gente)",
  directivo: "Directivo (ve el checador de todos)",
};

/** Módulos que RH puede asignar a una persona con rol básico. La clave es
 * la que guarda permisos_modulo y la que revisa ProtectedRoute. */
export const MODULOS_ASIGNABLES: { clave: string; ruta: string; etiqueta: string; descripcion: string }[] = [
  { clave: "inventario", ruta: "/inventario", etiqueta: "Inventario", descripcion: "entradas, salidas, remisiones y existencias" },
  { clave: "produccion", ruta: "/produccion", etiqueta: "Producción", descripcion: "lotes, órdenes de producción y remisiones de planta" },
  { clave: "precios", ruta: "/precios", etiqueta: "Precios unitarios", descripcion: "análisis y catálogo de insumos" },
  { clave: "requisiciones", ruta: "/requisiciones", etiqueta: "Requisiciones", descripcion: "solicitudes de compra" },
  { clave: "tareas", ruta: "/tareas", etiqueta: "Tareas", descripcion: "tableros de actividades" },
  { clave: "proyectos", ruta: "/proyectos", etiqueta: "Proyectos", descripcion: "obras y proyectos de la empresa" },
  { clave: "bbva", ruta: "/bbva/folios", etiqueta: "Folios BBVA", descripcion: "semáforo de atención de cuadrillas" },
];

/** Deja solo dígitos y, si es un celular mexicano de 10 dígitos, antepone 52 (lo que pide wa.me). */
export function numeroWhatsapp(telefono: string): string {
  const digitos = telefono.replace(/\D/g, "");
  return digitos.length === 10 ? `52${digitos}` : digitos;
}

/** RH directivo (Eréndira, Fernando): todo RH, crea accesos y asigna roles.
 * RH administrativo (Raúl): flujo operativo. Null en rh_nivel = directivo. */
export function esRhDirectivo(p: { rol: string; rh_nivel?: string | null } | null | undefined): boolean {
  if (!p) return false;
  if (p.rol === "admin") return true;
  return p.rol === "rh" && (p.rh_nivel ?? "directivo") === "directivo";
}
export const ETIQUETA_NIVEL_RH: Record<"administrativo" | "directivo", string> = { administrativo: "RH administrativo", directivo: "RH directivo" };
