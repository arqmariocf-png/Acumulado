import { OcPorAutorizar } from "./OcPorAutorizar";
import { AltaOcManual } from "../../components/AltaOcManual";

/** Laura (8-oct-2026, "CORRECCIONES SISTEMA GRUPO LOMA"): "Panel de órdenes
 * por autorizar: que solo salga esta pantalla". Antes vivía dentro de Saldos
 * por empresa y de Programación de pagos. */
export function OrdenesPorAutorizarPagina() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Órdenes por autorizar</h1>
      <p className="mb-4 text-sm text-slate-500">OC del backoffice pendientes de autorización, de requisiciones (RQ) y de Excel. Autoriza o rechaza; al autorizar ya se le puede programar el pago.</p>
      <div className="mb-4">
        <AltaOcManual />
      </div>
      <OcPorAutorizar />
    </div>
  );
}
