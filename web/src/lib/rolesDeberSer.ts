// Roles del deber ser (21-oct-2026, Excel "Acumulado deber ser" de Mario,
// hojas "Roles" y "Roles x menús"): qué menú ve cada puesto del grupo. Mario
// eligió aplicarlo con equivalencias propuestas contra los roles de hoy,
// pero validándolas antes de quitarle algo a alguien: por eso
// `APLICAR_ROLES_DEBER_SER` arranca apagado y la pantalla "Plan del sistema"
// muestra, persona por persona, qué dejaría de ver. Solo esconde menús; lo
// que cada quien puede ver o capturar en los datos lo sigue decidiendo RLS.
// Puro, con pruebas.

import type { AppRol } from "../types/database";

/** Se prende cuando Mario valide la tabla de equivalencias. */
export const APLICAR_ROLES_DEBER_SER = false;

export type ClaveMenu =
  | "mi_dia"
  | "tablero"
  | "analisis"
  | "gobierno"
  | "ventas"
  | "cobranza"
  | "compras"
  | "almacen"
  | "tesoreria"
  | "cuentas_pagar"
  | "presupuestos"
  | "contabilidad"
  | "obras"
  | "produccion"
  | "fletes"
  | "mantenimiento_bbva"
  | "nomina"
  | "mano_obra"
  | "rh"
  | "legal"
  | "catalogos"
  | "configuracion";

export const TODOS_LOS_MENUS: ClaveMenu[] = [
  "mi_dia", "tablero", "analisis", "gobierno", "ventas", "cobranza", "compras", "almacen", "tesoreria", "cuentas_pagar", "presupuestos",
  "contabilidad", "obras", "produccion", "fletes", "mantenimiento_bbva", "nomina", "mano_obra", "rh", "legal", "catalogos", "configuracion",
];

export type Puesto =
  | "direccion_general"
  | "socio"
  | "finanzas_tesoreria"
  | "contabilidad"
  | "recursos_humanos"
  | "legal"
  | "marketing"
  | "compras"
  | "ventas"
  | "almacenista"
  | "residente"
  | "arquitecto"
  | "jefe_produccion"
  | "operador_produccion"
  | "jefe_flota"
  | "chofer"
  | "coordinador_bbva"
  | "ti";

/** Hoja "Roles x menús": Total y Consulta cuentan igual (el menú se ve); lo
 * que se captura lo decide la base. Mi día lo tienen todos. */
export const PUESTOS: Record<Puesto, { nombre: string; menus: ClaveMenu[] }> = {
  direccion_general: { nombre: "Dirección general", menus: TODOS_LOS_MENUS },
  socio: { nombre: "Socio", menus: ["mi_dia", "tablero", "analisis", "gobierno"] },
  finanzas_tesoreria: {
    nombre: "Finanzas y tesorería",
    menus: ["mi_dia", "tablero", "analisis", "ventas", "cobranza", "compras", "tesoreria", "cuentas_pagar", "presupuestos", "contabilidad", "nomina"],
  },
  contabilidad: { nombre: "Contabilidad", menus: ["mi_dia", "ventas", "cobranza", "compras", "tesoreria", "cuentas_pagar", "contabilidad"] },
  recursos_humanos: { nombre: "Recursos humanos", menus: ["mi_dia", "gobierno", "tesoreria", "nomina", "rh"] },
  legal: { nombre: "Legal y cumplimiento", menus: ["mi_dia", "cobranza", "legal"] },
  marketing: { nombre: "Marketing y relaciones públicas", menus: ["mi_dia", "ventas"] },
  compras: { nombre: "Compras", menus: ["mi_dia", "compras", "almacen", "cuentas_pagar", "catalogos"] },
  ventas: { nombre: "Ventas y mostrador", menus: ["mi_dia", "ventas", "cobranza", "almacen", "catalogos"] },
  almacenista: { nombre: "Almacenista", menus: ["mi_dia", "compras", "almacen"] },
  residente: { nombre: "Residente o supervisor de obra", menus: ["mi_dia", "compras", "almacen", "presupuestos", "obras", "mano_obra"] },
  arquitecto: { nombre: "Arquitecto, diseñador o ingeniero civil", menus: ["mi_dia", "presupuestos", "obras"] },
  jefe_produccion: { nombre: "Jefe de producción", menus: ["mi_dia", "compras", "almacen", "produccion"] },
  operador_produccion: { nombre: "Operador de producción", menus: ["mi_dia", "produccion"] },
  jefe_flota: { nombre: "Jefe de flota", menus: ["mi_dia", "almacen", "fletes"] },
  chofer: { nombre: "Chofer", menus: ["mi_dia", "fletes"] },
  coordinador_bbva: { nombre: "Coordinador BBVA", menus: ["mi_dia", "mantenimiento_bbva"] },
  ti: { nombre: "TI", menus: ["mi_dia", "catalogos", "configuracion"] },
};

