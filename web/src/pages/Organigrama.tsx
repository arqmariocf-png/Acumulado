import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { AREAS, areaDeClave, type AreaOrganigrama } from "../lib/organigrama";
import { INDICADORES_NUMERICOS, indicadorPorClave, type Indicador } from "../lib/indicadores";

/** Configuración de un KPI del organigrama (tabla kpis_organigrama). */
interface KpiConfig {
  id: string;
  area: string;
  indicador: string;
  etiqueta: string | null;
  orden: number;
  umbral_ambar: number;
  umbral_rojo: number;
  activo: boolean;
}

function useKpis() {
  return useQuery({
    queryKey: ["kpis-organigrama"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("kpis_organigrama").select("*").order("area").order("orden");
      if (error) throw error;
      return (data ?? []) as KpiConfig[];
    },
  });
}

type Semaforo = "verde" | "ambar" | "rojo" | "gris";

function semaforo(valor: number | string | undefined, k: KpiConfig): Semaforo {
  if (valor === undefined || typeof valor !== "number") return "gris";
  if (valor >= Number(k.umbral_rojo)) return "rojo";
  if (valor >= Number(k.umbral_ambar)) return "ambar";
  return "verde";
}

const COLOR_PUNTO: Record<Semaforo, string> = {
  verde: "bg-emerald-500",
  ambar: "bg-amber-400",
  rojo: "bg-red-500",
  gris: "bg-slate-300",
};

function useValorIndicador(ind: Indicador | undefined) {
  const { perfil } = useAuth();
  return useQuery({
    queryKey: ["indicador", ind?.clave, perfil?.id],
    enabled: !!perfil && !!ind,
    staleTime: 60_000,
    queryFn: () => ind!.consulta(perfil!),
  });
}

/** Punto de color de un KPI; el tooltip dice qué es y cuánto vale. */
function Punto({ k }: { k: KpiConfig }) {
  const ind = indicadorPorClave(k.indicador);
  const { data, isLoading } = useValorIndicador(ind);
  if (!ind) return null;
  const estado = isLoading ? "gris" : semaforo(data?.valor, k);
  const etiqueta = k.etiqueta ?? ind.etiqueta;
  return (
    <span
      title={`${etiqueta}: ${isLoading ? "…" : (data?.valor ?? "—")}${data?.detalle ? ` (${data.detalle})` : ""} · ámbar ≥ ${k.umbral_ambar}, rojo ≥ ${k.umbral_rojo}`}
      className={`inline-block h-3 w-3 rounded-full ${COLOR_PUNTO[estado]} ${estado === "rojo" ? "ring-2 ring-red-200" : ""}`}
    />
  );
}

function PuntosArea({ area, kpis }: { area: AreaOrganigrama; kpis: KpiConfig[] }) {
  const del = kpis.filter((k) => k.area === area.clave && k.activo);
  if (del.length === 0) return <span className="text-[11px] text-slate-400">sin KPIs configurados</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {del.map((k) => (
        <Punto key={k.id} k={k} />
      ))}
    </span>
  );
}

/** Primera pantalla del director general: el organigrama por áreas, con
 * los KPIs de cada área como puntos de color debajo del nombre. */
