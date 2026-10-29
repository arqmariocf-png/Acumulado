import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir } from "../../lib/imprimir";
import { descargarCsv } from "../../lib/descargarArchivo";
import {
  conPerfilBase,
  csvDetalle,
  csvTiempos,
  ddmm,
  detalleDe,
  diaSemana,
  diferenciaHoras,
  filtrarPersonas,
  horas,
  htmlReporteTiempos,
  minutosPorDia,
  ordenarPersonas,
  pct,
  pctAsistencia,
  pctPuntualidad,
  resumenTiempos,
  semaforoPersona,
  type OrdenPersonas,
  type ReporteTiempos as Datos,
  type Semaforo,
} from "../../lib/reporteRhTiempos";

// Reporte de RH de tiempos y checador (29-oct-2026, Mario: "el reporte del
// área de RH a manera de información más específica en cuanto tiempos y
// checador"). Por persona: días hábiles de su jornada, días con entrada,
// faltas, retardos (minutos contra su hora de entrada + tolerancia), hora
// promedio de entrada y salida, horas activas totales y por día contra lo
// esperado por su jornada, días sin salida, comida; y el detalle día por día
// (entrada · salida a comer · regreso · salida · horas). Ven RH, dirección y
// admin (`fn_reporte_rh_tiempos`, null para los demás).

const COLOR: Record<Semaforo, string> = { verde: "bg-emerald-500", ambar: "bg-amber-400", rojo: "bg-red-500", gris: "bg-slate-300" };

