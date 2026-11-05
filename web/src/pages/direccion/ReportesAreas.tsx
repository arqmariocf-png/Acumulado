import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir } from "../../lib/imprimir";
import { CifraOrigen } from "../../components/Origen";
import { htmlPresentacionArea } from "../../lib/presentacionArea";
import { formatoValor, type HistoricoGenerico } from "../../lib/historicoRh";
import {
  AREAS_REPORTE,
  LISTA_AREAS,
  alertasArea,
  ddmm,
  filasSeccion,
  formatear,
  resumenArea,
  semaforoArea,
  semaforoDe,
  valorIndicador,
  type AreaReporte,
  type ReporteArea,
  type Semaforo,
} from "../../lib/reporteAreas";

// Reportes de las áreas para el director general (5-nov-2026, Mario: "así
// como generaste el reporte del área de recursos humanos, haz el de todas las
// áreas para revisarlos e irlos puliendo"). Mismo molde que
// `rh/ReporteDirector.tsx`: una pestaña por área (finanzas, contabilidad,
// comercial, operación, compras y almacén, mantenimiento BBVA, producción,
// legal y cumplimiento), periodo en días, indicadores con semáforo y liga a su
// origen, alertas, resumen ejecutivo, secciones y "Presentación (PDF)" que
// además guarda la foto en `reportes_areas_historico` (una por área, periodo y
// fecha de corte) para la lámina de evolución. Datos: `fn_reporte_area_director
// (p_area, p_dias)` (null para quien no sea el admin maestro); reglas en
// `lib/reporteAreas` y láminas en `lib/presentacionArea`. Primera versión: se
// pule con Mario área por área.

const COLOR: Record<Semaforo, string> = {
  verde: "border-emerald-200 bg-emerald-50 text-emerald-800",
  ambar: "border-amber-200 bg-amber-50 text-amber-800",
  rojo: "border-red-200 bg-red-50 text-red-800",
  gris: "border-slate-200 bg-slate-50 text-slate-600",
};

const PERIODOS = [7, 14, 30, 60, 90];

function esArea(x: string | null): x is AreaReporte {
  return !!x && (LISTA_AREAS as string[]).includes(x);
}

