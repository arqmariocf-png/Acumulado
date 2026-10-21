import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import {
  ESTATUS_PLAN,
  GRUPOS_PLAN,
  PRIORIDADES_PLAN,
  agruparPlan,
  csvPlan,
  filtrarPlan,
  limpiarAvance,
  resumenPorGrupo,
  rutaNavegable,
  tonoEstatus,
  type OpcionPlan,
  type TonoPlan,
} from "../../lib/planSistema";

// Plan del sistema (21-oct-2026, Mario: "te adjunto el excel para acomodo del
// sistema, con toda la lógica de ventanas, menús y orden del sistema así como
// los roles y acomodos"). Las 100 opciones del deber ser (tabla plan_sistema,
// sembrada de docs/deber-ser/Acumulado_deber_ser.xlsx): resumen por grupo,
// filtros y, por opción, prioridad, responsable, fecha compromiso, avance,
// estatus y notas. Ven y editan admin y dirección.

const COLUMNAS =
  "id, numero, grupo_menu, menu, opcion, que_hace, viene_de, estatus, ruta, fase, quien, prioridad, responsable, fecha_compromiso, avance, notas, especificacion";

const TONOS: Record<TonoPlan, string> = {
  verde: "bg-emerald-100 text-emerald-800",
  azul: "bg-sky-100 text-sky-800",
  ambar: "bg-amber-100 text-amber-800",
  gris: "bg-slate-100 text-slate-600",
};

const DETALLE: { clave: keyof NonNullable<OpcionPlan["especificacion"]>; etiqueta: string }[] = [
  { clave: "para_que", etiqueta: "Para qué sirve" },
  { clave: "empresas", etiqueta: "Empresas" },
  { clave: "pestanas", etiqueta: "Pestañas" },
  { clave: "datos", etiqueta: "Datos que captura" },
  { clave: "reglas", etiqueta: "Reglas" },
  { clave: "conecta", etiqueta: "Se conecta con" },
  { clave: "quien", etiqueta: "Quién la usa" },
];

