import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { PASOS_BBVA, pasoActual, esCancelado } from "../../../../supabase/functions/_shared/bbva-control";
import type { BbvaFolioControl } from "../../types/database";
import { ESTATUS_CUADRILLA, infoEstatus, type EstatusCuadrilla } from "./FoliosCuadrilla";

// "Estatus por paso" del control BBVA nuevo: cada folio con su cadena
// recepción → programado → terminado → soportes → enviado → autorizado →
// fichero → pedido → factura → pago, el paso en el que va, la etapa de
// seguimiento del control y, si el supervisor de cuadrilla lo capturó, su
// semáforo. Los datos vienen de bbva_folios_control (se llena al subir el
// control) y de bbva_folios_cuadrilla.

function useFoliosControl() {
  return useQuery({
    queryKey: ["bbva-folios-control"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bbva_folios_control").select("*").order("fecha_recepcion", { ascending: false }).limit(5000);
      if (error) throw error;
      return data as BbvaFolioControl[];
    },
  });
}

function useSemaforoCuadrilla() {
  return useQuery({
    queryKey: ["bbva-folios-cuadrilla-semaforo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bbva_folios_cuadrilla").select("folio, estatus, supervisor:supervisor_id(nombre)");
      if (error) throw error;
      return new Map((data as unknown as { folio: string; estatus: EstatusCuadrilla; supervisor: { nombre: string } | null }[]).map((f) => [f.folio.trim(), f]));
    },
  });
}

const fmt = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

function Cadena({ f }: { f: BbvaFolioControl }) {
  const cancelado = esCancelado(f);
  const actual = pasoActual(f);
  return (
    <div className="flex items-center gap-0.5" title={cancelado ? "Cancelado" : `Va en: ${actual.etiqueta}`}>
      {PASOS_BBVA.map((p, i) => {
        const ok = !cancelado && p.cumplido(f);
        const esActual = !cancelado && i === actual.indice;
        return (
          <span key={p.clave} className="flex items-center" title={`${p.etiqueta}: ${ok ? "sí" : "pendiente"}`}>
            <span
              className={`inline-block h-3 w-3 rounded-full border ${
                cancelado ? "border-slate-300 bg-slate-200" : ok ? (esActual ? "border-green-700 bg-green-600 ring-2 ring-green-200" : "border-green-600 bg-green-500") : "border-slate-300 bg-white"
              }`}
            />
            {i < PASOS_BBVA.length - 1 && <span className={`h-px w-2 ${ok && !cancelado ? "bg-green-500" : "bg-slate-300"}`} />}
          </span>
        );
      })}
    </div>
  );
}

/** Leyenda de la secuencia: sale de PASOS_BBVA para que la definición y la
 * regla que pinta el semáforo sean la misma. */
