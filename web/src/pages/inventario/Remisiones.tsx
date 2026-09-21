import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { cantidadTexto } from "../../lib/remision";
import { imprimirRemision } from "./remisionQr";
import type { RemisionSalida } from "../../types/database";

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

function useRemisiones(empresaId: string) {
  return useQuery({
    queryKey: ["remisiones-salida", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_remisiones_salida").select("*").eq("empresa_id", empresaId).order("numero", { ascending: false }).limit(200);
      if (error) throw error;
      return data as RemisionSalida[];
    },
  });
}

export function EstatusRemisionChip({ estatus }: { estatus: RemisionSalida["estatus"] }) {
  return estatus === "entregada" ? (
    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Entregada</span>
  ) : (
    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Emitida</span>
  );
}

export function Remisiones() {
  const { veTodasLasEmpresas, perfil } = useAuth();
  const { data: empresas } = useEmpresas();
  const [empresaId, setEmpresaId] = useState(perfil?.empresa_id ?? "");
  const [busqueda, setBusqueda] = useState("");
  const [soloAbiertas, setSoloAbiertas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: remisiones, isLoading } = useRemisiones(empresaId);

  const filtradas = remisiones?.filter((r) => {
    if (soloAbiertas && r.estatus !== "emitida") return false;
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return r.folio.toLowerCase().includes(q) || r.entregar_a.toLowerCase().includes(q);
  });

  async function imprimir(id: string) {
    setError(null);
    try {
      const ok = await imprimirRemision(id);
      if (!ok) setError("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">
        Cada salida guardada con remisión aparece aquí con su folio. Imprímela con su QR o ábrela para confirmar la entrega.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {veTodasLasEmpresas ? (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Selecciona una empresa…</option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-slate-600">{empresas?.find((e) => e.id === empresaId)?.nombre}</span>
        )}
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar folio o destinatario…"
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input type="checkbox" checked={soloAbiertas} onChange={(e) => setSoloAbiertas(e.target.checked)} />
          Solo sin confirmar
        </label>
      </div>

      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!empresaId && <p className="text-sm text-slate-500">Selecciona una empresa para ver sus remisiones.</p>}
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {filtradas && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Folio</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Entregar a</th>
                <th className="px-3 py-2 text-right">Líneas</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2">Estatus</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-3 py-2 font-mono">
                    <Link to={`/inventario/remisiones/${r.id}`} className="text-slate-900 underline">
                      {r.folio}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{r.fecha}</td>
                  <td className="px-3 py-2">{r.entregar_a}</td>
                  <td className="px-3 py-2 text-right">{r.lineas}</td>
                  <td className="px-3 py-2 text-right">{cantidadTexto(r.cantidad_total)}</td>
                  <td className="px-3 py-2">
                    <EstatusRemisionChip estatus={r.estatus} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button onClick={() => imprimir(r.id)} className="text-xs text-slate-700 underline">
                      Imprimir con QR
                    </button>
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    No hay remisiones para mostrar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
