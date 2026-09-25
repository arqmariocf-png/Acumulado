import { SECCIONES, type SeccionMenu } from "./menu";

/** Organigrama de dirección general (Mario, 25-sep-2026): las mismas ocho
 * áreas que clasifican los módulos (lib/menu.ts), con responsable y color. */
export interface AreaOrganigrama extends SeccionMenu {
  responsable: string | null;
  color: string;
}

const DETALLE: Record<string, { responsable: string | null; color: string }> = {
  finanzas: { responsable: "Laura Ortaza", color: "bg-emerald-600" },
  contabilidad: { responsable: "Delia Farfán", color: "bg-teal-600" },
  rh: { responsable: "Fernando Gómez / Eréndira Solís", color: "bg-violet-600" },
  almacen: { responsable: null, color: "bg-amber-600" },
  logistica: { responsable: null, color: "bg-orange-600" },
  mantenimiento: { responsable: "Christian Bonifacio", color: "bg-sky-600" },
  operacion: { responsable: null, color: "bg-slate-700" },
  sistemas: { responsable: "Mario Contreras", color: "bg-zinc-700" },
};

export const AREAS: AreaOrganigrama[] = SECCIONES.map((s) => ({ ...s, ...(DETALLE[s.clave] ?? { responsable: null, color: "bg-slate-600" }) }));

export function areaDeClave(clave: string | undefined): AreaOrganigrama | undefined {
  return AREAS.find((a) => a.clave === clave);
}
