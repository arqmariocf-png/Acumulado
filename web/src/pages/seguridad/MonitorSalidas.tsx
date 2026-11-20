import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { estadoSalida, filtrarMonitor, resumenMonitor, rutaRemisionSalida, type EstadoSalida, type FilaMonitor } from "../../lib/controlSalidas";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const hora = (s: string | null) => (s ? new Date(s).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

/** Monitor de salidas: todas las remisiones de salida de todas las empresas
 * (almacén y planta) y si la caseta ya las verificó, con diferencias
 * (Gonzalo, seguridad y monitoreo; Mario, 20-nov-2026). */
export function MonitorSalidas() {
  const [desde, setDesde] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return iso(d);
  });
  const [hasta, setHasta] = useState(() => iso(new Date()));
  const [estado, setEstado] = useState<EstadoSalida | "todas">("todas");
  const [texto, setTexto] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["salidas-monitor", desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_salidas_monitor", { p_desde: desde, p_hasta: hasta });
      if (error) throw error;
      return (data ?? []) as FilaMonitor[];
    },
    refetchInterval: 60_000,
  });

  const filas = filtrarMonitor(data ?? [], estado, texto);
  const r = resumenMonitor(data ?? []);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Monitor de salidas</h1>
      <p className="mb-4 text-sm text-slate-500">Cada remisión de salida de todas las empresas y si la caseta ya la verificó al salir el material. Se actualiza solo cada minuto.</p>

      <div className="mb-3 flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="mb-1 block text-xs uppercase text-slate-500">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
        </label>
        <label>
          <span className="mb-1 block text-xs uppercase text-slate-500">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
        </label>
        <label>
          <span className="mb-1 block text-xs uppercase text-slate-500">Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoSalida | "todas")} className="rounded border border-slate-300 bg-white px-2 py-1">
            <option value="todas">Todas</option>
            <option value="pendiente">Sin verificar en caseta</option>
            <option value="coincide">Verificadas, coinciden</option>
            <option value="diferencia">Con diferencia</option>
          </select>
        </label>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar folio, cliente, empresa…" className="w-60 rounded border border-slate-300 px-2 py-1" />
        <Link to="/seguridad/salidas" className="ml-auto rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">Caseta: escanear y contar</Link>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { t: "Salidas", v: r.salidas, c: "text-slate-900" },
          { t: "Verificadas", v: r.verificadas, c: "text-emerald-700" },
          { t: "Sin verificar", v: r.pendientes, c: r.pendientes ? "text-amber-700" : "text-slate-900" },
          { t: "Con diferencia", v: r.conDiferencia, c: r.conDiferencia ? "text-red-700" : "text-slate-900" },
        ].map((k) => (
          <div key={k.t} className="rounded border border-slate-200 bg-white p-3">
            <p className="text-xs uppercase text-slate-500">{k.t}</p>
            <p className={`text-2xl font-semibold ${k.c}`}>{k.v}</p>
          </div>
        ))}
      </div>
      {r.porEmpresa.length > 0 && (
        <p className="mb-3 text-xs text-slate-500">Por empresa: {r.porEmpresa.map((e) => `${e.codigo} ${e.salidas}${e.pendientes ? ` (${e.pendientes} sin verificar)` : ""}`).join(" · ")}</p>
      )}

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Entregar a</th>
              <th className="px-3 py-2">Destino</th>
              <th className="px-3 py-2 text-right">Partidas</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              <th className="px-3 py-2">Caseta</th>
              <th className="px-3 py-2">Emitió</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const e = estadoSalida(f);
              const clave = `${f.origen}:${f.remision_id}`;
              return (
                <tr key={clave} className={`border-t border-slate-100 ${e === "diferencia" ? "bg-red-50" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2">{f.fecha}</td>
                  <td className="px-3 py-2">
                    <Link to={rutaRemisionSalida(f.origen, f.remision_id)} className="text-blue-700 underline">{f.folio}</Link>
                    <span className="ml-1 text-xs text-slate-400">{f.origen === "almacen" ? "almacén" : "planta"}</span>
                  </td>
                  <td className="px-3 py-2" title={f.empresa_nombre}>{f.empresa_codigo}</td>
                  <td className="px-3 py-2">{f.cliente ?? "—"}</td>
                  <td className="px-3 py-2">{f.destino ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{f.partidas}</td>
                  <td className="px-3 py-2 text-right">{Number(f.cantidad_total).toLocaleString("es-MX")}</td>
                  <td className="px-3 py-2">
                    {e === "pendiente" && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">sin verificar</span>}
                    {e === "coincide" && <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">coincide</span>}
                    {e === "diferencia" && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">diferencia · contado {Number(f.total_contado ?? 0).toLocaleString("es-MX")}</span>}
                    {f.verificacion_id && (
                      <div className="text-xs text-slate-500">
                        {hora(f.verificado_en)} · {f.verificado_por_nombre ?? "—"}{f.verificaciones > 1 ? ` · ${f.verificaciones} veces` : ""}
                        {" · "}
                        <button type="button" className="underline" onClick={() => setAbierta(abierta === clave ? null : clave)}>{abierta === clave ? "ocultar" : "ver conteo"}</button>
                        {abierta === clave && <DetalleVerificacion id={f.verificacion_id} />}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">{f.emitida_por_nombre ?? "—"}</td>
                </tr>
              );
            })}
            {!isLoading && !filas.length && <tr><td colSpan={9} className="px-3 py-4 text-center text-slate-500">No hay remisiones de salida en este periodo con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetalleVerificacion({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ["salida-verificada", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("salidas_verificadas").select("lineas, observaciones").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as { lineas: { descripcion: string; unidad: string | null; cantidad_remision: number; cantidad_contada: number }[]; observaciones: string | null } | null;
    },
  });
  if (!data) return <span> cargando…</span>;
  return (
    <ul className="mt-1 list-disc pl-4 text-slate-700">
      {data.lineas.map((l, i) => {
        const dif = Number(l.cantidad_contada) - Number(l.cantidad_remision);
        return (
          <li key={i} className={dif !== 0 ? "text-red-700" : ""}>
            {l.descripcion}: remisión {Number(l.cantidad_remision).toLocaleString("es-MX")}, contado {Number(l.cantidad_contada).toLocaleString("es-MX")}{dif !== 0 ? ` (${dif > 0 ? "+" : ""}${dif})` : ""}
          </li>
        );
      })}
      {data.observaciones && <li className="list-none text-slate-500">Obs.: {data.observaciones}</li>}
    </ul>
  );
}