/** Permisos por persona que suman un puesto o un menú. */
const PERMISO_PUESTO: Record<string, Puesto> = {
  tesoreria: "finanzas_tesoreria",
  contabilidad: "contabilidad",
  legal: "legal",
  cumplimiento: "legal",
  compras: "compras",
  cotizador: "ventas",
  punto_venta: "ventas",
};
const PERMISO_MENU: Record<string, ClaveMenu> = {
  requisiciones: "compras",
  herramienta: "almacen",
  inventario: "almacen",
  checador: "rh",
  precios: "obras",
  proyectos: "obras",
  produccion: "produccion",
  bbva: "mantenimiento_bbva",
};

/** Excepciones que Mario ya pidió por nombre y que el Excel no trae. */
const EXCEPCION_ROL: Partial<Record<AppRol, { menus: ClaveMenu[]; motivo: string }>> = {
  // 21-oct-2026: "catálogos… fácilmente manipulables por el área de Laura".
  direccion: { menus: ["catalogos"], motivo: "Catálogos para el área de Laura (21-oct)" },
};

export interface PerfilParaPuesto {
  rol: AppRol;
  modulos?: string[] | null;
  bbva_mantenimiento?: boolean | null;
}

export interface Equivalencia {
  /** null = rol sin equivalente en el Excel: se queda como hoy. */
  puestos: Puesto[] | null;
  menus: Set<ClaveMenu> | null;
  nota: string | null;
}

/** El puesto (o puestos) del Excel que le toca a un perfil de hoy. */
export function equivalencia(p: PerfilParaPuesto): Equivalencia {
  const modulos = p.modulos ?? [];
  const puestos = new Set<Puesto>();
  let nota: string | null = null;
  switch (p.rol) {
    case "admin":
      puestos.add("direccion_general");
      break;
    case "direccion":
      puestos.add("finanzas_tesoreria");
      break;
    case "corporativo":
      puestos.add(modulos.includes("tesoreria") ? "finanzas_tesoreria" : "contabilidad");
      break;
    case "rh":
    case "rh_documentos":
      puestos.add("recursos_humanos");
      break;
    case "almacen":
      puestos.add("almacenista");
      puestos.add("compras");
      break;
    case "produccion":
      puestos.add("jefe_produccion");
      puestos.add("ventas");
      break;
    case "supervisor_bbva":
      puestos.add("coordinador_bbva");
      break;
    case "responsable":
      puestos.add(p.bbva_mantenimiento ? "coordinador_bbva" : "residente");
      break;
    case "supervisor":
    case "directivo":
      puestos.add("residente");
      break;
    case "administrativo":
      if (modulos.includes("proyectos") || modulos.includes("requisiciones")) puestos.add("residente");
      break;
    case "operativo":
      if (modulos.includes("produccion")) puestos.add("operador_produccion");
      break;
    case "empresa":
      return { puestos: null, menus: null, nota: "Dirección de una empresa: el Excel no lo trae; se queda como hoy" };
    default:
      return { puestos: [], menus: new Set<ClaveMenu>(), nota: null };
  }
  for (const m of modulos) {
    const puesto = PERMISO_PUESTO[m];
    if (puesto) puestos.add(puesto);
  }
  const menus = new Set<ClaveMenu>(["mi_dia"]);
  for (const puesto of puestos) for (const m of PUESTOS[puesto].menus) menus.add(m);
  for (const m of modulos) {
    const menu = PERMISO_MENU[m];
    if (menu) menus.add(menu);
  }
  if (p.bbva_mantenimiento) menus.add("mantenimiento_bbva");
  const excepcion = EXCEPCION_ROL[p.rol];
  if (excepcion) {
    for (const m of excepcion.menus) menus.add(m);
    nota = excepcion.motivo;
  }
  return { puestos: [...puestos], menus, nota };
}

/** ¿Este menú se le muestra? Con la matriz apagada, siempre sí. */
export function menuPermitido(p: PerfilParaPuesto, menu: string, aplicar = APLICAR_ROLES_DEBER_SER): boolean {
  if (!aplicar) return true;
  const eq = equivalencia(p);
  return eq.menus === null || eq.menus.has(menu as ClaveMenu);
}

/** Menús que hoy ve y dejaría de ver con la matriz (para validarlo). */
export function menusQueSeQuitan(p: PerfilParaPuesto, menusDeHoy: string[]): string[] {
  const eq = equivalencia(p);
  if (eq.menus === null) return [];
  return menusDeHoy.filter((m) => !eq.menus!.has(m as ClaveMenu));
}

export function nombrePuestos(eq: Equivalencia): string {
  if (eq.puestos === null) return "Sin equivalente (como hoy)";
  if (eq.puestos.length === 0) return "Solo Mi día";
  return eq.puestos.map((p) => PUESTOS[p].nombre).join(" + ");
}
