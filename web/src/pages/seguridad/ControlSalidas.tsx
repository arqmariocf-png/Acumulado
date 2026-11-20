import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { CamaraQr } from "../../components/LectorCredencial";
import { compararConteo, conteoInicial, interpretarCodigoSalida, revisarConteo, rutaRemisionSalida, textoResultado, type LineaConteo, type OrigenSalida } from "../../lib/controlSalidas";

interface RemisionLeida {
  origen: OrigenSalida;
  remision: {
    id: string; folio: string; fecha: string; empresa_id: string; empresa: string; empresa_codigo: string; cliente: string | null; destino: string | null;
    estatus: string; observaciones: string | null; emitida_por_nombre: string | null; recibio_nombre: string | null; referencia: string | null;
  };
  lineas: { descripcion: string; unidad: string | null; cantidad: number }[];
  verificaciones: { id: string; verificado_en: string; verificado_por_nombre: string | null; resultado: string; total_remision: number; total_contado: number; observaciones: string | null }[];
}

interface SalidaVerificada {
  id: string; origen: OrigenSalida; remision_id: string; folio: string; cliente: string | null; resultado: string; total_remision: number; total_contado: number;
  verificado_en: string; verificado_por_nombre: string | null; empresas: { codigo: string } | null;
}

const hora = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Caseta de seguridad: escanea el QR de la remisión de salida (almacén o
 * planta), cuenta lo que sale y lo registra; Gonzalo lo monitorea en
 * Seguridad › Monitor de salidas (Mario, 20-nov-2026). */