export function ReportesAreas() {
  const { perfil, esAdminGlobal, grupo } = useAuth();
  const [params, setParams] = useSearchParams();
  const area: AreaReporte = esArea(params.get("area")) ? (params.get("area") as AreaReporte) : "finanzas";
  const dias = PERIODOS.includes(Number(params.get("dias"))) ? Number(params.get("dias")) : 30;
  const cfg = AREAS_REPORTE[area];
  const [aviso, setAviso] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const qc = useQueryClient();

  function cambiar(nuevo: { area?: AreaReporte; dias?: number }) {
    const p = new URLSearchParams(params);
    p.set("area", nuevo.area ?? area);
    p.set("dias", String(nuevo.dias ?? dias));
    setParams(p, { replace: true });
    setAviso(null);
  }

  const { data: historico } = useQuery({
    queryKey: ["reportes-areas-historico", area],
    enabled: esAdminGlobal,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reportes_areas_historico")
        .select("id, desde, hasta, dias, indicadores, generado_en, generado_por_nombre")
        .eq("area", area)
        .order("hasta", { ascending: false })
        .order("generado_en", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as HistoricoGenerico[];
    },
  });
  const { data, isLoading, error } = useQuery({
    queryKey: ["reporte-area-director", area, dias],
    enabled: esAdminGlobal,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_reporte_area_director", { p_area: area, p_dias: dias });
      if (error) throw error;
      return data as ReporteArea | null;
    },
  });
  const alertas = useMemo(() => (data ? alertasArea(data) : []), [data]);
  const resumen = useMemo(() => (data ? resumenArea(data) : []), [data]);

  if (!esAdminGlobal) {
    return <p className="text-sm text-slate-600">Estos reportes son solo para el director general.</p>;
  }

  async function presentacion() {
    if (!data) return;
    const ventana = window.open("", "_blank");
    setGenerando(true);
    setAviso(null);
    try {
      const hoy = new Date();
      const hoyIso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
      const previos = (historico ?? []).filter((h) => h.dias === data.dias && h.hasta < data.hasta);
      const html = htmlPresentacionArea(data, { organizacion: grupo?.nombre ?? "Acumulado", hoy: hoyIso, historico: previos });
      if (!abrirParaImprimir(html, ventana)) setAviso("El navegador bloqueó la ventana. Permite ventanas emergentes.");
      const { error: errHist } = await supabase.from("reportes_areas_historico").upsert(
        {
          grupo_id: grupo?.id,
          area,
          desde: data.desde,
          hasta: data.hasta,
          dias: data.dias,
          indicadores: data.indicadores,
          datos: data,
          generado_por: perfil?.id ?? null,
          generado_por_nombre: perfil?.nombre ?? null,
          generado_en: new Date().toISOString(),
        },
        { onConflict: "grupo_id,area,dias,hasta" },
      );
      if (errHist) setAviso(`La presentación salió, pero no se guardó en el histórico: ${errHist.message}`);
      else qc.invalidateQueries({ queryKey: ["reportes-areas-historico", area] });
    } catch (e) {
      ventana?.close();
      setAviso(`No se pudo armar la presentación: ${(e as Error).message}`);
    } finally {
      setGenerando(false);
    }
  }

  async function abrirGuardado(h: HistoricoGenerico) {
    if (!h.id) return;
    setAviso(null);
    const ventana = window.open("", "_blank");
    try {
      const { data: fila, error } = await supabase.from("reportes_areas_historico").select("datos, generado_en").eq("id", h.id).single();
      if (error) throw error;
      const previos = (historico ?? []).filter((x) => x.dias === h.dias && x.hasta < h.hasta);
      const html = htmlPresentacionArea(fila.datos as ReporteArea, { organizacion: grupo?.nombre ?? "Acumulado", hoy: String(fila.generado_en).slice(0, 10), historico: previos });
      if (!abrirParaImprimir(html, ventana)) setAviso("El navegador bloqueó la ventana. Permite ventanas emergentes.");
    } catch (e) {
      ventana?.close();
      setAviso(`No se pudo abrir el reporte guardado: ${(e as Error).message}`);
    }
  }

  const destacados = cfg.indicadores.filter((i) => i.destacado);
  const resto = cfg.indicadores.filter((i) => !i.destacado);
  const evolucion = cfg.indicadores.filter((i) => i.destacado).slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Reportes de las áreas para el director general</h1>
          <p className="text-sm text-slate-600">
            Primera versión de cada área, para revisarla e irla puliendo. Cada cifra liga a la pantalla de donde sale.{" "}
            <Link to="/rh/reporte-director" className="text-blue-700 hover:underline">
              Recursos humanos tiene su propio reporte →
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-700">
            Periodo{" "}
            <select value={dias} onChange={(e) => cambiar({ dias: Number(e.target.value) })} className="rounded border border-slate-300 px-2 py-1 text-sm">
              {PERIODOS.map((d) => (
                <option key={d} value={d}>
                  últimos {d} días
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={presentacion} disabled={!data || generando} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {generando ? "Armando…" : "Presentación (PDF)"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {LISTA_AREAS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => cambiar({ area: a })}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${a === area ? "border-slate-900 font-semibold text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {AREAS_REPORTE[a].titulo}
          </button>
        ))}
      </div>

      {aviso && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>}
      {isLoading && <p className="text-sm text-slate-500">Calculando el reporte de {cfg.titulo.toLowerCase()}…</p>}
      {error && <p className="text-sm text-red-700">No se pudo cargar: {(error as Error).message}</p>}
      {data === null && !isLoading && <p className="text-sm text-slate-600">La base no devolvió el reporte (solo el admin de la organización maestra lo recibe).</p>}

      {data && (
        <>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                {cfg.titulo} · del {ddmm(data.desde)} al {ddmm(data.hasta)}/{data.hasta.slice(0, 4)}
              </h2>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${COLOR[semaforoArea(data)]}`}>
                {semaforoArea(data) === "verde" ? "sin pendientes" : semaforoArea(data) === "ambar" ? "con pendientes" : "atender esta semana"}
              </span>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Cubre: {cfg.cubre}.{" "}
              <Link to={cfg.ruta} className="text-blue-700 hover:underline">
                Pantalla principal del área →
              </Link>
            </p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {destacados.map((i) => (
                <Kpi key={i.clave} k={i.etiqueta} v={valorIndicador(i, data.indicadores)} s={semaforoDe(i, data.indicadores)} sub={i.sub ? i.sub(data.indicadores) : undefined} a={i.liga} />
              ))}
            </div>
            {resto.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                {resto.map((i) => (
                  <Kpi key={i.clave} k={i.etiqueta} v={valorIndicador(i, data.indicadores)} s={semaforoDe(i, data.indicadores)} sub={i.sub ? i.sub(data.indicadores) : undefined} a={i.liga} chico />
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Seccion titulo={`Qué atender (${alertas.length})`}>
              {alertas.length === 0 ? (
                <p className="text-sm text-slate-500">Nada pendiente de atender en este periodo.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {alertas.map((x, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${x.nivel === "rojo" ? "bg-red-500" : "bg-amber-400"}`} />
                      <Link to={x.ruta} className="text-slate-800 hover:underline">
                        {x.texto}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Seccion>
            <Seccion titulo="Resumen ejecutivo">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800">
                {resumen.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </Seccion>
          </div>

          {cfg.secciones.map((sec) => {
            const filas = filasSeccion(data, sec.clave);
            return (
              <Seccion key={sec.clave} titulo={`${sec.titulo} (${filas.length})`} liga={sec.liga ? { a: sec.liga, texto: "ver en su pantalla" } : undefined}>
                {sec.nota && <p className="mb-2 text-xs text-slate-500">{sec.nota}</p>}
                {filas.length === 0 ? (
                  <p className="text-xs italic text-slate-400">Sin registros en el periodo.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-slate-500">
                        <tr>
                          {sec.columnas.map((c) => (
                            <th key={c.clave} className={`px-2 py-1 ${numerica(c.formato) ? "text-right" : ""}`}>
                              {c.etiqueta}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filas.map((f, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            {sec.columnas.map((c) => (
                              <td key={c.clave} className={`px-2 py-1 ${numerica(c.formato) ? "text-right tabular-nums" : ""}`}>
                                {formatear(f[c.clave], c.formato)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Seccion>
            );
          })}

          <Seccion titulo="Por revisar con el área">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
              {cfg.porRevisar.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          </Seccion>

          <Seccion titulo={`Histórico de reportes de ${cfg.titulo.toLowerCase()} (${(historico ?? []).length})`}>
            <p className="mb-2 text-xs text-slate-500">
              Cada presentación generada se guarda con sus datos; la nueva compara contra las anteriores del mismo periodo y cualquiera se vuelve a abrir tal como salió. Un reporte del mismo periodo y fecha de corte se reemplaza.
            </p>
            {(historico ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no hay reportes guardados de esta área: el primero se guarda al generar la presentación.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-2 py-1">Corte</th>
                      <th className="px-2 py-1">Periodo</th>
                      {evolucion.map((i) => (
                        <th key={i.clave} className="px-2 py-1 text-right">
                          {i.etiqueta}
                        </th>
                      ))}
                      <th className="px-2 py-1">Generó</th>
                      <th className="px-2 py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {(historico ?? []).map((h) => (
                      <tr key={h.id ?? `${h.dias}-${h.hasta}`} className="border-t border-slate-100">
                        <td className="whitespace-nowrap px-2 py-1.5">
                          {ddmm(h.hasta)}/{h.hasta.slice(0, 4)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">{h.dias} días</td>
                        {evolucion.map((i) => (
                          <td key={i.clave} className="px-2 py-1.5 text-right tabular-nums">
                            {formatoValor(h.indicadores[i.clave] ?? null, i.formato)}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-xs text-slate-600">
                          {h.generado_por_nombre ?? "—"} · {h.generado_en ? ddmm(h.generado_en.slice(0, 10)) : ""}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button type="button" onClick={() => abrirGuardado(h)} className="text-xs text-blue-700 underline">
                            Abrir presentación
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Seccion>
        </>
      )}
    </div>
  );
}

const numerica = (f?: string) => f === "n" || f === "money" || f === "pct" || f === "dias";

function Kpi({ k, v, s = "gris", sub, a, chico = false }: { k: string; v: string; s?: Semaforo; sub?: string; a?: string; chico?: boolean }) {
  return (
    <div className={`rounded border px-3 py-2 ${COLOR[s]}`}>
      <div className={`${chico ? "text-base" : "text-lg"} font-semibold leading-tight`}>{a ? <CifraOrigen a={a}>{v}</CifraOrigen> : v}</div>
      <div className="text-[11px] opacity-80">{k}</div>
      {sub && <div className="text-[10px] opacity-70">{sub}</div>}
    </div>
  );
}

function Seccion({ titulo, liga, children }: { titulo: string; liga?: { a: string; texto: string }; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
        {liga && (
          <Link to={liga.a} className="text-xs text-blue-700 hover:underline">
            {liga.texto} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
