import { useState } from "react";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import { useTurnoAbierto, dinero } from "./datos";
import { Vender } from "./Vender";
import { Despachar } from "./Despachar";
import { Ventas } from "./Ventas";
import { AbrirCaja, Caja } from "./Caja";
import { Credito } from "./Credito";
import { Precios } from "./Precios";

// Punto de venta de ferretería (Mario, 10-oct-2026): módulo para todas las
// empresas desde el almacén general; cobra con código de barras, imprime el
// ticket con su folio en código de barras y despacha al escanearlo.

type Pestana = "vender" | "despachar" | "ventas" | "caja" | "credito" | "precios";

export function PuntoVenta() {
  const { perfil } = useAuth();
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const [pestana, setPestana] = useState<Pestana>("vender");
  const { data: turno } = useTurnoAbierto(empresaId, perfil?.id);
  const supervisa = !!perfil && ["admin", "almacen", "corporativo"].includes(perfil.rol);
  const pestanas: { valor: Pestana; etiqueta: string; visible?: boolean }[] = [
    { valor: "vender", etiqueta: "Vender" },
    { valor: "despachar", etiqueta: "Despachar" },
    { valor: "ventas", etiqueta: "Ventas" },
    { valor: "caja", etiqueta: "Caja" },
    { valor: "credito", etiqueta: "Crédito" },
    { valor: "precios", etiqueta: "Precios", visible: supervisa },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Punto de venta</h1>
        <SelectorEmpresa value={empresaId} onChange={setEmpresaId} vacio="Elige empresa…" />
        {turno && (
          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
            Caja abierta · efectivo esperado {dinero(turno.efectivo_esperado)}
          </span>
        )}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {pestanas
          .filter((p) => p.visible !== false)
          .map((p) => (
            <button
              key={p.valor}
              type="button"
              onClick={() => setPestana(p.valor)}
              className={`rounded border border-slate-200 px-3 py-1.5 text-sm ${pestana === p.valor ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
            >
              {p.etiqueta}
            </button>
          ))}
      </div>
      {!empresaId && pestana !== "despachar" && pestana !== "ventas" ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Elige la empresa que vende (arriba). El almacén general vende por cualquiera de las empresas.</p>
      ) : (
        <>
          {pestana === "vender" && (turno ? <Vender empresaId={empresaId} turno={turno} supervisa={supervisa} /> : <AbrirCaja empresaId={empresaId} />)}
          {pestana === "despachar" && <Despachar empresaId={empresaId} />}
          {pestana === "ventas" && <Ventas empresaId={empresaId} supervisa={supervisa} />}
          {pestana === "caja" && <Caja empresaId={empresaId} turno={turno ?? null} />}
          {pestana === "credito" && <Credito empresaId={empresaId} turno={turno ?? null} />}
          {pestana === "precios" && supervisa && <Precios empresaId={empresaId} />}
        </>
      )}
    </div>
  );
}
