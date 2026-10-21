// Plan del sistema (21-oct-2026, Mario: "te adjunto el excel para acomodo del
// sistema, con toda la lógica de ventanas, menús y orden del sistema así como
// los roles y acomodos"). Las 100 opciones de la hoja "Deber ser"
// (docs/deber-ser/Acumulado_deber_ser.xlsx) viven en la tabla `plan_sistema`;
// aquí lo que la pantalla calcula sin red: el resumen por grupo (como la hoja
// "Resumen deber ser"), los filtros, los colores del estatus y el CSV. Puro,
// con pruebas.

export const ESTATUS_PLAN = ["Existe", "Unir", "Ajustar", "Validar", "Crear", "Migrar del backoffice", "Por definir", "Hecho"] as const;
export type EstatusPlan = (typeof ESTATUS_PLAN)[number];

export const PRIORIDADES_PLAN = ["alta", "media", "baja"] as const;
export type PrioridadPlan = (typeof PRIORIDADES_PLAN)[number];

/** Orden de la barra superior del Excel. */
export const GRUPOS_PLAN = ["Mi día", "Dirección", "Comercial", "Finanzas", "Operación", "Nómina y mano de obra", "Administración"];

export interface EspecificacionPlan {
  empresas?: string | null;
  para_que?: string | null;
  pestanas?: string | null;
  datos?: string | null;
  reglas?: string | null;
  conecta?: string | null;
  quien?: string | null;
}

export interface OpcionPlan {
  id: string;
  numero: number;
  grupo_menu: string;
  menu: string;
  opcion: string;
  que_hace: string | null;
  viene_de: string | null;
  estatus: EstatusPlan;
  ruta: string | null;
  fase: number | null;
  quien: string | null;
  prioridad: PrioridadPlan | null;
  responsable: string | null;
  fecha_compromiso: string | null;
  avance: number;
  notas: string | null;
  especificacion: EspecificacionPlan | null;
}

/** Ya funciona en Acumulado (como la columna del Excel: Existe o Unir; Hecho cuando se termina). */
export function yaFunciona(estatus: string): boolean {
  return estatus === "Existe" || estatus === "Unir" || estatus === "Hecho";
}

export type TonoPlan = "verde" | "azul" | "ambar" | "gris";

export function tonoEstatus(estatus: string): TonoPlan {
  if (estatus === "Existe" || estatus === "Hecho") return "verde";
  if (estatus === "Unir" || estatus === "Ajustar" || estatus === "Validar") return "azul";
  if (estatus === "Crear" || estatus === "Migrar del backoffice") return "ambar";
  return "gris";
}