function hoyIso(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function haceDias(n: number): string {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function ReporteTiempos() {
  const { perfil, grupo } = useAuth();
  const [desde, setDesde] = useState(haceDias(29));
  const [hasta, setHasta] = useState(hoyIso());
  const [texto, setTexto] = useState("");
  const [orden, setOrden] = useState<OrdenPersonas>("semaforo");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reporte-rh-tiempos", desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_reporte_rh_tiempos", { p_desde: desde, p_hasta: hasta });
      if (error) throw error;
      return data as Datos | null;
    },
  });
  const lista = useMemo(() => (data ? ordenarPersonas(filtrarPersonas(data.personas, texto), orden) : []), [data, texto, orden]);
  const resumen = useMemo(() => (data ? resumenTiempos(data) : []), [data]);
  const base = data ? conPerfilBase(data.personas) : 0;

  function imprimir(conDetalle: boolean) {
    if (!data) return;
    setAviso(abrirParaImprimir(htmlReporteTiempos(data, grupo?.nombre ?? "Acumulado", perfil?.nombre ?? null, conDetalle)) ? null : "El navegador bloqueó la ventana. Permite ventanas emergentes.");
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Tiempos y checador</h1>
          <p className="text-sm text-slate-500">
            Por persona: días con entrada, faltas, retardos, hora promedio de entrada y salida, horas activas contra su jornada y el detalle día por día. Retardo = primera entrada
            después de la hora de entrada + tolerancia de su jornada. Horas activas = salida − entrada − comida (sin comida marcada, el día completo).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-slate-600">Del</label>
          <input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
          <label className="text-slate-600">al</label>
          <input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} className="rounded border border-slate-300 px-2 py-1" />
          <button type="button" onClick={() => imprimir(false)} disabled={!data} className="rounded bg-slate-800 px-3 py-1 text-white hover:bg-slate-700 disabled:opacity-50">
            Imprimir / PDF
          </button>
          <button type="button" onClick={() => imprimir(true)} disabled={!data} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50">
            PDF con detalle por día
          </button>
          <button type="button" onClick={() => data && descargarCsv(`tiempos-${desde}-${hasta}.csv`, csvTiempos(lista))} disabled={!data} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50">
            Excel
          </button>
          <button type="button" onClick={() => data && descargarCsv(`checador-detalle-${desde}-${hasta}.csv`, csvDetalle(data))} disabled={!data} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50">
            Excel por día
          </button>
        </div>
      </div>
      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-700">No se pudo cargar: {(error as Error).message}</p>}
      {data === null && !isLoading && <p className="text-sm text-slate-600">Este reporte es para recursos humanos y dirección.</p>}
      {data && (
        <>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Resumen</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800">
              {resumen.map((f) => (
                <li key={f} className={/jornada base/.test(f) ? "text-amber-800" : ""}>
                  {f}
                  {/jornada base/.test(f) && (
                    <>
                      {" "}
                      <Link to="/rh?tab=checador&sub=jornadas" className="text-blue-700 hover:underline">
                        Jornadas →
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">Por persona ({lista.length})</h2>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar nombre, puesto, empresa…" className="rounded border border-slate-300 px-2 py-1" />
                <label className="text-slate-600">Ordenar</label>
                <select value={orden} onChange={(e) => setOrden(e.target.value as OrdenPersonas)} className="rounded border border-slate-300 px-2 py-1">
                  <option value="semaforo">Semáforo (rojo primero)</option>
                  <option value="nombre">Nombre</option>
                  <option value="faltas">Más faltas</option>
                  <option value="retardos">Más retardos</option>
                  <option value="horas">Más horas</option>
                </select>
                {base > 0 && (
                  <span className="text-amber-700">
                    {base} con jornada base ({data.personas[0]?.hora_entrada ?? "08:00"})
                  </span>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] uppercase text-slate-500">
                    <th className="py-1 pr-2">Persona</th>
                    <th className="py-1 pr-2 text-right">Hábiles</th>
                    <th className="py-1 pr-2 text-right">Con entrada</th>
                    <th className="py-1 pr-2 text-right">Faltas</th>
                    <th className="py-1 pr-2 text-right">Asist.</th>
                    <th className="py-1 pr-2 text-right">Retardos</th>
                    <th className="py-1 pr-2 text-right">Punt.</th>
                    <th className="py-1 pr-2">Entrada prom.</th>
                    <th className="py-1 pr-2">Salida prom.</th>
                    <th className="py-1 pr-2 text-right">Horas activas</th>
                    <th className="py-1 pr-2 text-right">Por día</th>
                    <th className="py-1 pr-2 text-right">vs jornada</th>
                    <th className="py-1 pr-2 text-right">Sin salida</th>
                    <th className="py-1 pr-2 text-right">Comida</th>
                    <th className="py-1 pr-2">Observación</th>
                    <th className="py-1 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((p) => {
                    const s = semaforoPersona(p);
                    const dif = diferenciaHoras(p);
                    const abiertaEsta = abierta === p.profile_id;
                    const dias = abiertaEsta ? detalleDe(data, p.profile_id) : [];
                    return (
                      <>
                        <tr key={p.profile_id} className="border-b border-slate-100">
                          <td className="py-1 pr-2">
                            <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${COLOR[s.s]}`} title={s.motivo} />
                            <span className="font-medium text-slate-800">{p.nombre}</span>
                            <div className="text-[10px] text-slate-500">
                              {p.puesto ?? "—"}
                              {p.empresa ? ` · ${p.empresa}` : ""} · jornada {p.hora_entrada} +{p.tolerancia} min
                              {p.ubicacion ? ` · ${p.ubicacion}` : ""}
                            </div>
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">{p.habiles}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{p.dias_con_entrada}</td>
                          <td className={`py-1 pr-2 text-right tabular-nums ${p.faltas > 5 ? "text-red-700" : ""}`}>{p.faltas}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{pct(pctAsistencia(p))}</td>
                          <td className={`py-1 pr-2 text-right tabular-nums ${p.retardos > 5 ? "text-amber-700" : ""}`}>
                            {p.retardos}
                            {p.retardo_min_total > 0 && <div className="text-[10px] text-slate-400">{horas(p.retardo_min_total)}</div>}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">{pct(pctPuntualidad(p))}</td>
                          <td className="py-1 pr-2 tabular-nums">{p.entrada_prom ?? "—"}</td>
                          <td className="py-1 pr-2 tabular-nums">{p.salida_prom ?? "—"}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{horas(p.minutos_total)}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{minutosPorDia(p) == null ? "—" : horas(minutosPorDia(p))}</td>
                          <td className={`py-1 pr-2 text-right tabular-nums ${dif != null && dif < 0 ? "text-red-700" : "text-emerald-700"}`}>{dif == null ? "—" : horas(dif)}</td>
                          <td className={`py-1 pr-2 text-right tabular-nums ${p.dias_sin_salida >= 3 ? "text-amber-700" : ""}`}>{p.dias_sin_salida}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{p.comida_prom_min == null ? "—" : `${p.comida_prom_min} m`}</td>
                          <td className="py-1 pr-2 text-slate-600">{s.motivo}</td>
                          <td className="py-1 pr-2 whitespace-nowrap">
                            {p.dias_con_entrada > 0 && (
                              <button type="button" onClick={() => setAbierta(abiertaEsta ? null : p.profile_id)} className="text-blue-700 hover:underline">
                                {abiertaEsta ? "cerrar" : "por día"}
                              </button>
                            )}
                            <Link to={`/rh?tab=checador&sub=marcas`} className="ml-2 text-slate-400 hover:underline">
                              marcas
                            </Link>
                          </td>
                        </tr>
                        {abiertaEsta && (
                          <tr key={`${p.profile_id}-d`} className="bg-slate-50">
                            <td colSpan={16} className="px-3 py-2">
                              <table className="w-auto text-xs">
                                <thead>
                                  <tr className="text-left text-[10px] uppercase text-slate-500">
                                    <th className="pr-3">Fecha</th>
                                    <th className="pr-3">Entrada</th>
                                    <th className="pr-3">Salida a comer</th>
                                    <th className="pr-3">Regreso</th>
                                    <th className="pr-3">Salida</th>
                                    <th className="pr-3 text-right">Horas</th>
                                    <th className="pr-3 text-right">Comida</th>
                                    <th className="pr-3 text-right">Retardo</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {dias.map((x) => (
                                    <tr key={x.fecha}>
                                      <td className="pr-3">
                                        {ddmm(x.fecha)} <span className="text-slate-400">{diaSemana(x.fecha)}</span>
                                      </td>
                                      <td className={`pr-3 tabular-nums ${x.retardo_min > 0 ? "text-amber-700" : ""}`}>{x.entrada ?? "—"}</td>
                                      <td className="pr-3 tabular-nums">{x.comida_inicio ?? "—"}</td>
                                      <td className="pr-3 tabular-nums">{x.comida_fin ?? "—"}</td>
                                      <td className="pr-3 tabular-nums">{x.salida ?? <span className="text-red-700">sin salida</span>}</td>
                                      <td className="pr-3 text-right tabular-nums">{x.minutos == null ? "—" : horas(x.minutos)}</td>
                                      <td className="pr-3 text-right tabular-nums">{x.comida_min == null ? "—" : `${x.comida_min} m`}</td>
                                      <td className="pr-3 text-right tabular-nums">{x.retardo_min > 0 ? `${x.retardo_min} m` : ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Por día</h2>
            <div className="overflow-x-auto">
              <table className="w-auto text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] uppercase text-slate-500">
                    <th className="py-1 pr-3">Día</th>
                    <th className="py-1 pr-3 text-right">Entradas</th>
                    <th className="py-1 pr-3 text-right">Retardos</th>
                    <th className="py-1 pr-3 text-right">Horas activas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.por_dia.map((x) => (
                    <tr key={x.fecha} className="border-b border-slate-100">
                      <td className="py-1 pr-3">
                        {ddmm(x.fecha)} <span className="text-slate-400">{diaSemana(x.fecha)}</span>
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">{x.entradas}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{x.retardos}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{horas(x.minutos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
