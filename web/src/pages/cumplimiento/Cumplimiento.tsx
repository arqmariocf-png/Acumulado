import { useSearchParams } from "react-router-dom";
import { Comite } from "./Comite";
import { Controles } from "./Controles";
import { Flujos } from "./Flujos";
import { Incidencias } from "./Incidencias";
import { Normas } from "./Normas";

// Cumplimiento (18-oct-2026, Mario: "implementar estos pasos en todos mis
// procesos"): los cinco pasos del responsable de cumplimiento, cada uno en su
// pestaña. Operan admin y quien tiene el permiso 'legal' o 'cumplimiento';
// dirección consulta, prueba controles y registra incidencias.
const PESTANAS = [
  { clave: "normas", titulo: "1. Cambios normativos", Componente: Normas },
  { clave: "controles", titulo: "2. Revisar controles", Componente: Controles },
  { clave: "incidencias", titulo: "3. Incidencias", Componente: Incidencias },
  { clave: "comite", titulo: "4. Informe al comité", Componente: Comite },
  { clave: "flujos", titulo: "5. Flujos de control", Componente: Flujos },
];

export function Cumplimiento() {
  const [params, setParams] = useSearchParams();
  const actual = PESTANAS.find((p) => p.clave === params.get("tab")) ?? PESTANAS[1];
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Cumplimiento</h1>
      <p className="mb-3 text-sm text-slate-500">Normas que cambian, controles que se prueban solos, incidencias bien comunicadas y el informe al comité en una página.</p>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            onClick={() => setParams({ tab: p.clave })}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${actual.clave === p.clave ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500"}`}
          >
            {p.titulo}
          </button>
        ))}
      </div>
      <actual.Componente />
    </div>
  );
}
