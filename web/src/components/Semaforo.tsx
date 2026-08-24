import type { EstadoClasificacion } from "../types/database";

// Semaforización de SPEC.md sección 5.5.
const ESTILOS: Record<EstadoClasificacion, { color: string; etiqueta: string }> = {
  resuelto: { color: "bg-emerald-100 text-emerald-800", etiqueta: "Resuelto" },
  pendiente_esperado: { color: "bg-amber-100 text-amber-800", etiqueta: "Pendiente (esperado)" },
  pendiente_revision: { color: "bg-red-100 text-red-800", etiqueta: "Revisión" },
  ambiguo: { color: "bg-purple-100 text-purple-800", etiqueta: "Ambiguo" },
};

export function Semaforo({
  estado,
  onClick,
  cargando,
  titulo,
}: {
  estado: EstadoClasificacion;
  /** Si se pasa, el semáforo se vuelve clickeable (ej. para reclasificar) en vez de solo mostrar el estado. */
  onClick?: () => void;
  cargando?: boolean;
  titulo?: string;
}) {
  const { color, etiqueta } = ESTILOS[estado];
  const clases = `inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`;

  if (!onClick) return <span className={clases}>{etiqueta}</span>;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={cargando}
      title={titulo}
      className={`${clases} cursor-pointer hover:opacity-75 disabled:cursor-wait disabled:opacity-50`}
    >
      {cargando ? "…" : etiqueta}
    </button>
  );
}