export function PlanSistema() {
  const { soloConsulta } = useAuth();
  const [grupo, setGrupo] = useState("");
  const [fase, setFase] = useState<number | null>(null);
  const [estatus, setEstatus] = useState("");
  const [texto, setTexto] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);

  const plan = useQuery({
    queryKey: ["plan-sistema"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plan_sistema").select(COLUMNAS).order("numero");
      if (error) throw error;
      return (data ?? []) as OpcionPlan[];
    },
  });

  const resumen = useMemo(() => resumenPorGrupo(plan.data ?? []), [plan.data]);
  const lista = useMemo(() => filtrarPlan(plan.data ?? [], { grupo, fase, estatus, texto }), [plan.data, grupo, fase, estatus, texto]);
  const grupos = useMemo(() => agruparPlan(lista), [lista]);

  function descargar() {
    const url = URL.createObjectURL(new Blob(["\ufeff" + csvPlan(lista)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `plan-del-sistema-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Plan del sistema</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            El deber ser de Acumulado: 7 grupos, sus menús y cada opción con lo que ya funciona y lo que falta. Pon prioridad, responsable, fecha compromiso y
            avance a cada una; el resumen se calcula solo.
          </p>
        </div>
        <button type="button" onClick={descargar} disabled={!lista.length} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          Descargar Excel
        </button>
      </div>

      {plan.error && <p className="mb-3 text-sm text-red-600">{(plan.error as Error).message}</p>}
      {plan.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      {plan.data && (
        <>
          <div className="mb-4 overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Grupo</th>
                  <th className="px-3 py-2 text-right">Menús</th>
                  <th className="px-3 py-2 text-right">Opciones</th>
                  <th className="px-3 py-2 text-right">Ya funcionan</th>
                  <th className="px-3 py-2 text-right">Por trabajar</th>
                  <th className="px-3 py-2 text-right">Fase 1</th>
                  <th className="px-3 py-2 text-right">Fase 2</th>
                  <th className="px-3 py-2 text-right">Fase 3</th>
                  <th className="px-3 py-2">Avance</th>
                </tr>
              </thead>
              <tbody>
                {[...resumen.grupos, resumen.total].map((r) => {
                  const total = r.grupo === "Total";
                  return (
                    <tr
                      key={r.grupo}
                      onClick={() => !total && setGrupo(grupo === r.grupo ? "" : r.grupo)}
                      className={`border-t border-slate-100 ${total ? "bg-slate-50 font-semibold" : "cursor-pointer hover:bg-slate-50"} ${grupo === r.grupo ? "bg-sky-50" : ""}`}
                    >
                      <td className="px-3 py-1.5">{r.grupo}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.menus}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.opciones}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{r.funcionan}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">{r.porTrabajar}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.fase1}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.fase2}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.fase3}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${r.avance}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-slate-600">{r.avance} %</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
            <label className="text-xs text-slate-600">
              Grupo
              <select value={grupo} onChange={(e) => setGrupo(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">Todos</option>
                {GRUPOS_PLAN.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Fase
              <select value={fase ?? ""} onChange={(e) => setFase(e.target.value ? Number(e.target.value) : null)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">Todas</option>
                <option value="1">Fase 1</option>
                <option value="2">Fase 2</option>
                <option value="3">Fase 3</option>
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Estatus
              <select value={estatus} onChange={(e) => setEstatus(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">Todos</option>
                <option value="por_trabajar">Por trabajar</option>
                {ESTATUS_PLAN.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Buscar
              <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Opción, menú, responsable…" className="mt-1 block w-64 rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <span className="pb-2 text-xs text-slate-500">{lista.length} opciones</span>
          </div>

          {grupos.length === 0 && <p className="rounded border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">Sin coincidencias.</p>}
          {grupos.map((g) => (
            <section key={g.grupo} className="mb-5">
              <h2 className="mb-2 text-base font-semibold text-slate-900">{g.grupo}</h2>
              {g.menus.map((m) => (
                <div key={m.menu} className="mb-3 overflow-x-auto rounded border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{m.menu}</div>
                  <table className="w-full text-sm">
                    <thead className="text-left text-[11px] uppercase text-slate-400">
                      <tr>
                        <th className="px-3 py-1.5">#</th>
                        <th className="px-3 py-1.5">Opción</th>
                        <th className="px-3 py-1.5">Estatus</th>
                        <th className="px-3 py-1.5">Fase</th>
                        <th className="px-3 py-1.5">Prioridad</th>
                        <th className="px-3 py-1.5">Responsable</th>
                        <th className="px-3 py-1.5">Fecha compromiso</th>
                        <th className="px-3 py-1.5">Avance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.opciones.map((o) => (
                        <FilaPlan key={o.id} o={o} soloConsulta={soloConsulta} abierta={abierta === o.id} onAbrir={() => setAbierta(abierta === o.id ? null : o.id)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function FilaPlan({ o, soloConsulta, abierta, onAbrir }: { o: OpcionPlan; soloConsulta: boolean; abierta: boolean; onAbrir: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const guardar = useMutation({
    mutationFn: async (cambio: Partial<OpcionPlan>) => {
      const { error: e } = await supabase.from("plan_sistema").update(cambio).eq("id", o.id);
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["plan-sistema"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const ruta = rutaNavegable(o.ruta);
  const campo = "rounded border border-slate-200 px-1.5 py-1 text-xs disabled:bg-transparent disabled:border-transparent";

  return (
    <>
      <tr className={`border-t border-slate-100 align-top ${abierta ? "bg-sky-50/50" : ""}`}>
        <td className="px-3 py-1.5 text-xs tabular-nums text-slate-400">{o.numero}</td>
        <td className="px-3 py-1.5">
          <button type="button" onClick={onAbrir} className="text-left font-medium text-slate-900 hover:underline">
            {o.opcion}
            {o.especificacion && <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] font-normal text-indigo-700">especificación</span>}
          </button>
          {o.que_hace && <div className="text-xs text-slate-500">{o.que_hace}</div>}
          {ruta && (
            <Link to={ruta} className="text-[11px] text-sky-700 hover:underline">
              {o.ruta}
            </Link>
          )}
          {error && <div className="text-xs text-red-700">{error}</div>}
        </td>
        <td className="px-3 py-1.5">
          {soloConsulta ? (
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${TONOS[tonoEstatus(o.estatus)]}`}>{o.estatus}</span>
          ) : (
            <select
              value={o.estatus}
              onChange={(e) => guardar.mutate({ estatus: e.target.value as OpcionPlan["estatus"] })}
              className={`rounded-full border-0 px-2 py-0.5 text-[11px] ${TONOS[tonoEstatus(o.estatus)]}`}
            >
              {ESTATUS_PLAN.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-xs">{o.fase ? `Fase ${o.fase}` : "—"}</td>
        <td className="px-3 py-1.5">
          <select value={o.prioridad ?? ""} disabled={soloConsulta} onChange={(e) => guardar.mutate({ prioridad: (e.target.value || null) as OpcionPlan["prioridad"] })} className={campo}>
            <option value="">—</option>
            {PRIORIDADES_PLAN.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-1.5">
          <input
            key={`r-${o.responsable ?? ""}`}
            defaultValue={o.responsable ?? ""}
            disabled={soloConsulta}
            placeholder={o.quien ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== o.responsable) guardar.mutate({ responsable: v });
            }}
            className={`${campo} w-36`}
          />
        </td>
        <td className="px-3 py-1.5">
          <input
            type="date"
            value={o.fecha_compromiso ?? ""}
            disabled={soloConsulta}
            onChange={(e) => guardar.mutate({ fecha_compromiso: e.target.value || null })}
            className={campo}
          />
        </td>
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-1">
            <input
              key={`a-${o.avance}`}
              type="number"
              min={0}
              max={100}
              step={5}
              defaultValue={o.avance}
              disabled={soloConsulta}
              onBlur={(e) => {
                const v = limpiarAvance(e.target.value);
                if (v !== o.avance) guardar.mutate({ avance: v });
              }}
              className={`${campo} w-14 text-right`}
            />
            <span className="text-[11px] text-slate-400">%</span>
          </div>
        </td>
      </tr>
      {abierta && (
        <tr className="bg-sky-50/50">
          <td />
          <td colSpan={7} className="px-3 pb-3">
            <div className="grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
              <p>
                <span className="font-semibold">Viene de:</span> {o.viene_de ?? "—"}
              </p>
              <p>
                <span className="font-semibold">Quién la usa:</span> {o.quien ?? "—"}
              </p>
              {o.especificacion &&
                DETALLE.filter((d) => o.especificacion?.[d.clave]).map((d) => (
                  <p key={d.clave} className={d.clave === "datos" || d.clave === "reglas" || d.clave === "para_que" ? "sm:col-span-2" : ""}>
                    <span className="font-semibold">{d.etiqueta}:</span> {o.especificacion?.[d.clave]}
                  </p>
                ))}
              <label className="sm:col-span-2">
                <span className="font-semibold">Notas</span>
                <textarea
                  key={`n-${o.notas ?? ""}`}
                  defaultValue={o.notas ?? ""}
                  disabled={soloConsulta}
                  rows={2}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== o.notas) guardar.mutate({ notas: v });
                  }}
                  placeholder="Acuerdos, quién lo pidió, qué falta…"
                  className="mt-1 block w-full rounded border border-slate-200 px-2 py-1 text-xs"
                />
              </label>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
