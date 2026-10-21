import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { PlanSistema } from "./PlanSistema";
import { RolesDeberSer } from "./RolesDeberSer";

/** Plan del sistema (21-oct-2026, Excel "Acumulado deber ser"): las 100
 * opciones con su avance y, para el director general, la propuesta de roles
 * por puesto para validarla antes de aplicarla. */
export function PlanSistemaPagina() {
  const { perfilReal } = useAuth();
  const [params, setParams] = useSearchParams();
  const esAdmin = perfilReal?.rol === "admin";
  const pestana = esAdmin && params.get("tab") === "roles" ? "roles" : "plan";
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Plan del sistema</h1>
          <p className="text-sm text-slate-500">El deber ser de Acumulado: 7 grupos, 22 menús y 100 opciones, con fase, responsable y avance.</p>
        </div>
        {esAdmin && (
          <div className="flex gap-1 rounded border border-slate-300 p-0.5 text-sm">
            {(["plan", "roles"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setParams(p === "plan" ? {} : { tab: p })} className={`rounded px-3 py-1 ${pestana === p ? "bg-slate-900 text-white" : "text-slate-600"}`}>
                {p === "plan" ? "Opciones y avance" : "Roles por puesto"}
              </button>
            ))}
          </div>
        )}
      </div>
      {pestana === "plan" ? <PlanSistema /> : <RolesDeberSer />}
    </div>
  );
}
