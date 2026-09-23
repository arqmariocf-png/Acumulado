// Catálogo de estatus de proyecto, aparte de las páginas para que lo usen
// tanto la lista como el detalle sin que ninguna tenga que importar a la otra.
import type { EstatusProyecto } from "../../types/database";

export const ESTATUS_PROYECTO: { valor: EstatusProyecto; etiqueta: string; color: string }[] = [
  { valor: "prospecto", etiqueta: "Prospecto", color: "bg-slate-100 text-slate-600" },
  { valor: "en_diseno", etiqueta: "En diseño", color: "bg-sky-100 text-sky-700" },
  { valor: "en_revision", etiqueta: "En revisión", color: "bg-amber-100 text-amber-700" },
  { valor: "aprobado", etiqueta: "Aprobado", color: "bg-emerald-100 text-emerald-700" },
  { valor: "en_obra", etiqueta: "En obra", color: "bg-indigo-100 text-indigo-700" },
  { valor: "terminado", etiqueta: "Terminado", color: "bg-slate-200 text-slate-700" },
  { valor: "cancelado", etiqueta: "Cancelado", color: "bg-red-100 text-red-700" },
];

export const ETIQUETA_ESTATUS = Object.fromEntries(ESTATUS_PROYECTO.map((e) => [e.valor, e.etiqueta])) as Record<
  EstatusProyecto,
  string
>;

export const COLOR_ESTATUS = Object.fromEntries(ESTATUS_PROYECTO.map((e) => [e.valor, e.color])) as Record<
  EstatusProyecto,
  string
>;
