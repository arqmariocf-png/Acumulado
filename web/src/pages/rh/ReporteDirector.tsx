import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir } from "../../lib/imprimir";
import {
  alertasReporte,
  ddmm,
  htmlReporteRh,
  moneda,
  n0,
  pct,
  resumenEjecutivo,
  semaforoConteo,
  semaforoPct,
  totalesNomina,
  variacionSemanal,
  type ReporteRh,
  type Semaforo,
} from "../../lib/reporteRhDirector";

// Reporte de recursos humanos para el director general (29-oct-2026, Mario:
// "genera el reporte para director general de recursos humanos"). Una sola
// pantalla, solo para el admin de la organización maestra, con lo que RH tiene
// repartido: plantilla, asistencia, tareas, evaluaciones, nómina del
// backoffice, EPP, herramienta, financiamiento y accesos. Los datos salen de
// `fn_reporte_rh_director(p_dias)` (null para cualquiera que no sea él) y las
// reglas (semáforos, alertas, resumen, impresión) de `lib/reporteRhDirector`.

const COLOR: Record<Semaforo, string> = {
  verde: "border-emerald-200 bg-emerald-50 text-emerald-800",
  ambar: "border-amber-200 bg-amber-50 text-amber-800",
  rojo: "border-red-200 bg-red-50 text-red-800",
  gris: "border-slate-200 bg-slate-50 text-slate-600",
};