export interface ResumenGrupo {
  grupo: string;
  menus: number;
  opciones: number;
  funcionan: number;
  porTrabajar: number;
  fase1: number;
  fase2: number;
  fase3: number;
  /** Promedio del avance capturado (0-100). */
  avance: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function resumir(grupo: string, ops: Pick<OpcionPlan, "menu" | "estatus" | "fase" | "avance">[]): ResumenGrupo {
  const funcionan = ops.filter((o) => yaFunciona(o.estatus)).length;
  return {
    grupo,
    menus: new Set(ops.map((o) => o.menu)).size,
    opciones: ops.length,
    funcionan,
    porTrabajar: ops.length - funcionan,
    fase1: ops.filter((o) => o.fase === 1).length,
    fase2: ops.filter((o) => o.fase === 2).length,
    fase3: ops.filter((o) => o.fase === 3).length,
    avance: ops.length ? r1(ops.reduce((s, o) => s + (Number(o.avance) || 0), 0) / ops.length) : 0,
  };
}

/** Una fila por grupo en el orden de la barra (los que no estén en la lista, al final) y el total. */
export function resumenPorGrupo(ops: Pick<OpcionPlan, "grupo_menu" | "menu" | "estatus" | "fase" | "avance">[]): { grupos: ResumenGrupo[]; total: ResumenGrupo } {
  const nombres = [...GRUPOS_PLAN, ...[...new Set(ops.map((o) => o.grupo_menu))].filter((g) => !GRUPOS_PLAN.includes(g))];
  const grupos = nombres.map((g) => resumir(g, ops.filter((o) => o.grupo_menu === g))).filter((r) => r.opciones > 0);
  const total = resumir("Total", ops);
  // El total de menús cuenta por grupo (dos grupos pueden repetir nombre de menú).
  total.menus = grupos.reduce((s, g) => s + g.menus, 0);
  return { grupos, total };
}

export interface FiltroPlan {
  grupo?: string;
  fase?: number | null;
  estatus?: string;
  texto?: string;
}

const sinAcentos = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function filtrarPlan<T extends OpcionPlan>(ops: T[], f: FiltroPlan): T[] {
  const palabras = sinAcentos(f.texto ?? "").split(/\s+/).filter(Boolean);
  return ops
    .filter((o) => !f.grupo || o.grupo_menu === f.grupo)
    .filter((o) => !f.fase || o.fase === f.fase)
    .filter((o) => !f.estatus || (f.estatus === "por_trabajar" ? !yaFunciona(o.estatus) : o.estatus === f.estatus))
    .filter((o) => {
      if (!palabras.length) return true;
      const todo = sinAcentos([o.opcion, o.menu, o.grupo_menu, o.que_hace, o.quien, o.responsable, o.ruta, o.notas].filter(Boolean).join(" "));
      return palabras.every((p) => todo.includes(p));
    })
    .sort((a, b) => a.numero - b.numero);
}

/** Agrupa por grupo › menú respetando el orden del número. */
export function agruparPlan<T extends OpcionPlan>(ops: T[]): { grupo: string; menus: { menu: string; opciones: T[] }[] }[] {
  const salida: { grupo: string; menus: { menu: string; opciones: T[] }[] }[] = [];
  for (const o of [...ops].sort((a, b) => a.numero - b.numero)) {
    let g = salida.find((x) => x.grupo === o.grupo_menu);
    if (!g) salida.push((g = { grupo: o.grupo_menu, menus: [] }));
    let m = g.menus.find((x) => x.menu === o.menu);
    if (!m) g.menus.push((m = { menu: o.menu, opciones: [] }));
    m.opciones.push(o);
  }
  return salida;
}

/** Primera ruta navegable de la columna "Ruta en Acumulado" ("/a; /b" → "/a"). */
export function rutaNavegable(ruta: string | null | undefined): string | null {
  const primera = (ruta ?? "").split(";")[0].trim();
  return primera.startsWith("/") ? primera : null;
}

/** Avance capturado a mano: entero entre 0 y 100. */
export function limpiarAvance(v: string | number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export const COLUMNAS_CSV_PLAN = [
  "#",
  "Grupo",
  "Menú",
  "Opción",
  "Qué hace",
  "Viene de",
  "Estatus",
  "Ruta en Acumulado",
  "Fase",
  "Quién la usa",
  "Prioridad",
  "Responsable",
  "Fecha compromiso",
  "Avance",
  "Notas",
];

function celda(v: unknown): string {
  if (v === null || v === undefined) return "";
  const t = String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** CSV (sin BOM; la pantalla lo antepone) con las mismas columnas del Excel. */
export function csvPlan(ops: OpcionPlan[]): string {
  const filas = [...ops]
    .sort((a, b) => a.numero - b.numero)
    .map((o) =>
      [
        o.numero,
        o.grupo_menu,
        o.menu,
        o.opcion,
        o.que_hace,
        o.viene_de,
        o.estatus,
        o.ruta,
        o.fase ? `Fase ${o.fase}` : "",
        o.quien,
        o.prioridad,
        o.responsable,
        o.fecha_compromiso,
        o.avance,
        o.notas,
      ]
        .map(celda)
        .join(","),
    );
  return [COLUMNAS_CSV_PLAN.map(celda).join(","), ...filas].join("\r\n") + "\r\n";
}
