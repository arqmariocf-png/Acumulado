import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { Arrendamientos } from "./Arrendamientos";
import { Asuntos } from "./Asuntos";
import { CreditoContratos } from "./CreditoContratos";
import { DatosEmpresaLegal } from "./DatosEmpresaLegal";
import { operaLegal } from "./comun";

/** Legal (1-oct-2026): asuntos y juicios con su bitácora y documentos, y el
 * contrato de crédito a clientes que se llena solo cuando dirección autoriza
 * el crédito. Lo operan quienes tienen el permiso 'legal' (Belén, Eréndira) y
 * el admin; dirección entra a crédito y contratos. */
export function Legal() {
  const { perfil } = useAuth();
  const [params, setParams] = useSearchParams();
  const legal = operaLegal(perfil);
  const pestanas = [
    { clave: "asuntos", titulo: "Asuntos y juicios", ve: legal },
    { clave: "credito", titulo: "Crédito y contratos", ve: legal || perfil?.rol === "direccion" },
    { clave: "arrendamientos", titulo: "Arrendamientos", ve: legal },
    { clave: "empresa", titulo: "Datos legales de la empresa", ve: legal },
  ].filter((p) => p.ve);
  const actual = pestanas.find((p) => p.clave === params.get("tab"))?.clave ?? pestanas[0]?.clave;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Legal</h1>
      <p className="mb-3 text-sm text-slate-500">Seguimiento de asuntos y juicios, contratos de crédito a clientes y de arrendamiento.</p>
      {pestanas.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
          {pestanas.map((p) => (
            <button
              key={p.clave}
              type="button"
              onClick={() => setParams({ tab: p.clave })}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${actual === p.clave ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500"}`}
            >
              {p.titulo}
            </button>
          ))}
        </div>
      )}
      {actual === "asuntos" && <Asuntos />}
      {actual === "credito" && <CreditoContratos />}
      {actual === "arrendamientos" && <Arrendamientos />}
      {actual === "empresa" && <DatosEmpresaLegal />}
    </div>
  );
}
