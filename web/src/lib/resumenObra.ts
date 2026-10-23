// Cálculo del resumen físico-financiero de una obra. Lo usan la pestaña
// "Resumen físico-financiero" de cada obra (proyectos/ResumenObra.tsx) y el
// panel de todas las obras del director general (proyectos/ResumenObrasDirector.tsx),
// así las dos pantallas dan las mismas cifras. Puro, sin DOM.
import { contarSemaforoPu } from "./puSemaforo.ts";
import { avanceRequisiciones, type EtapaRequisicion } from "./requisicionEtapa.ts";
import type { PuEstado } from "../types/database";

export interface DatosResumenObra {
  presupuesto: number;
  /** Compras capturadas en el control de obra (sin OC ligada). */
  materiales: number;
  /** Nómina capturada en el control de obra (lo que se decidió pagar). */
  nomina: number;
  /** OC/OS del backoffice o de Acumulado con el nombre de la obra (19-oct-2026). */
  oc?: number;
  /** Mano de obra pagada según la API del backoffice; si hay, sustituye a la nómina capturada. */
  manoObra?: number;
  tarjetas: number;
  hechas: number;
  requisiciones: { etapa: EtapaRequisicion; estado: string; avance_pct?: number | null }[];
  pu: { estado: PuEstado; cliente_autorizado_en: string | null }[];
}

export interface ResumenObraCalculado {
  ejercido: number;
  /** De dónde sale lo ejercido. */
  desglose: { compras: number; oc: number; manoObra: number; manoObraDe: "api" | "captura" };
  disponible: number;
  avanceFinanciero: number | null;
  avanceTareas: number | null;
  avanceSuministro: number | null;
  avancePu: number | null;
  avanceFisico: number | null;
  /** Financiero − físico, en puntos: positivo = se ha gastado más de lo avanzado. */
  desfase: number | null;
}

/** Avance físico de una obra: promedio de tareas hechas, suministro de
 * requerimientos y precios unitarios (los que existan). Es LA fórmula del
 * físico: la usan el resumen de la obra, el de todas las obras y Finanzas ›
 * Avance financiero (23-oct-2026, Mario: "el avance físico sigue sin
 * coincidir"). */
export function avanceFisicoDe(d: Pick<DatosResumenObra, "tarjetas" | "hechas" | "requisiciones" | "pu">): {
  avanceTareas: number | null;
  avanceSuministro: number | null;
  avancePu: number | null;
  avanceFisico: number | null;
} {
  const avanceTareas = d.tarjetas > 0 ? (100 * d.hechas) / d.tarjetas : null;
  const avanceSuministro = avanceRequisiciones(d.requisiciones);
  const avancePu = d.pu.length > 0 ? contarSemaforoPu(d.pu).avance_pct : null;
  const fisicos = [avanceTareas, avanceSuministro, avancePu].filter((x): x is number => x !== null);
  const avanceFisico = fisicos.length > 0 ? fisicos.reduce((s, x) => s + x, 0) / fisicos.length : null;
  return { avanceTareas, avanceSuministro, avancePu, avanceFisico };
}

export function calcularResumenObra(d: DatosResumenObra): ResumenObraCalculado {
  const oc = d.oc ?? 0;
  const manoObraApi = d.manoObra ?? 0;
  const manoObra = manoObraApi > 0 ? manoObraApi : d.nomina;
  const ejercido = d.materiales + oc + manoObra;
  const disponible = d.presupuesto - ejercido;
  const avanceFinanciero = d.presupuesto > 0 ? (100 * ejercido) / d.presupuesto : null;
  const { avanceTareas, avanceSuministro, avancePu, avanceFisico } = avanceFisicoDe(d);
  const desfase = avanceFisico !== null && avanceFinanciero !== null ? avanceFinanciero - avanceFisico : null;
  const desglose = { compras: d.materiales, oc, manoObra, manoObraDe: manoObraApi > 0 ? ("api" as const) : ("captura" as const) };
  return { ejercido, desglose, disponible, avanceFinanciero, avanceTareas, avanceSuministro, avancePu, avanceFisico, desfase };
}

/** Rojo si se gastó más de 10 puntos por encima del avance o se rebasó el presupuesto. */
export function semaforoDesfase(r: Pick<ResumenObraCalculado, "desfase" | "disponible">, presupuesto: number): "rojo" | "ambar" | "verde" | "gris" {
  if (presupuesto > 0 && r.disponible < 0) return "rojo";
  if (r.desfase === null) return "gris";
  if (r.desfase > 10) return "rojo";
  if (r.desfase > 0) return "ambar";
  return "verde";
}
