import type { EstadoClasificacion } from "../types/database";

// Semaforización de SPEC.md sección 5.5.
const ESTILOS: Record<EstadoClasificacion, { color: string; etiqueta: string }> = {
  resuelto: { color: "bg-emerald-100 text-emerald-800", etiqueta: "Resuelto" },
  pendiente_esperado: { color: "bg-amber-100 text-amber-800", etiqueta: "Pendiente (esperado)" },
  pendiente_revision: { color: "bg-red-100 text-red-800", etiqueta: "Revisión" },
  ambiguo: { color: "bg-purple-100 text-purple-800", etiqueta: "Ambiguo" },
};

export function Semaforo({ estado }: { estado: EstadoClasificacion }) {
  const { color, etiqueta } = ESTILOS[estado];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>{etiqueta}</span>;
}
