import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { cantidadTexto, fechaCorta, urlRemision } from "../../lib/remision";
import { cargarRemision, imprimirRemision, qrSvg } from "./remisionQr";
import { EstatusRemisionChip } from "./Remisiones";

/** Página a la que apunta el QR impreso: consulta de la remisión y
 * confirmación de entrega desde el celular de quien recibe. */
export function RemisionDetalle() {
  const { id = "" } = useParams();
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const [svg, setSvg] = useState<string>("");
  const [recibio, setRecibio] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: errCarga } = useQuery({
    queryKey: ["remision-salida", id],
    enabled: !!id,
    queryFn: () => cargarRemision(id),
  });

  useEffect(() => {
    if (!id) return;
    qrSvg(urlRemision(window.location.origin, id)).then(setSvg).catch(() => setSvg(""));
  }, [id]);

  const puedeConfirmar = !!perfil && ["admin", "corporativo", "empresa", "almacen", "direccion", "responsable"].includes(perfil.rol);

  async function onConfirmar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setConfirmando(true);
    try {
      const { error: errRpc } = await supabase.rpc("confirmar_entrega_remision", { p_remision_id: id, p_recibio_nombre: recibio });
      if (errRpc) throw errRpc;
      queryClient.invalidateQueries({ queryKey: ["remision-salida", id] });
      queryClient.invalidateQueries({ queryKey: ["remisiones-salida"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirmando(false);
    }
  }

  async function imprimir() {
    setError(null);
    try {
      const ok = await imprimirRemision(id);
      if (!ok) setError("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (isLoading) return <p className="text-sm text-slate-400">Cargando remisión…</p>;
  if (errCarga || !data) return <p className="text-sm text-red-600">{(errCarga as Error | null)?.message ?? "Remisión no encontrada."}</p>;

  const { remision, lineas } = data;
  const entregada = remision.estatus === "entregada";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 text-sm">
        <Link to="/inventario/remisiones" className="text-slate-500 underline">
          ← Remisiones
        </Link>
      </div>
      <div className="rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase text-slate-500">Remisión de salida</p>
            <h2 className="font-mono text-2xl font-semibold text-slate-900">{remision.folio}</h2>
            <p className="text-sm text-slate-600">
              {remision.empresa_nombre} · {remision.almacen_nombre}
            </p>
            <p className="text-sm text-slate-600">{fechaCorta(remision.fecha)}</p>
            <div className="mt-2">
              <EstatusRemisionChip estatus={remision.estatus} />
            </div>
          </div>
          {svg && <div className="h-28 w-28 shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-slate-500">Entregar a</dt>
            <dd className="text-slate-900">{remision.entregar_a}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Destino / obra</dt>
            <dd className="text-slate-900">{remision.destino ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Emitida por</dt>
            <dd className="text-slate-900">{remision.emitida_por_nombre ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Recibió</dt>
            <dd className="text-slate-900">
              {entregada ? `${remision.recibio_nombre ?? ""} · ${remision.entregada_en ? new Date(remision.entregada_en).toLocaleString("es-MX") : ""}` : "Pendiente de confirmar"}
            </dd>
          </div>
          {remision.observaciones && (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase text-slate-500">Observaciones</dt>
              <dd className="text-slate-900">{remision.observaciones}</dd>
            </div>
          )}
        </dl>

        <div className="mt-4 overflow-x-auto rounded border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2">
                    {l.nombre} <span className="text-xs text-slate-400">({l.sku})</span>
                  </td>
                  <td className="px-3 py-2">{l.unidad}</td>
                  <td className="px-3 py-2 text-right">{cantidadTexto(l.cantidad)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 text-sm font-medium">
              <tr>
                <td colSpan={3} className="px-3 py-2">
                  {lineas.length} línea(s)
                </td>
                <td className="px-3 py-2 text-right">{cantidadTexto(lineas.reduce((s, l) => s + l.cantidad, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={imprimir} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
            Imprimir con QR
          </button>
        </div>

        {!entregada && puedeConfirmar && (
          <form onSubmit={onConfirmar} className="mt-4 rounded border border-amber-200 bg-amber-50 p-3">
            <p className="mb-2 text-sm font-medium text-amber-900">Confirmar recepción del material</p>
            <div className="flex flex-wrap gap-2">
              <input
                value={recibio}
                onChange={(e) => setRecibio(e.target.value)}
                placeholder="Nombre de quien recibe"
                required
                className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
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