export function ControlSalidas() {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [camara, setCamara] = useState(false);
  const [leida, setLeida] = useState<RemisionLeida | null>(null);
  const [conteo, setConteo] = useState<LineaConteo[]>([]);
  const [observaciones, setObservaciones] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardada, setGuardada] = useState<string | null>(null);
  const [params] = useSearchParams();
  const codigoInicial = params.get("codigo");
  const puedeRegistrar = !!perfil && (perfil.rol === "admin" || perfil.rol === "almacen" || (perfil.modulos ?? []).includes("seguridad"));

  const leer = useMutation({
    mutationFn: async (codigo: string) => {
      if (!interpretarCodigoSalida(codigo)) throw new Error("Eso no parece el QR ni el folio de una remisión (REM-XXX-000001).");
      const { data, error } = await supabase.rpc("fn_salida_por_codigo", { p_codigo: codigo });
      if (error) throw error;
      return data as RemisionLeida;
    },
    onSuccess: (r) => {
      setLeida(r);
      setConteo(conteoInicial(r.lineas));
      setObservaciones("");
      setGuardada(null);
      setError(null);
      setCamara(false);
      setTexto("");
    },
    onError: (e) => setError((e as Error).message),
  });

  const registrar = useMutation({
    mutationFn: async () => {
      if (!leida) throw new Error("Primero escanea la remisión.");
      const falta = revisarConteo(conteo);
      if (falta) throw new Error(falta);
      const { data, error } = await supabase.rpc("fn_salida_verificar", { p_origen: leida.origen, p_remision_id: leida.remision.id, p_lineas: conteo, p_observaciones: observaciones || null });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      setGuardada(textoResultado(compararConteo(conteo)));
      setError(null);
      void qc.invalidateQueries({ queryKey: ["salidas-verificadas-hoy"] });
      if (leida) leer.mutate(leida.remision.id);
    },
    onError: (e) => setError((e as Error).message),
  });

  useEffect(() => {
    if (codigoInicial) leer.mutate(codigoInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigoInicial]);

  const { data: hoy } = useQuery({
    queryKey: ["salidas-verificadas-hoy"],
    queryFn: async () => {
      const desde = new Date();
      desde.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("salidas_verificadas")
        .select("id, origen, remision_id, folio, cliente, resultado, total_remision, total_contado, verificado_en, verificado_por_nombre, empresas(codigo)")
        .gte("verificado_en", desde.toISOString())
        .order("verificado_en", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as SalidaVerificada[];
    },
  });

  const resultado = conteo.length ? compararConteo(conteo) : null;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Control de salidas · caseta</h1>
      <p className="mb-4 text-sm text-slate-500">Escanea el QR de la remisión cuando sale el material, cuenta las piezas y registra la salida. Si algo no cuadra, corrige la cantidad contada: la diferencia queda registrada y se avisa a quien monitorea.</p>

      <div className="rounded border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setCamara((v) => !v)}>
            {camara ? "Cerrar cámara" : "📷 Escanear QR"}
          </button>
          <input
            className="min-w-[14rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="…o lector de mano / folio REM-XXX-000001 (Enter)"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                leer.mutate(texto);
              }
            }}
          />
          <button type="button" disabled={!texto.trim() || leer.isPending} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => leer.mutate(texto)}>
            {leer.isPending ? "Leyendo…" : "Buscar"}
          </button>
        </div>
        {camara && <CamaraQr onCodigo={(c) => leer.mutate(c)} />}
        {error && <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      {leida && (
        <div className="mt-4 rounded border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              {leida.remision.folio} <span className="text-sm font-normal text-slate-500">· {leida.remision.empresa} · {leida.origen === "almacen" ? "almacén" : "planta"}</span>
            </h2>
            <Link to={rutaRemisionSalida(leida.origen, leida.remision.id)} className="text-sm text-blue-700 underline">Ver remisión</Link>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="inline text-slate-500">Fecha: </dt><dd className="inline">{leida.remision.fecha}</dd></div>
            <div><dt className="inline text-slate-500">Entregar a: </dt><dd className="inline">{leida.remision.cliente ?? "—"}</dd></div>
            {leida.remision.destino && <div><dt className="inline text-slate-500">Destino / obra: </dt><dd className="inline">{leida.remision.destino}</dd></div>}
            {leida.remision.referencia && <div><dt className="inline text-slate-500">Referencia: </dt><dd className="inline">{leida.remision.referencia}</dd></div>}
            <div><dt className="inline text-slate-500">Emitió: </dt><dd className="inline">{leida.remision.emitida_por_nombre ?? "—"}</dd></div>
            <div><dt className="inline text-slate-500">Estatus: </dt><dd className="inline">{leida.remision.estatus}{leida.remision.recibio_nombre ? ` · recibió ${leida.remision.recibio_nombre}` : ""}</dd></div>
          </dl>
          {leida.remision.observaciones && <p className="mt-1 text-xs text-slate-500">Obs.: {leida.remision.observaciones}</p>}

          {leida.verificaciones.length > 0 && (
            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
              Esta remisión ya se verificó {leida.verificaciones.length} vez/veces: la última {hora(leida.verificaciones[0].verificado_en)} por {leida.verificaciones[0].verificado_por_nombre ?? "—"} ({leida.verificaciones[0].resultado}). Puedes volver a contar.
            </p>
          )}

          <h3 className="mt-3 text-sm font-semibold text-slate-700">Conteo al salir</h3>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Partida</th>
                  <th className="px-3 py-2 text-right">Remisión</th>
                  <th className="px-3 py-2 text-right">Contado</th>
                  <th className="px-3 py-2 text-right">Dif.</th>
                </tr>
              </thead>
              <tbody>
                {conteo.map((l, i) => {
                  const dif = l.cantidad_contada - l.cantidad_remision;
                  return (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2">{l.descripcion}{l.unidad ? <span className="text-slate-500"> · {l.unidad}</span> : null}</td>
                      <td className="px-3 py-2 text-right">{l.cantidad_remision.toLocaleString("es-MX")}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          value={Number.isFinite(l.cantidad_contada) ? l.cantidad_contada : ""}
                          disabled={!puedeRegistrar}
                          onChange={(e) => setConteo((c) => c.map((x, j) => (j === i ? { ...x, cantidad_contada: e.target.value === "" ? Number.NaN : Number(e.target.value) } : x)))}
                          className={`w-24 rounded border px-2 py-1 text-right ${dif !== 0 && Number.isFinite(dif) ? "border-red-400 bg-red-50" : "border-slate-300"}`}
                        />
                      </td>
                      <td className={`px-3 py-2 text-right ${dif !== 0 && Number.isFinite(dif) ? "font-semibold text-red-700" : "text-slate-400"}`}>{Number.isFinite(dif) ? (dif > 0 ? `+${dif}` : dif) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              {resultado && (
                <tfoot className="bg-slate-50 text-sm font-semibold">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right">{resultado.totalRemision.toLocaleString("es-MX")}</td>
                    <td className="px-3 py-2 text-right">{resultado.totalContado.toLocaleString("es-MX")}</td>
                    <td className={`px-3 py-2 text-right ${resultado.resultado === "diferencia" ? "text-red-700" : "text-emerald-700"}`}>{resultado.resultado === "diferencia" ? "con diferencia" : "coincide"}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {puedeRegistrar ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex-1 text-sm text-slate-700">
                <span className="mb-1 block text-xs uppercase text-slate-500">Observaciones (quién recoge, placas, qué faltó…)</span>
                <input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
              <button type="button" disabled={registrar.isPending} onClick={() => registrar.mutate()} className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${resultado?.resultado === "diferencia" ? "bg-red-700 hover:bg-red-800" : "bg-emerald-700 hover:bg-emerald-800"}`}>
                {registrar.isPending ? "Guardando…" : resultado?.resultado === "diferencia" ? "Registrar salida CON diferencia" : "Registrar salida verificada"}
              </button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Solo consulta: registrar la salida es de la caseta (permiso seguridad) y de almacén.</p>
          )}
          {guardada && <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Salida registrada. {guardada}</p>}
        </div>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-700">Salidas verificadas hoy ({hoy?.length ?? 0})</h2>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Hora</th>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Entregar a</th>
              <th className="px-3 py-2 text-right">Remisión</th>
              <th className="px-3 py-2 text-right">Contado</th>
              <th className="px-3 py-2">Resultado</th>
              <th className="px-3 py-2">Verificó</th>
            </tr>
          </thead>
          <tbody>
            {(hoy ?? []).map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2">{hora(s.verificado_en)}</td>
                <td className="px-3 py-2"><Link to={rutaRemisionSalida(s.origen, s.remision_id)} className="text-blue-700 underline">{s.folio}</Link></td>
                <td className="px-3 py-2">{s.empresas?.codigo ?? ""}</td>
                <td className="px-3 py-2">{s.cliente ?? "—"}</td>
                <td className="px-3 py-2 text-right">{Number(s.total_remision).toLocaleString("es-MX")}</td>
                <td className="px-3 py-2 text-right">{Number(s.total_contado).toLocaleString("es-MX")}</td>
                <td className="px-3 py-2">{s.resultado === "diferencia" ? <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">diferencia</span> : <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">coincide</span>}</td>
                <td className="px-3 py-2">{s.verificado_por_nombre ?? "—"}</td>
              </tr>
            ))}
            {!hoy?.length && <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-500">Todavía no hay salidas verificadas hoy.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