export function Organigrama() {
  const { perfil } = useAuth();
  const { data: kpis } = useKpis();
  return (
    <div>
      <div className="mb-6 text-center">
        <div className="inline-block rounded-lg bg-slate-900 px-6 py-3 text-white">
          <p className="text-[11px] uppercase tracking-wide text-slate-300">Dirección general</p>
          <p className="font-semibold">{perfil?.nombre ?? "Grupo Loma"}</p>
        </div>
        <div className="mx-auto h-6 w-px bg-slate-300" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {AREAS.map((a) => (
          <Link key={a.clave} to={`/area/${a.clave}`} className="rounded-lg border border-slate-200 bg-white transition hover:border-slate-400 hover:shadow-sm">
            <div className={`rounded-t-lg px-3 py-2 text-white ${a.color}`}>
              <p className="font-semibold">{a.titulo}</p>
              <div className="mt-1 min-h-3">{kpis && <PuntosArea area={a} kpis={kpis} />}</div>
            </div>
            <div className="px-3 py-2">
              <p className="text-xs text-slate-600">{a.proposito}</p>
              <p className="mt-1 text-[11px] text-slate-400">{a.responsable ? `Responsable: ${a.responsable}` : "Responsable por asignar"}</p>
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" /> en orden</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> requiere atención</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" /> urgente</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300" /> sin dato</span>
        <Link to="/organigrama/configurar" className="ml-auto underline">
          Configurar KPIs
        </Link>
      </div>
    </div>
  );
}

function TarjetaIndicador({ k }: { k: KpiConfig }) {
  const ind = indicadorPorClave(k.indicador);
  const { data, isLoading, error } = useValorIndicador(ind);
  if (!ind) return null;
  const estado = isLoading ? "gris" : semaforo(data?.valor, k);
  const fondo = estado === "rojo" ? "border-red-300 bg-red-50" : estado === "ambar" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white";
  return (
    <Link to={ind.ruta} className={`rounded-lg border p-3 ${fondo}`}>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_PUNTO[estado]}`} />
        {k.etiqueta ?? ind.etiqueta}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{isLoading ? "…" : error ? "—" : data?.valor}</p>
      <p className="text-xs text-slate-500">{error ? "sin acceso" : (data?.detalle ?? "")}</p>
    </Link>
  );
}

/** Pantalla de un área del organigrama: sus KPIs y sus módulos. */
export function Area() {
  const { clave } = useParams();
  const area = areaDeClave(clave);
  const { data: kpis } = useKpis();
  if (!area) return <Navigate to="/" replace />;
  const kpisArea = (kpis ?? []).filter((k) => k.area === area.clave && k.activo);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500">
            <Link to="/" className="underline">
              Organigrama
            </Link>{" "}
            · {area.titulo}
          </p>
          <h1 className="text-xl font-semibold text-slate-900">{area.titulo}</h1>
          <p className="text-sm text-slate-500">{area.proposito}</p>
        </div>
        <p className="text-xs text-slate-500">{area.responsable ? `Responsable: ${area.responsable}` : "Responsable por asignar"}</p>
      </div>

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">KPIs del área</h2>
          <Link to="/organigrama/configurar" className="text-xs text-slate-500 underline">
            Configurar
          </Link>
        </div>
        {kpisArea.length === 0 ? (
          <p className="text-xs text-slate-400">Esta área no tiene KPIs configurados.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpisArea.map((k) => (
              <TarjetaIndicador key={k.id} k={k} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Módulos</h2>
        <div className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
          {area.entradas.map((e) => (
            <Link key={e.ruta} to={e.ruta} className="grid gap-1 px-3 py-2 hover:bg-slate-50 sm:grid-cols-[200px_1fr]">
              <span className="font-medium text-slate-900">{e.etiqueta}</span>
              <span className="text-sm text-slate-600">
                {e.descripcion.charAt(0).toUpperCase() + e.descripcion.slice(1)}.
                <span className="block text-xs text-slate-500">{e.uso}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Configurador de KPIs (solo admin): por área, qué indicadores llevan
 * punto de color y desde qué valor se pone ámbar o rojo. */
export function ConfigurarKpis() {
  const queryClient = useQueryClient();
  const { data: kpis } = useKpis();
  const [error, setError] = useState<string | null>(null);
  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["kpis-organigrama"] });

  const guardar = useMutation({
    mutationFn: async (k: Partial<KpiConfig> & { area: string; indicador: string }) => {
      const { error: err } = await supabase.from("kpis_organigrama").upsert(k, { onConflict: "area,indicador" });
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (e) => setError((e as Error).message),
  });
  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.from("kpis_organigrama").delete().eq("id", id);
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (e) => setError((e as Error).message),
  });

  const catalogo = INDICADORES_NUMERICOS();

  return (
    <div className="max-w-4xl">
      <p className="text-xs text-slate-500">
        <Link to="/" className="underline">
          Organigrama
        </Link>{" "}
        · Configurar KPIs
      </p>
      <h1 className="text-xl font-semibold text-slate-900">KPIs del organigrama</h1>
      <p className="mb-4 text-sm text-slate-500">
        Por cada área, marca qué indicadores se muestran como punto de color y desde qué valor pasan a ámbar y a rojo. Los cambios se ven en el
        organigrama al instante.
      </p>
      {error && (
        <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}{" "}
          <button className="underline" onClick={() => setError(null)}>
            cerrar
          </button>
        </p>
      )}
      {AREAS.map((a) => {
        const del = (kpis ?? []).filter((k) => k.area === a.clave);
        return (
          <section key={a.clave} className="mb-5 rounded border border-slate-200 bg-white">
            <div className={`rounded-t px-3 py-1.5 text-sm font-semibold text-white ${a.color}`}>{a.titulo}</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-1.5">Indicador</th>
                  <th className="px-3 py-1.5">Activo</th>
                  <th className="px-3 py-1.5">Ámbar desde</th>
                  <th className="px-3 py-1.5">Rojo desde</th>
                  <th className="px-3 py-1.5">Orden</th>
                  <th className="px-3 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {catalogo.map((ind) => {
                  const k = del.find((x) => x.indicador === ind.clave);
                  return (
                    <tr key={ind.clave} className={`border-t border-slate-100 ${k ? "" : "text-slate-400"}`}>
                      <td className="px-3 py-1.5">
                        <div className={k ? "text-slate-900" : ""}>{ind.etiqueta}</div>
                        <div className="text-[11px] text-slate-400">{ind.ruta}</div>
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={!!k && k.activo}
                          onChange={(e) =>
                            k
                              ? guardar.mutate({ id: k.id, area: a.clave, indicador: ind.clave, activo: e.target.checked })
                              : guardar.mutate({ area: a.clave, indicador: ind.clave, activo: true, orden: del.length + 1, umbral_ambar: 1, umbral_rojo: 5 })
                          }
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        {k && (
                          <input
                            type="number"
                            step="any"
                            defaultValue={k.umbral_ambar}
                            onBlur={(e) => guardar.mutate({ id: k.id, area: a.clave, indicador: ind.clave, umbral_ambar: Number(e.target.value) })}
                            className="w-20 rounded border border-slate-300 px-1.5 py-0.5"
                          />
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {k && (
                          <input
                            type="number"
                            step="any"
                            defaultValue={k.umbral_rojo}
                            onBlur={(e) => guardar.mutate({ id: k.id, area: a.clave, indicador: ind.clave, umbral_rojo: Number(e.target.value) })}
                            className="w-20 rounded border border-slate-300 px-1.5 py-0.5"
                          />
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {k && (
                          <input
                            type="number"
                            defaultValue={k.orden}
                            onBlur={(e) => guardar.mutate({ id: k.id, area: a.clave, indicador: ind.clave, orden: Number(e.target.value) })}
                            className="w-16 rounded border border-slate-300 px-1.5 py-0.5"
                          />
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {k && (
                          <button onClick={() => quitar.mutate(k.id)} className="text-xs text-red-600 underline">
                            quitar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
