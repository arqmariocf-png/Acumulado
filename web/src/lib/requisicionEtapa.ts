import type { AppRol } from "../types/database";

// Semáforo del suministro de una requisición (Mario, 26-sep-2026): siete
// etapas en orden. El color dice en qué parte del flujo está detenida; el
// avance, cuántas etapas lleva. Sin DOM: se prueba en node. La regla de
// quién marca cada etapa vive en fn_requisicion_etapa (la base manda); aquí
// solo se replica para no ofrecer botones que van a rebotar.

export type EtapaRequisicion = "solicitada" | "autorizada" | "pagada" | "suministro" | "en_bodega" | "en_transito" | "recibida";

export const ETAPAS_REQUISICION: EtapaRequisicion[] = ["solicitada", "autorizada", "pagada", "suministro", "en_bodega", "en_transito", "recibida"];

export const ETIQUETA_ETAPA: Record<EtapaRequisicion, string> = {
  solicitada: "Solicitada",
  autorizada: "Autorizada",
  pagada: "Pagada",
  suministro: "En suministro",
  en_bodega: "En bodega",
  en_transito: "En tránsito",
  recibida: "Recibida",
};

/** Qué falta después de esta etapa (lo que se lee en la lista). */
export const PENDIENTE_ETAPA: Record<EtapaRequisicion, string> = {
  solicitada: "Pendiente de autorización",
  autorizada: "Pendiente de pago",
  pagada: "Pendiente de suministro",
  suministro: "Pendiente de llegar a bodega",
  en_bodega: "Pendiente de salir a obra",
  en_transito: "Pendiente de recibirse en obra",
  recibida: "Recibida en obra",
};

export type ColorEtapa = "rojo" | "ambar" | "azul" | "verde" | "gris";

export function semaforoEtapa(etapa: EtapaRequisicion, cancelada = false): { color: ColorEtapa; paso: number; pct: number; etiqueta: string } {
  if (cancelada) return { color: "gris", paso: 0, pct: 0, etiqueta: "Cancelada" };
  const paso = ETAPAS_REQUISICION.indexOf(etapa) + 1; // 1..7
  const pct = Math.round((100 * (paso - 1)) / (ETAPAS_REQUISICION.length - 1));
  const color: ColorEtapa = etapa === "recibida" ? "verde" : etapa === "solicitada" || etapa === "autorizada" ? "rojo" : etapa === "pagada" || etapa === "suministro" ? "ambar" : "azul";
  return { color, paso, pct, etiqueta: PENDIENTE_ETAPA[etapa] };
}

export const CLASE_ETAPA: Record<ColorEtapa, { punto: string; barra: string; chip: string }> = {
  rojo: { punto: "bg-red-500", barra: "bg-red-500", chip: "bg-red-50 text-red-700" },
  ambar: { punto: "bg-amber-500", barra: "bg-amber-500", chip: "bg-amber-50 text-amber-700" },
  azul: { punto: "bg-sky-500", barra: "bg-sky-500", chip: "bg-sky-50 text-sky-700" },
  verde: { punto: "bg-emerald-500", barra: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700" },
  gris: { punto: "bg-slate-300", barra: "bg-slate-300", chip: "bg-slate-100 text-slate-500" },
};

/** Misma regla que fn_requisicion_etapa. `esDelProyecto`: quien la pidió o
 * responsable/comprador del proyecto. */
export function puedeMarcarEtapa(rol: AppRol, etapa: EtapaRequisicion, esDelProyecto = false): boolean {
  if (rol === "admin" || rol === "corporativo") return true;
  switch (etapa) {
    case "solicitada":
      return rol === "direccion";
    case "autorizada":
      return rol === "direccion" || rol === "empresa";
    case "pagada":
      return rol === "direccion";
    case "suministro":
      return rol === "direccion" || rol === "empresa" || rol === "almacen";
    case "en_bodega":
    case "en_transito":
      return rol === "empresa" || rol === "almacen";
    case "recibida":
      return rol === "empresa" || rol === "almacen" || rol === "responsable" || esDelProyecto;
  }
}

/** Siguiente etapa del flujo, o null si ya está recibida. */
export function siguienteEtapa(etapa: EtapaRequisicion): EtapaRequisicion | null {
  const i = ETAPAS_REQUISICION.indexOf(etapa);
  return i >= 0 && i < ETAPAS_REQUISICION.length - 1 ? ETAPAS_REQUISICION[i + 1] : null;
}

/** Avance promedio (0-100) de un conjunto de requisiciones no canceladas. */
export function avanceRequisiciones(filas: { etapa: EtapaRequisicion; estado: string }[]): number | null {
  const vivas = filas.filter((f) => f.estado !== "cancelada");
  if (vivas.length === 0) return null;
  return Math.round(vivas.reduce((s, f) => s + semaforoEtapa(f.etapa).pct, 0) / vivas.length);
}
