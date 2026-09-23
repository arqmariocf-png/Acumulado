import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { cantidadTexto, fechaLargaCorta, urlRemisionProduccion } from "../../lib/remisionProduccion";
import { cargarRemisionProduccion, imprimirRemisionProduccion, qrSvg } from "./remisionProduccionQr";

export function RemisionProduccionDetalle() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [svg, setSvg] = useState("");
  const [recibio, setRecibio] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: errCarga } = useQuery({ queryKey: ["remision-produccion", id], enabled: !!id, queryFn: () => cargarRemisionProduccion(id) });

  useEffect(() => {
    if (id) qrSvg(urlRemisionProduccion(window.location.origin, id)).then(setSvg).catch(() => setSvg(""));
  }, [id]);

  async function onConfirmar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setConfirmando(true);
    try {
      const { error: err } = await supabase.rpc("confirmar_entrega_remision_produccion", { p_remision_id: id, p_recibio_nombre: recibio });
      if (err) throw err;
      queryClient.invalidateQueries({ queryKey: ["remision-produccion", id] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirmando(false);
    }
  }

  if (isLoading) return <p className="text-sm text-slate-400">Cargando remisión…</p>;
  if (errCarga || !data) return <p className="text-sm text-red-600">{(errCarga as Error | null)?.message ?? "Remisión no encontrada."}</p>;
  const { remision: r, lineas } = data;
  const entregada = r.estatus === "entregada";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 text-sm">
        <Link to="/produccion" className="text-slate-500 underline">
          ← Producción
        </Link>
      </div>
      <div className="rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase text-slate-500">{r.tipo === "salida" ? "Remisión de entrega" : "Remisión de recepción"} · {r.empresa_nombre}</p>
            <h2 className="font-mono text-2xl font-semibold text-slate-900">{r.folio}</h2>
            <p className="text-sm text-slate-600">{fechaLargaCorta(r.fecha)}</p>
            <span className={`mt-2 inline-block rounded px-2 py-0.5 text-xs font-medium ${entregada ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{entregada ? "Entregada" : "Emitida"}</span>
          </div>
          {svg && <div className="h-28 w-28 shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />}
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-slate-500">{r.tipo === "salida" ? "Cliente" : "Proveedor"}</dt>
            <dd className="text-slate-900">{r.contraparte}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Proyecto / referencia</dt>
            <dd className="text-slate-900">{[r.proyecto_nombre, r.referencia].filter(Boolean).join(" · ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Recibió</dt>
            <dd className="text-slate-900">{entregada ? `${r.recibio_nombre ?? ""} · ${r.entregada_en ? new Date(r.entregada_en).toLocaleString("es-MX") : ""}` : "Pendiente de confirmar"}</dd>
          </div>
          {r.observaciones && (
            <div>
              <dt className="text-xs uppercase text-slate-500">Observaciones</dt>
              <dd className="text-slate-900">{r.observaciones}</dd>
            </div>
          )}
        </dl>
        <table className="mt-4 w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Descripción</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                <td className="px-3 py-2">{l.descripcion}</td>
                <td className="px-3 py-2">{l.unidad}</td>
                <td className="px-3 py-2 text-right">{cantidadTexto(l.cantidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={() => imprimirRemisionProduccion(id).catch((e) => setError((e as Error).message))} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
            Imprimir con QR
          </button>
        </div>
        {!entregada && (
          <form onSubmit={onConfirmar} className="mt-4 rounded border border-amber-200 bg-amber-50 p-3">
            <p className="mb-2 text-sm font-medium text-amber-900">Confirmar recepción</p>
            <div className="flex flex-wrap gap-2">
              <input value={recibio} onChange={(e) => setRecibio(e.target.value)} placeholder="Nombre de quien recibe" required className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
              <button type="submit" disabled={confirmando} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {confirmando ? "Confirmando…" : "Confirmar entrega"}
              </button>
            </div>
          </form>
        )}
        {error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
