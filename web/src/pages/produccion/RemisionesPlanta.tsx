import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { fechaLargaCorta } from "../../lib/remisionProduccion";

interface RemisionListada {
  id: string;
  folio: string;
  fecha: string;
  contraparte: string | null;
  proyecto_nombre: string | null;
  estatus: string;
  condicion_pago: string | null;
  dias_credito: number | null;
  lineas: number;
  fotos: number;
}

/** Consulta de las remisiones ya emitidas de la planta, separadas en
 * entradas y salidas: cada una abre su remisión con QR y sus fotos de la
 * entrega (Mario, 30-sep-2026). */
export function RemisionesPlanta({ empresaId, tipo }: { empresaId: string; tipo: "entrada" | "salida" }) {
  const [texto, setTexto] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["remisiones-planta", empresaId, tipo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_remisiones_produccion")
        .select("id, folio, fecha, contraparte, proyecto_nombre, estatus, condicion_pago, dias_credito, lineas, fotos")
        .eq("empresa_id", empresaId)
        .eq("tipo", tipo)
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as RemisionListada[];
    },
  });

  const filtro = texto.trim().toLowerCase();
  const filas = (data ?? []).filter((r) => !filtro || [r.folio, r.contraparte, r.proyecto_nombre].some((v) => v?.toLowerCase().includes(filtro)));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">{tipo === "entrada" ? "Remisiones de entrada (recepción)" : "Remisiones de salida (entrega)"}</h2>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar folio, cliente, proyecto…" className="w-60 rounded border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">{tipo === "salida" ? "Cliente" : "Proveedor"}</th>
              <th className="px-3 py-2">Proyecto</th>
              {tipo === "salida" && <th className="px-3 py-2">Pago</th>}
              <th className="px-3 py-2">Estatus</th>
              <th className="px-3 py-2 text-right">Fotos</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-3 text-slate-400">Cargando…</td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={8} className="px-3 py-3 text-red-600">{(error as Error).message}</td>
              </tr>
            )}
            {!isLoading && !error && filas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-3 text-slate-400">Sin remisiones{filtro ? " con ese filtro" : ""}.</td>
              </tr>
            )}
            {filas.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono">{r.folio}</td>
                <td className="px-3 py-2 whitespace-nowrap">{fechaLargaCorta(r.fecha)}</td>
                <td className="px-3 py-2">{r.contraparte ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{r.proyecto_nombre ?? "—"}</td>
                {tipo === "salida" && (
                  <td className="px-3 py-2 text-slate-600">{r.condicion_pago === "credito" ? `Crédito${r.dias_credito ? ` ${r.dias_credito} d` : ""}` : r.condicion_pago === "contado" ? "Contado" : "—"}</td>
                )}
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${r.estatus === "entregada" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{r.estatus === "entregada" ? "Entregada" : "Emitida"}</span>
                </td>
                <td className={`px-3 py-2 text-right ${r.fotos ? "text-slate-900" : "text-slate-400"}`}>{r.fotos || "—"}</td>
                <td className="px-3 py-2 text-right">
                  <Link to={`/produccion/remisiones/${r.id}`} className="whitespace-nowrap text-slate-700 underline">
                    Ver remisión con QR
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
