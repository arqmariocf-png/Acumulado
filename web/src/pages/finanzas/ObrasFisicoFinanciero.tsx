import { ResumenObrasDirector } from "../proyectos/ResumenObrasDirector";

/** Finanzas → Físico-financiero de obras (19-oct-2026, Mario: "este reporte
 * también autorízalo a Laura como parte de finanzas"): el mismo resumen que
 * ve el director general arriba de Proyectos, con OC y mano de obra. */
export function ObrasFisicoFinanciero() {
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Físico-financiero de obras</h1>
      <p className="mb-3 text-sm text-slate-500">
        Avance físico (tareas, suministro, precios unitarios) contra lo ejercido: órdenes de compra y de servicio, mano de obra pagada por semana y compras
        capturadas. Clic en una obra para ver su detalle semana por semana.
      </p>
      <ResumenObrasDirector />
    </div>
  );
}
