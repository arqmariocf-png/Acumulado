import type { AppRol } from "../types/database";

/** Roles de personal contratado: entran al checador y a los módulos que RH
 * les asigne uno por uno (permisos_modulo). Nunca a finanzas/bancos. */
export const ROLES_BASICOS: AppRol[] = ["operativo", "administrativo", "supervisor", "directivo"];

export function esRolBasico(rol: AppRol | undefined | null): boolean {
  return !!rol && (ROLES_BASICOS as string[]).includes(rol);
}

export const ETIQUETA_ROL_BASICO: Record<string, string> = {
  operativo: "Operativo (checador y tareas)",
  administrativo: "Administrativo",
  supervisor: "Supervisor (ve el checador de su gente)",
  directivo: "Directivo (ve el checador de todos)",
};

/** Módulos que todo rol básico trae de fábrica sin que RH los asigne
 * (Mario, 26-sep-2026: los operativos participan en Tareas y reciben los
 * avisos de seguimiento). La base ya los deja pasar (tablero_visible). */
export const MODULOS_BASE: string[] = ["tareas"];

/** Módulos efectivos de un perfil: los asignados en permisos_modulo más los
 * base si el rol es básico. */
export function modulosEfectivos(rol: AppRol | undefined | null, asignados: string[] | null | undefined): string[] {
  const lista = [...(asignados ?? [])];
  if (esRolBasico(rol)) for (const m of MODULOS_BASE) if (!lista.includes(m)) lista.push(m);
  return lista;
}

/** Módulos que RH puede asignar a una persona con rol básico. La clave es
 * la que guarda permisos_modulo y la que revisa ProtectedRoute. `incluido`:
 * viene de fábrica (MODULOS_BASE), no se quita. */
export const MODULOS_ASIGNABLES: { clave: string; ruta: string; etiqueta: string; descripcion: string; incluido?: boolean }[] = [
  { clave: "inventario", ruta: "/inventario", etiqueta: "Inventario", descripcion: "entradas, salidas, remisiones y existencias" },
  { clave: "produccion", ruta: "/produccion", etiqueta: "Producción", descripcion: "lotes, órdenes de producción y remisiones de planta" },
  { clave: "precios", ruta: "/precios", etiqueta: "Precios unitarios", descripcion: "análisis y catálogo de insumos" },
  { clave: "requisiciones", ruta: "/requisiciones", etiqueta: "Requisiciones", descripcion: "solicitudes de compra" },
  { clave: "tareas", ruta: "/tareas", etiqueta: "Tareas", descripcion: "tableros de actividades", incluido: true },
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

/** El sexo se guarda como "M"/"F"; en pantalla va la palabra completa. Con
 * una sola letra el traductor del navegador convertía "M" en "metro". */
export function etiquetaSexo(v: string | null | undefined): string {
  if (!v) return "—";
  const t = String(v).trim().toUpperCase();
  if (t === "M" || t === "H" || t.startsWith("MASC") || t.startsWith("HOM")) return "Masculino";
  if (t === "F" || t.startsWith("FEM") || t.startsWith("MUJ")) return "Femenino";
  return String(v);
}
