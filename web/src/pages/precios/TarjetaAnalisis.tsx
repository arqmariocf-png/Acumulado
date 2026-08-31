import { Link } from "react-router-dom";
import { COLOR_ESTADO, ETIQUETA_ESTADO, dinero } from "./comun";
import type { PuCosteo } from "../../types/database";

export function TarjetaAnalisis({ pu }: { pu: PuCosteo }) {
  return (
    <Link
      to={`/precios/${pu.analisis_id}`}
      className="block rounded border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            {pu.codigo} · {pu.empresa_codigo}
          </p>
          <p className="font-medium text-slate-900">{pu.concepto}</p>
          <p className="mt-0.5 text-xs text-slate-500">{pu.proyecto_nombre ?? "Biblioteca"}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-slate-900">{dinero(pu.precio_unitario)}</p>
          <p className="text-xs text-slate-500">por {pu.unidad}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO[pu.estado]}`}>
          {ETIQUETA_ESTADO[pu.estado]}
        </span>
        {pu.insumos_sin_precio > 0 && (
          <span className="text-xs text-amber-700">{pu.insumos_sin_precio} sin precio</span>
        )}
      </div>
    </Link>
  );
}