function Kpi({ k, v, s = "gris", a }: { k: string; v: string; s?: Semaforo; a?: string }) {
  const cuerpo = (
    <div className={`rounded border px-3 py-2 ${COLOR[s]}`}>
      <div className="text-lg font-semibold leading-tight">{v}</div>
      <div className="text-[11px] opacity-80">{k}</div>
    </div>
  );
  return a ? <Link to={a} className="block hover:opacity-90">{cuerpo}</Link> : cuerpo;
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

function Tabla({ cols, filas, der = [] }: { cols: string[]; filas: (string | number | null | undefined)[][]; der?: number[] }) {
  if (filas.length === 0) return <p className="text-xs italic text-slate-400">Sin registros.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] uppercase text-slate-500">
            {cols.map((c, i) => (
              <th key={c} className={`py-1 pr-2 ${der.includes(i) ? "text-right" : ""}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-slate-100">
              {f.map((c, j) => (
                <td key={j} className={`py-1 pr-2 ${der.includes(j) ? "text-right tabular-nums" : ""}`}>{c ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReporteDirector() {
  const { perfil, esAdminGlobal, grupo } = useAuth();
  const [dias, setDias] = useState(30);
  const [aviso, setAviso] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reporte-rh-director", dias],
    enabled: esAdminGlobal,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_reporte_rh_director", { p_dias: dias });
      if (error) throw error;
      return data as ReporteRh | null;
    },
  });
  const alertas = useMemo(() => (data ? alertasReporte(data) : []), [data]);
  const resumen = useMemo(() => (data ? resumenEjecutivo(data) : []), [data]);
  const tot = useMemo(() => (data ? totalesNomina(data.nomina) : null), [data]);
  const variacion = useMemo(() => (data ? variacionSemanal(data.nomina.semanal_tendencia) : null), [data]);

  if (!esAdminGlobal) {
    return <p className="text-sm text-slate-600">Este reporte es solo para el director general.</p>;
  }

  function imprimir() {
    if (!data) return;
    setAviso(abrirParaImprimir(htmlReporteRh(data, grupo?.nombre ?? "Acumulado", perfil?.nombre ?? null)) ? null : "El navegador bloqueó la ventana. Permite ventanas emergentes.");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Reporte de recursos humanos · director general</h1>
          <p className="text-sm text-slate-500">
            Plantilla, asistencia, tareas, evaluaciones, nómina, EPP, herramienta, financiamiento y accesos, en una sola hoja.
            {data && (
              <>
                {" "}
                Del {ddmm(data.desde)} al {ddmm(data.hasta)} ({data.habiles} días hábiles).
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-xs text-slate-600">Periodo</label>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="rounded border border-slate-300 px-2 py-1 text-xs">
            <option value={7}>7 días</option>
            <option value={14}>14 días</option>
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
          <button type="button" onClick={imprimir} disabled={!data} className="rounded bg-slate-800 px-3 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50">
            Imprimir / PDF
          </button>
        </div>
      </div>
      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}
      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-700">No se pudo cargar: {(error as Error).message}</p>}
      {data === null && !isLoading && <p className="text-sm text-slate-600">Este reporte es solo para el director general.</p>}
      {data && tot && (
        <>
          <Seccion titulo="Resumen ejecutivo">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-800">
              {resumen.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ol>
          </Seccion>

          <Seccion titulo={`Qué atender (${alertas.length})`}>
            {alertas.length === 0 ? (
              <p className="text-sm text-emerald-700">Sin pendientes.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {alertas.map((a, i) => (
                  <li key={i} className={`flex items-start gap-2 ${a.nivel === "rojo" ? "text-red-800" : "text-amber-800"}`}>
                    <span className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${a.nivel === "rojo" ? "bg-red-500" : "bg-amber-400"}`} />
                    <span>
                      {a.texto}{" "}
                      <Link to={a.ruta} className="text-blue-700 hover:underline">
                        atender →
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Plantilla" liga={{ a: "/rh?tab=personal", texto: "Personal" }}>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi k="Activos" v={n0(data.plantilla.activos)} />
              <Kpi k="Con cuenta" v={n0(data.plantilla.con_cuenta)} s={data.plantilla.sin_cuenta.length ? "ambar" : "verde"} a="/rh?tab=accesos" />
              <Kpi k="Checan" v={n0(data.plantilla.checan)} s={semaforoPct((100 * data.plantilla.checan) / Math.max(1, data.plantilla.con_cuenta), 90, 70)} a="/rh?tab=checador" />
              <Kpi k="Altas del periodo" v={n0(data.plantilla.altas.length)} />
              <Kpi k="Bajas del periodo" v={n0(data.plantilla.bajas.length)} />
              <Kpi k="Antigüedad promedio" v={data.plantilla.antiguedad_meses == null ? "—" : `${data.plantilla.antiguedad_meses} meses`} />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Por empresa</h3>
                <Tabla cols={["Empresa", "Personas"]} filas={data.plantilla.por_empresa.map((x) => [x.empresa, x.n])} der={[1]} />
                <p className="mt-1 text-[11px] text-slate-400">Empresa = la de su contratación o de su cuenta; sin ninguna, "Sin empresa".</p>
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Por área</h3>
                <Tabla cols={["Área", "Personas"]} filas={data.plantilla.por_area.map((x) => [x.area, x.n])} der={[1]} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Rotación mensual</h3>
                <Tabla cols={["Mes", "Altas", "Bajas", "Cierre", "Rotación"]} filas={data.plantilla.rotacion.map((x) => [x.mes.slice(0, 7), x.altas, x.bajas, x.plantilla_fin, pct(x.rotacion_pct)])} der={[1, 2, 3, 4]} />
              </div>
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Altas del periodo</h3>
                <Tabla cols={["Nombre", "Puesto", "Empresa", "Ingreso"]} filas={data.plantilla.altas.map((x) => [x.nombre, x.puesto, x.empresa, ddmm(x.fecha)])} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Bajas del periodo</h3>
                <Tabla cols={["Nombre", "Puesto", "Baja", "Cuenta"]} filas={data.plantilla.bajas.map((x) => [x.nombre, x.puesto, ddmm(x.fecha), x.cuenta_activa ? "ACTIVA" : "cerrada"])} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Expedientes incompletos ({data.plantilla.expedientes_incompletos.length})</h3>
                <Tabla cols={["Nombre", "Falta"]} filas={data.plantilla.expedientes_incompletos.map((x) => [x.nombre, x.faltan])} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Sin cuenta en el sistema ({data.plantilla.sin_cuenta.length})</h3>
                <Tabla cols={["Nombre", "Puesto"]} filas={data.plantilla.sin_cuenta.map((x) => [x.nombre, x.puesto])} />
              </div>
            </div>
          </Seccion>

          <Seccion titulo="Asistencia (checador)" liga={{ a: "/rh?tab=kpi_checador", texto: "Asistencias y retardos" }}>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Kpi k="Asistencia (quienes checan)" v={pct(data.asistencia.pct_asistencia)} s={semaforoPct(data.asistencia.pct_asistencia, 90, 75)} />
              <Kpi k="Puntualidad" v={pct(data.asistencia.pct_puntualidad)} s={semaforoPct(data.asistencia.pct_puntualidad, 85, 60)} />
              <Kpi k="Días con entrada" v={n0(data.asistencia.dias_con_entrada)} />
              <Kpi k="Retardos" v={n0(data.asistencia.retardos)} />
              <Kpi k="Con cuenta y sin entradas" v={n0(data.asistencia.no_checan.length)} s={semaforoConteo(data.asistencia.no_checan.length, 3)} a="/rh?tab=checador" />
            </div>
            <p className="mb-2 text-[11px] text-slate-400">
              Retardo = primera entrada después de la hora de entrada + tolerancia del perfil de jornada de la persona (o 08:00 + 15 min). Si la hora real es otra, ajusta su perfil en RH → Checador → Jornadas.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Menos días con entrada</h3>
                <Tabla cols={["Nombre", "Días", "Faltas", "Retardos"]} filas={data.asistencia.mas_faltas.map((x) => [x.nombre, x.dias, x.faltas, x.retardos])} der={[1, 2, 3]} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Más retardos</h3>
                <Tabla cols={["Nombre", "Días", "Retardos"]} filas={data.asistencia.mas_retardos.map((x) => [x.nombre, x.dias, x.retardos])} der={[1, 2]} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Con cuenta y sin ninguna entrada</h3>
                <Tabla cols={["Nombre", "Puesto"]} filas={data.asistencia.no_checan.map((x) => [x.nombre, x.puesto])} />
              </div>
            </div>
          </Seccion>

          <Seccion titulo="Cumplimiento de tareas" liga={{ a: "/rh?tab=actividades", texto: "Actividades" }}>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi k="Del periodo" v={n0(data.tareas.periodo.total)} />
              <Kpi k="Hechas" v={`${n0(data.tareas.periodo.hechas)} · ${pct(data.tareas.periodo.pct_cumplimiento)}`} s={semaforoPct(data.tareas.periodo.pct_cumplimiento, 85, 65)} />
              <Kpi k="A tiempo (de las hechas)" v={pct(data.tareas.periodo.pct_a_tiempo)} s={semaforoPct(data.tareas.periodo.pct_a_tiempo, 80, 60)} />
              <Kpi k="Vencidas hoy" v={n0(data.tareas.vencidas)} s={semaforoConteo(data.tareas.vencidas, 5)} a="/tareas?ver=tareas_vencidas" />
              <Kpi k="Abiertas" v={n0(data.tareas.abiertas)} />
              <Kpi k="Cambios de fecha" v={n0(data.tareas.periodo.cambios_fecha)} s={semaforoConteo(data.tareas.periodo.cambios_fecha, 10)} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Por área</h3>
                <Tabla cols={["Área", "Total", "Hechas", "Vencidas"]} filas={data.tareas.por_area.map((x) => [x.area, x.total, x.hechas, x.vencidas])} der={[1, 2, 3]} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Por persona (más vencidas primero)</h3>
                <Tabla cols={["Nombre", "Total", "Hechas", "A tiempo", "Vencidas"]} filas={data.tareas.por_persona.map((x) => [x.nombre, x.total, x.hechas, x.a_tiempo, x.vencidas])} der={[1, 2, 3, 4]} />
              </div>
            </div>
          </Seccion>

          <Seccion titulo="Evaluaciones de desempeño" liga={{ a: "/rh/evaluacion", texto: "Evaluar" }}>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi k="Firmadas en 12 meses" v={n0(data.evaluaciones.firmadas_12m)} />
              <Kpi k="Calificación promedio" v={data.evaluaciones.promedio == null ? "—" : String(data.evaluaciones.promedio)} s={semaforoPct(data.evaluaciones.promedio, 75, 60)} />
              <Kpi k="Borradores" v={n0(data.evaluaciones.borradores)} />
              <Kpi k="Sin evaluar en 6 meses" v={n0(data.evaluaciones.sin_evaluacion_6m)} s={semaforoConteo(data.evaluaciones.sin_evaluacion_6m, 5)} a="/rh/evaluacion" />
            </div>
            <Tabla cols={["Nombre", "Puesto", "Calificación", "Nivel", "Fecha", "Evaluó"]} filas={data.evaluaciones.ultimas.map((x) => [x.nombre, x.puesto, x.calificacion, x.nivel, ddmm(x.fecha), x.evaluador])} der={[2]} />
          </Seccion>

          <Seccion titulo="Nómina (backoffice)" liga={{ a: "/rh/mano-de-obra", texto: "Mano de obra" }}>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi k={`Semanal (${tot.personasSemanal} personas)`} v={moneda(tot.semanal)} />
              <Kpi k={`Quincenal (${tot.personasQuincenal} personas)`} v={moneda(tot.quincenal)} />
              <Kpi k="Nómina fiscal total" v={moneda(tot.fiscal)} />
              <Kpi k="Mano de obra, última semana" v={moneda(tot.manoObra)} />
            </div>
            {variacion && variacion.pct != null && (
              <p className={`mb-2 text-xs ${Math.abs(variacion.pct) >= 10 ? "text-amber-700" : "text-slate-500"}`}>
                La nómina semanal {variacion.pct >= 0 ? "subió" : "bajó"} {Math.abs(variacion.pct)} % contra la semana anterior ({moneda(variacion.anterior)} → {moneda(variacion.ultima)}).
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Semanal por empresa</h3>
                <Tabla cols={["Empresa", "Cierre", "Pers.", "Total"]} filas={data.nomina.semanal.map((x) => [x.empresa, ddmm(x.fin), x.personas, moneda(x.total)])} der={[2, 3]} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Quincenal por empresa</h3>
                <Tabla cols={["Empresa", "Cierre", "Pers.", "Total"]} filas={data.nomina.quincenal.map((x) => [x.empresa, ddmm(x.fin), x.personas, moneda(x.total)])} der={[2, 3]} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Mano de obra por empresa</h3>
                <Tabla cols={["Empresa", "Cierre", "Pers.", "Total"]} filas={data.nomina.mano_obra.map((x) => [x.empresa, ddmm(x.fin), x.personas, moneda(x.total)])} der={[2, 3]} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Semanal, últimas semanas</h3>
                <Tabla cols={["Cierre", "Pers.", "Total"]} filas={data.nomina.semanal_tendencia.map((x) => [ddmm(x.fin), x.personas, moneda(x.total)])} der={[1, 2]} />
              </div>
            </div>
          </Seccion>

          <Seccion titulo="EPP, herramienta y financiamiento">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Kpi k="EPP en uso" v={n0(data.epp.entregadas)} a="/rh?tab=epp" />
              <Kpi k="EPP vencido" v={n0(data.epp.vencidas)} s={semaforoConteo(data.epp.vencidas, 0)} a="/rh?tab=epp" />
              <Kpi k="EPP por vencer (30 días)" v={n0(data.epp.por_vencer_30)} s={semaforoConteo(data.epp.por_vencer_30, 5)} />
              <Kpi k="Solicitudes de EPP" v={n0(data.epp.solicitudes_pendientes)} s={semaforoConteo(data.epp.solicitudes_pendientes, 3)} a="/rh?tab=epp" />
              <Kpi k="EPP perdido por descontar" v={moneda(data.epp.perdidas_por_descontar)} s={data.epp.perdidas_por_descontar > 0 ? "ambar" : "verde"} />
              <Kpi k="Herramienta asignada" v={n0(data.herramienta.asignadas)} a="/almacen/herramienta" />
              <Kpi k="Regreso vencido" v={n0(data.herramienta.regreso_vencido)} s={semaforoConteo(data.herramienta.regreso_vencido, 3)} a="/almacen/herramienta" />
              <Kpi k="Extraviadas" v={n0(data.herramienta.extraviadas)} s={semaforoConteo(data.herramienta.extraviadas, 0)} />
              <Kpi k="Cuentas de nómina" v={`${n0(data.financiamiento.con_linea)} con línea · ${moneda(data.financiamiento.linea_total)}`} a="/financiamiento" />
              <Kpi k="Saldo vigente de préstamos" v={`${moneda(data.financiamiento.saldo_vigente)} · ${n0(data.financiamiento.con_atraso)} con atraso`} s={semaforoConteo(data.financiamiento.con_atraso, 0)} a="/financiamiento" />
            </div>
          </Seccion>

          <Seccion titulo="Accesos al sistema" liga={{ a: "/rh?tab=accesos", texto: "Accesos" }}>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi k="Cuentas activas" v={n0(data.accesos.activas)} />
              <Kpi k="Con notificaciones" v={`${n0(data.accesos.con_push)} · ${pct((100 * data.accesos.con_push) / Math.max(1, data.accesos.activas))}`} s={semaforoPct((100 * data.accesos.con_push) / Math.max(1, data.accesos.activas), 80, 60)} />
              <Kpi k="Esperando rol" v={n0(data.accesos.pendientes.length)} s={semaforoConteo(data.accesos.pendientes.length, 0)} a="/admin" />
              <Kpi k="Bajas con cuenta activa" v={n0(data.plantilla.bajas_con_cuenta.length)} s={semaforoConteo(data.plantilla.bajas_con_cuenta.length, 0)} a="/rh?tab=accesos" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Por rol</h3>
                <Tabla cols={["Rol", "Cuentas"]} filas={data.accesos.por_rol.map((x) => [x.rol, x.n])} der={[1]} />
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-slate-600">Sin notificaciones ({data.accesos.sin_push.length})</h3>
                <Tabla cols={["Nombre", "Rol"]} filas={data.accesos.sin_push.map((x) => [x.nombre, x.rol])} />
              </div>
            </div>
          </Seccion>
        </>
      )}
    </div>
  );
}
