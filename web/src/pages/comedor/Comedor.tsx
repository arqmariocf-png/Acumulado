import { useSearchParams } from "react-router-dom";
import { Cocina } from "./Cocina";
import { NominaComedor } from "./NominaComedor";
import { PedirComida } from "./PedirComida";
import { usePermisosComedor } from "./comun";

/** Comedor (30-sep-2026): empresa aparte dentro de la organización; los
 * trabajadores piden desde su app y se les descuenta por nómina. Pestañas
 * según lo que cada quien puede hacer. */
export function Comedor() {
  const { data: permisos } = usePermisosComedor();
  const [params, setParams] = useSearchParams();
  const pestanas = [
    { clave: "pedir", titulo: "Pedir comida", ve: true },
    { clave: "cocina", titulo: "Cocina", ve: !!permisos?.cocina },
    { clave: "nomina", titulo: "Descuento vía nómina", ve: !!permisos?.nomina },
  ].filter((p) => p.ve);
  const actual = pestanas.find((p) => p.clave === params.get("tab"))?.clave ?? "pedir";

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Comedor</h1>
      <p className="mb-3 text-sm text-slate-500">Pide tu comida del día; se descuenta de tu nómina cuando la cocina la entrega.</p>
      {pestanas.length > 1 && (
        <div className="mb-4 flex gap-1 border-b border-slate-200">
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
      {actual === "pedir" && <PedirComida />}
      {actual === "cocina" && <Cocina />}
      {actual === "nomina" && <NominaComedor />}
    </div>
  );
}
