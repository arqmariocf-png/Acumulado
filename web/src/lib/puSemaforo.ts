import type { PuEstado } from "../types/database";

// Semáforo de un precio unitario dentro de su proyecto (Mario, 26-sep-2026):
// seis pasos, cinco internos (borrador → almacén → dirección → publicado) y
// uno del cliente. El color dice quién lo tiene detenido; el avance, cuánto
// falta. Sin DOM: se prueba en node.

export type ColorSemaforoPu = "rojo" | "ambar" | "azul" | "verde" | "gris";

export interface SemaforoPu {
  color: ColorSemaforoPu;
  /** Paso alcanzado, de 0 a PASOS_PU. */
  paso: number;
  pct: number;
  /** Quién lo tiene detenido, en una línea. */
  etiqueta: string;
  /** Grupo para los conteos del proyecto. */
  grupo: "interno" | "cliente" | "autorizado" | "obsoleto";
}

export const PASOS_PU = 6;

const PASO_POR_ESTADO: Record<PuEstado, number> = {
  borrador: 1,
  en_revision_material: 2,
  material_confirmado: 3,
  autorizado: 4,
  publicado: 5,
  obsoleto: 0,
};

export function semaforoPu(estado: PuEstado, clienteAutorizadoEn: string | null | undefined): SemaforoPu {
  if (estado === "obsoleto") return { color: "gris", paso: 0, pct: 0, etiqueta: "Obsoleto", grupo: "obsoleto" };
  if (estado === "publicado" && clienteAutorizadoEn) return { color: "verde", paso: PASOS_PU, pct: 100, etiqueta: "Autorizado por el cliente", grupo: "autorizado" };
  const paso = PASO_POR_ESTADO[estado];
  const pct = Math.round((100 * paso) / PASOS_PU);
  if (estado === "publicado") return { color: "azul", paso, pct, etiqueta: "Pendiente de autorización del cliente", grupo: "cliente" };
  const etiqueta =
    estado === "borrador"
      ? "Pendiente interno: en elaboración"
      : estado === "en_revision_material"
        ? "Pendiente interno: almacén confirma material"
        : estado === "material_confirmado"
          ? "Pendiente interno: autorización de dirección"
          : "Pendiente interno: publicación";
  return { color: estado === "borrador" || estado === "en_revision_material" ? "rojo" : "ambar", paso, pct, etiqueta, grupo: "interno" };
}

export interface ConteoSemaforoPu {
  total: number;
  interno: number;
  cliente: number;
  autorizado: number;
  obsoleto: number;
  /** Avance promedio (0-100) de los no obsoletos. */
  avance_pct: number;
}

export function contarSemaforoPu(filas: { estado: PuEstado; cliente_autorizado_en: string | null }[]): ConteoSemaforoPu {
  const c: ConteoSemaforoPu = { total: filas.length, interno: 0, cliente: 0, autorizado: 0, obsoleto: 0, avance_pct: 0 };
  let suma = 0;
  let vivos = 0;
  for (const f of filas) {
    const s = semaforoPu(f.estado, f.cliente_autorizado_en);
    c[s.grupo]++;
    if (s.grupo !== "obsoleto") {
      suma += s.pct;
      vivos++;
    }
  }
  c.avance_pct = vivos === 0 ? 0 : Math.round(suma / vivos);
  return c;
}

/** Clases Tailwind por color (mismo criterio que los demás semáforos de la app). */
export const CLASE_SEMAFORO_PU: Record<ColorSemaforoPu, { punto: string; barra: string; chip: string }> = {
  rojo: { punto: "bg-red-500", barra: "bg-red-500", chip: "bg-red-50 text-red-700" },
  ambar: { punto: "bg-amber-500", barra: "bg-amber-500", chip: "bg-amber-50 text-amber-700" },
  azul: { punto: "bg-sky-500", barra: "bg-sky-500", chip: "bg-sky-50 text-sky-700" },
  verde: { punto: "bg-emerald-500", barra: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700" },
  gris: { punto: "bg-slate-300", barra: "bg-slate-300", chip: "bg-slate-100 text-slate-500" },
};
