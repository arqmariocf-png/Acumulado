// Cálculo del resumen físico-financiero de una obra. Lo usan la pestaña
// "Resumen físico-financiero" de cada obra (proyectos/ResumenObra.tsx) y el
// panel de todas las obras del director general (proyectos/ResumenObrasDirector.tsx),
// así las dos pantallas dan las mismas cifras. Puro, sin DOM.
import { contarSemaforoPu } from "./puSemaforo.ts";
import { avanceRequisiciones, type EtapaRequisicion } from "./requisicionEtapa.ts";
import type { PuEstado } from "../types/database";

export interface DatosResumenObra {
  presupuesto: number;
  materiales: number;
  nomina: number;
  tarjetas: number;
  hechas: number;
  requisiciones: { etapa: EtapaRequisicion; estado: string; avance_pct?: number | null }[];
  pu: { estado: PuEstado; cliente_autorizado_en: string | null }[];
}

export interface ResumenObraCalculado {
  ejercido: number;
  disponible: number;
  avanceFinanciero: number | null;
  avanceTareas: number | null;
  avanceSuministro: number | null;
  avancePu: number | null;
  avanceFisico: number | null;
  /** Financiero − físico, en puntos: positivo = se ha gastado más de lo avanzado. */
  desfase: number | null;
}

export function calcularResumenObra(d: DatosResumenObra): ResumenObraCalculado {
  const ejercido = d.materiales + d.nomina;
  const disponible = d.presupuesto - ejercido;
  const avanceFinanciero = d.presupuesto > 0 ? (100 * ejercido) / d.presupuesto : null;
  const avanceTareas = d.tarjetas > 0 ? (100 * d.hechas) / d.tarjetas : null;
  const avanceSuministro = avanceRequisiciones(d.requisiciones);
  const avancePu = d.pu.length > 0 ? contarSemaforoPu(d.pu).avance_pct : null;
  const fisicos = [avanceTareas, avanceSuministro, avancePu].filter((x): x is number => x !== null);
  const avanceFisico = fisicos.length > 0 ? fisicos.reduce((s, x) => s + x, 0) / fisicos.length : null;
  const desfase = avanceFisico !== null && avanceFinanciero !== null ? avanceFinanciero - avanceFisico : null;
  return { ejercido, disponible, avanceFinanciero, avanceTareas, avanceSuministro, avancePu, avanceFisico, desfase };
}

/** Rojo si se gastó más de 10 puntos por encima del avance o se rebasó el presupuesto. */
export function semaforoDesfase(r: Pick<ResumenObraCalculado, "desfase" | "disponible">, presupuesto: number): "rojo" | "ambar" | "verde" | "gris" {
  if (presupuesto > 0 && r.disponible < 0) return "rojo";
  if (r.desfase === null) return "gris";
  if (r.desfase > 10) return "rojo";
  if (r.desfase > 0) return "ambar";
  return "verde";
}