export function LeyendaPasos({ compacta = false }: { compacta?: boolean }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <div className="rounded border border-slate-200 bg-white">
      <button type="button" onClick={() => setAbierta((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-slate-800">
        ¿Qué significa cada paso?
        <span className="text-xs text-slate-400">{abierta ? "ocultar" : "ver la secuencia"}</span>
      </button>
      {abierta && (
        <div className="border-t border-slate-100 px-3 py-2">
          <ol className="space-y-2">
            {PASOS_BBVA.map((p, i) => (
              <li key={p.clave} className="flex gap-2 text-xs">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-[10px] font-semibold text-white">{i + 1}</span>
                <div>
                  <p className="font-semibold text-slate-800">{p.etiqueta}</p>
                  <p className="text-slate-600">{p.que}</p>
                  {!compacta && (
                    <p className="text-slate-400">
                      Se marca cuando: {p.criterio} · Responsable: {p.responsable}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            <b>Cancelado</b>: el folio se canceló (estatus operativo CANCELADO); no avanza y no cuenta en cobranza. El semáforo de cuadrillas va antes de estos
            pasos: <b>Pendiente</b> (rojo) es que la cuadrilla aún no llega, <b>En ejecución</b> (amarillo) que está trabajando en la sucursal y{" "}
            <b>Atendido</b> (verde) es el paso 3, Terminado. Todo lo que sigue es administrativo y de cobranza.
          </p>
        </div>
      )}
    </div>
  );
}

export function PasosPorFolio() {
  const { data: folios, isLoading, error } = useFoliosControl();
  const { data: semaforo } = useSemaforoCuadrilla();
  const [supervisor, setSupervisor] = useState("todos");
  const [paso, setPaso] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [ocultarPagados, setOcultarPagados] = useState(true);

  const supervisores = useMemo(() => Array.from(new Set((folios ?? []).map((f) => f.supervisor ?? "Sin asignar"))).sort(), [folios]);
  const conPaso = useMemo(() => (folios ?? []).map((f) => ({ f, paso: pasoActual(f) })), [folios]);

  const conteoPaso = useMemo(() => {
    const c: Record<string, number> = {};
    for (const { paso: p } of conPaso) c[p.etiqueta] = (c[p.etiqueta] ?? 0) + 1;
    return c;
  }, [conPaso]);

  const lista = conPaso.filter(({ f, paso: p }) => {
    if (supervisor !== "todos" && (f.supervisor ?? "Sin asignar") !== supervisor) return false;
    if (paso !== "todos" && p.etiqueta !== paso) return false;
    if (ocultarPagados && paso === "todos" && (p.etiqueta === "Pago" || p.cancelado)) return false;
    if (busqueda && !`${f.folio ?? ""} ${f.sucursal ?? ""} ${f.solicitud ?? ""}`.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  if (isLoading) return <p className="text-sm text-slate-400">Cargando estatus por paso…</p>;
  if (error) return <p className="text-sm text-red-600">No se pudo leer el control: {(error as Error).message}</p>;
  if (!folios || folios.length === 0) {
    return (
      <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">
        El estatus por paso aparece cuando se sube el control nuevo (archivo "Mantenimiento - KPIs de cobranza", hoja BBVA Mantto).
      </div>
    );
  }

  const ordenPasos = ["Sin iniciar", ...PASOS_BBVA.map((p) => p.etiqueta), "Cancelado"];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Estatus por paso</h2>
          <p className="text-xs text-slate-500">{folios.length} trabajos en el control · en qué paso va cada folio</p>
        </div>
      </div>

      <LeyendaPasos />

      <div className="flex flex-wrap gap-1.5">
        {ordenPasos.filter((e) => conteoPaso[e]).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setPaso(paso === e ? "todos" : e)}
            className={`rounded-full border px-2.5 py-1 text-xs ${paso === e ? "border-slate-900 bg-slate-900 text-white" : e === "Cancelado" ? "border-slate-200 bg-slate-50 text-slate-500" : e === "Pago" ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
          >
            {e} <b>{conteoPaso[e]}</b>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={supervisor} onChange={(e) => setSupervisor(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="todos">Todos los supervisores BBVA</option>
          {supervisores.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar folio, sucursal o alcance…" className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={ocultarPagados} onChange={(e) => setOcultarPagados(e.target.checked)} /> ocultar pagados y cancelados
        </label>
        <span className="text-xs text-slate-400">{lista.length} folios</span>
      </div>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Folio</th>
              <th className="px-2 py-2">Sucursal · alcance</th>
              <th className="px-2 py-2">Supervisor</th>
              <th className="px-2 py-2">Recepción</th>
              <th className="px-2 py-2">Pasos</th>
              <th className="px-2 py-2">Va en</th>
              <th className="px-2 py-2">Etapa (control)</th>
              <th className="px-2 py-2">Cuadrilla</th>
              <th className="px-2 py-2 text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {lista.map(({ f, paso: p }) => {
              const sem = f.folio ? semaforo?.get(f.folio.trim()) : undefined;
              const cuadrilla = sem ? infoEstatus(sem.estatus) : null;
              return (
                <tr key={f.id_interno} className={`border-t border-slate-100 ${p.cancelado ? "text-slate-400" : ""}`}>
                  <td className="px-2 py-1.5 font-medium text-slate-800">
                    {f.folio ?? "—"}
                    <span className="block text-[10px] font-normal text-slate-400">{f.id_interno}</span>
                  </td>
                  <td className="max-w-xs px-2 py-1.5">
                    <span className="block truncate" title={f.solicitud ?? ""}>
                      {f.sucursal ?? "—"}
                    </span>
                    <span className="block truncate text-slate-500" title={f.solicitud ?? ""}>
                      {f.solicitud ?? ""}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{f.supervisor ?? "—"}</td>
                  <td className="px-2 py-1.5 tabular-nums">{f.fecha_recepcion ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <Cadena f={f} />
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 ${p.cancelado ? "bg-slate-100" : p.etiqueta === "Pago" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{p.etiqueta}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    {f.etapa_seguimiento ?? "—"}
                    {f.alerta_siguiente_paso && f.alerta_siguiente_paso !== "Sin seguimiento activo" && (
                      <span className="block text-[10px] text-red-600">{f.alerta_siguiente_paso}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {cuadrilla ? (
                      <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${cuadrilla.chip}`} title={sem?.supervisor?.nombre ?? ""}>
                        <span className={`inline-block h-2 w-2 rounded-full ${cuadrilla.punto}`} /> {cuadrilla.etiqueta}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f.monto_a_cobrar != null ? fmt(f.monto_a_cobrar) : "—"}</td>
                </tr>
              );
            })}
            {lista.length === 0 && (
              <tr>
                <td colSpan={9} className="px-2 py-6 text-center text-slate-400">
                  Sin folios con ese filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">
        Semáforo de cuadrilla: {ESTATUS_CUADRILLA.map((e) => e.etiqueta).join(" / ")}, capturado por los supervisores en Folios BBVA. Pasos verdes = cumplidos según el control; el
        paso con anillo es en el que va.
      </p>
    </section>
  );
}
